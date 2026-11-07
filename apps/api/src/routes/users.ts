import { and, desc, eq, ilike, or } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PERMISSIONS, PLATFORM_ROLES, SUPER_ADMIN_ONLY, createUserSchema, grantPermissionSchema, type Permission } from "@tmp/shared";
import { audit } from "../audit.js";
import { isSuperAdmin } from "../authz/can.js";
import { userPermissions, users } from "../db/schema.js";
import { badRequest, conflict, forbidden, notFound, parse } from "../errors.js";
import { hashPassword } from "../security/password.js";
import { revokeAllUserSessions } from "../session.js";

const publicUser = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  platformRole: users.platformRole,
  status: users.status,
  lastLoginAt: users.lastLoginAt,
  createdAt: users.createdAt,
};

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(PLATFORM_ROLES).optional(),
  status: z.enum(["active", "suspended", "deactivated"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function userRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get("/users", async (req) => {
    app.authorize(req, "users.read");
    const q = parse(listQuery, req.query);
    const filters = [
      q.q ? or(ilike(users.email, `%${q.q}%`), ilike(users.fullName, `%${q.q}%`)) : undefined,
      q.role ? eq(users.platformRole, q.role) : undefined,
      q.status ? eq(users.status, q.status) : undefined,
    ].filter(Boolean) as ReturnType<typeof eq>[];
    const rows = await db
      .select(publicUser)
      .from(users)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(q.limit)
      .offset(q.offset);
    return { users: rows, limit: q.limit, offset: q.offset };
  });

  app.post("/users", async (req, reply) => {
    const actor = app.authorize(req, "users.create");
    const input = parse(createUserSchema, req.body);

    // Only a super admin may mint platform-level accounts; everyone else creates ordinary users.
    if (input.platformRole && !isSuperAdmin(actor)) {
      app.authorize(req, "users.assign_roles");
    }

    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (existing) throw conflict("A user with that email already exists");

    const [created] = await db
      .insert(users)
      .values({
        email: input.email,
        fullName: input.fullName,
        passwordHash: await hashPassword(input.password),
        platformRole: input.platformRole,
      })
      .returning(publicUser);
    await audit(db, {
      action: "user.create",
      actorUserId: actor.id,
      targetType: "user",
      targetId: created!.id,
      ip: req.ip,
      metadata: { platformRole: input.platformRole },
    });
    return reply.status(201).send({ user: created });
  });

  const statusBody = z.object({ status: z.enum(["active", "suspended", "deactivated"]) });

  app.patch("/users/:id/status", async (req) => {
    const actor = app.authorize(req, "users.suspend");
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { status } = parse(statusBody, req.body);

    if (id === actor.id) throw badRequest("You cannot change your own account status");
    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw notFound("User not found");
    // Only a super admin may touch another platform-level account.
    if (target.platformRole && !isSuperAdmin(actor)) throw forbidden("Only a super administrator can change this account");

    await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, id));
    // Suspension/deactivation ends every live session immediately.
    if (status !== "active") await revokeAllUserSessions(db, id);
    await audit(db, {
      action: "user.status_change",
      actorUserId: actor.id,
      targetType: "user",
      targetId: id,
      ip: req.ip,
      metadata: { from: target.status, to: status },
    });
    return { id, status };
  });

  const roleBody = z.object({ platformRole: z.enum(PLATFORM_ROLES).nullable() });

  app.patch("/users/:id/platform-role", async (req) => {
    const actor = app.authorize(req, "users.assign_roles");
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { platformRole } = parse(roleBody, req.body);

    if (id === actor.id) throw badRequest("You cannot change your own platform role");
    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw notFound("User not found");

    await db.update(users).set({ platformRole, updatedAt: new Date() }).where(eq(users.id, id));
    // Delegated grants only make sense for platform-level users.
    if (!platformRole) await db.delete(userPermissions).where(eq(userPermissions.userId, id));
    await revokeAllUserSessions(db, id); // force re-login so the new role is what's in effect
    await audit(db, {
      action: "user.role_change",
      actorUserId: actor.id,
      targetType: "user",
      targetId: id,
      ip: req.ip,
      metadata: { from: target.platformRole, to: platformRole },
    });
    return { id, platformRole };
  });

  app.post("/users/:id/permissions", async (req, reply) => {
    const actor = app.authorize(req, "users.assign_roles");
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const { permission } = parse(grantPermissionSchema, req.body);

    if (!(PERMISSIONS as readonly string[]).includes(permission)) throw badRequest("Unknown permission");
    if (SUPER_ADMIN_ONLY.includes(permission as Permission)) throw forbidden("This permission cannot be delegated");

    const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!target) throw notFound("User not found");
    if (!target.platformRole) throw badRequest("Delegated permissions only apply to platform-level accounts");

    await db
      .insert(userPermissions)
      .values({ userId: id, permission, grantedBy: actor.id })
      .onConflictDoNothing();
    await audit(db, { action: "user.permission_grant", actorUserId: actor.id, targetType: "user", targetId: id, ip: req.ip, metadata: { permission } });
    return reply.status(201).send({ id, permission });
  });

  app.delete("/users/:id/permissions/:permission", async (req) => {
    const actor = app.authorize(req, "users.assign_roles");
    const { id, permission } = parse(z.object({ id: z.string().uuid(), permission: z.string().max(64) }), req.params);
    await db.delete(userPermissions).where(and(eq(userPermissions.userId, id), eq(userPermissions.permission, permission)));
    await audit(db, { action: "user.permission_revoke", actorUserId: actor.id, targetType: "user", targetId: id, ip: req.ip, metadata: { permission } });
    return { id, permission, revoked: true };
  });
}
