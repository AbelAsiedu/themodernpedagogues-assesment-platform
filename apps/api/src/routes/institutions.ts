import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addMemberSchema, createInstitutionSchema, createUserSchema, INSTITUTION_ROLES } from "@tmp/shared";
import { audit } from "../audit.js";
import { can, hasPlatformPermission } from "../authz/can.js";
import { classes, institutions, memberships, users } from "../db/schema.js";
import { badRequest, conflict, forbidden, notFound, parse } from "../errors.js";
import { hashPassword } from "../security/password.js";

const idParam = z.object({ id: z.string().uuid() });

export async function institutionRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  /** Load an institution the actor may access, or throw. Authorization happens BEFORE existence is revealed. */
  async function institutionFor(req: Parameters<typeof app.authorize>[0], permission: Parameters<typeof app.authorize>[1], id: string) {
    app.authorize(req, permission, { institutionId: id });
    const [inst] = await db.select().from(institutions).where(eq(institutions.id, id)).limit(1);
    if (!inst) throw notFound("Institution not found");
    return inst;
  }

  app.get("/institutions", async (req) => {
    const actor = app.requireActor(req);
    if (hasPlatformPermission(actor, "institutions.read")) {
      const rows = await db.select().from(institutions).orderBy(desc(institutions.createdAt)).limit(200);
      return { institutions: rows };
    }
    const ids = actor.memberships.filter((m) => m.membershipStatus === "active").map((m) => m.institutionId);
    if (!ids.length) return { institutions: [] };
    const rows = await db.select().from(institutions).where(inArray(institutions.id, ids));
    return { institutions: rows };
  });

  app.post("/institutions", async (req, reply) => {
    const actor = app.authorize(req, "institutions.create");
    const input = parse(createInstitutionSchema, req.body);
    const [dup] = await db.select({ id: institutions.id }).from(institutions).where(eq(institutions.slug, input.slug)).limit(1);
    if (dup) throw conflict("That institution slug is already taken");
    // New institutions are pending until an authorised admin approves them.
    const [created] = await db.insert(institutions).values({ ...input, status: "pending" }).returning();
    await audit(db, { action: "institution.create", actorUserId: actor.id, institutionId: created!.id, targetType: "institution", targetId: created!.id, ip: req.ip });
    return reply.status(201).send({ institution: created });
  });

  app.get("/institutions/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    return { institution: await institutionFor(req, "institutions.read", id) };
  });

  app.patch("/institutions/:id/status", async (req) => {
    const { id } = parse(idParam, req.params);
    const { status } = parse(z.object({ status: z.enum(["active", "suspended"]) }), req.body);
    // Activating = approving registration; suspending is a stronger action with its own permission.
    const actor = app.authorize(req, status === "active" ? "institutions.update" : "institutions.suspend");
    const [inst] = await db.select().from(institutions).where(eq(institutions.id, id)).limit(1);
    if (!inst) throw notFound("Institution not found");
    await db.update(institutions).set({ status, updatedAt: new Date() }).where(eq(institutions.id, id));
    await audit(db, {
      action: status === "active" ? "institution.approve" : "institution.suspend",
      actorUserId: actor.id,
      institutionId: id,
      targetType: "institution",
      targetId: id,
      ip: req.ip,
      metadata: { from: inst.status, to: status },
    });
    return { id, status };
  });

  app.get("/institutions/:id/members", async (req) => {
    const { id } = parse(idParam, req.params);
    await institutionFor(req, "members.read", id);
    const rows = await db
      .select({
        membershipId: memberships.id,
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        role: memberships.role,
        status: memberships.status,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.institutionId, id)) // tenant filter
      .orderBy(users.fullName);
    return { members: rows };
  });

  /** Create a brand-new user AND attach them to this institution in one transaction. */
  app.post("/institutions/:id/users", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const inst = await institutionFor(req, "members.manage", id);
    const actor = app.requireActor(req);
    const body = parse(createUserSchema.omit({ platformRole: true }).extend({ role: z.enum(INSTITUTION_ROLES) }), req.body);

    if (inst.status !== "active") throw badRequest("Institution is not active");
    // Only platform-level staff may create institution administrators.
    if (body.role === "institution_admin" && !can(actor, "institutions.update")) {
      throw forbidden("Only platform staff can create institution administrators");
    }
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
    if (existing) throw conflict("A user with that email already exists");

    const passwordHash = await hashPassword(body.password);
    const created = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ email: body.email, fullName: body.fullName, passwordHash })
        .returning({ id: users.id, email: users.email, fullName: users.fullName });
      await tx.insert(memberships).values({ userId: u!.id, institutionId: id, role: body.role });
      return u!;
    });
    await audit(db, {
      action: "member.create",
      actorUserId: actor.id,
      institutionId: id,
      targetType: "user",
      targetId: created.id,
      ip: req.ip,
      metadata: { role: body.role },
    });
    return reply.status(201).send({ user: created, role: body.role });
  });

  /** Attach an EXISTING user. Restricted to platform staff so tenants cannot probe other tenants' users. */
  app.post("/institutions/:id/members", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await institutionFor(req, "members.manage", id);
    const actor = app.authorize(req, "users.read"); // platform-level only (no scope)
    const body = parse(addMemberSchema, req.body);

    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, body.userId)).limit(1);
    if (!target) throw notFound("User not found");
    const [dup] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, body.userId), eq(memberships.institutionId, id), eq(memberships.role, body.role)))
      .limit(1);
    if (dup) throw conflict("User already has that role in this institution");

    await db.insert(memberships).values({ userId: body.userId, institutionId: id, role: body.role });
    await audit(db, { action: "member.add", actorUserId: actor.id, institutionId: id, targetType: "user", targetId: body.userId, ip: req.ip, metadata: { role: body.role } });
    return reply.status(201).send({ userId: body.userId, role: body.role });
  });

  app.patch("/institutions/:id/members/:membershipId/status", async (req) => {
    const params = parse(idParam.extend({ membershipId: z.string().uuid() }), req.params);
    await institutionFor(req, "members.manage", params.id);
    const actor = app.requireActor(req);
    const { status } = parse(z.object({ status: z.enum(["active", "suspended"]) }), req.body);

    // Filter by BOTH ids so a membership from another institution can never be matched.
    const [m] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, params.membershipId), eq(memberships.institutionId, params.id)))
      .limit(1);
    if (!m) throw notFound("Membership not found");
    if (m.userId === actor.id) throw badRequest("You cannot change your own membership");

    await db.update(memberships).set({ status }).where(eq(memberships.id, m.id));
    await audit(db, { action: "member.status_change", actorUserId: actor.id, institutionId: params.id, targetType: "membership", targetId: m.id, ip: req.ip, metadata: { to: status } });
    return { membershipId: m.id, status };
  });

  app.get("/institutions/:id/overview", async (req) => {
    const { id } = parse(idParam, req.params);
    await institutionFor(req, "members.read", id);
    const byRole = await db
      .select({ role: memberships.role, n: count() })
      .from(memberships)
      .where(and(eq(memberships.institutionId, id), eq(memberships.status, "active")))
      .groupBy(memberships.role);
    const [cls] = await db.select({ n: count() }).from(classes).where(eq(classes.institutionId, id));
    const roleCount = (r: string) => byRole.find((x) => x.role === r)?.n ?? 0;
    return {
      teachers: roleCount("teacher"),
      students: roleCount("student"),
      administrators: roleCount("institution_admin"),
      classes: cls?.n ?? 0,
      asOf: new Date().toISOString(),
    };
  });
}
