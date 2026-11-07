import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createClassSchema } from "@tmp/shared";
import { audit } from "../audit.js";
import { can } from "../authz/can.js";
import { classMembers, classes, memberships, users } from "../db/schema.js";
import { badRequest, conflict, forbidden, notFound, parse } from "../errors.js";

const idParam = z.object({ id: z.string().uuid() });

export async function classRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  /** Classes in an institution. Managers see all; everyone else (students) sees only classes they belong to. */
  app.get("/institutions/:id/classes", async (req) => {
    const { id } = parse(idParam, req.params);
    const actor = app.authorize(req, "classes.read", { institutionId: id });
    if (can(actor, "classes.manage", { institutionId: id })) {
      const rows = await db.select().from(classes).where(eq(classes.institutionId, id)).orderBy(desc(classes.createdAt));
      return { classes: rows };
    }
    const mine = await db.select({ classId: classMembers.classId }).from(classMembers).where(eq(classMembers.userId, actor.id));
    if (!mine.length) return { classes: [] };
    const rows = await db
      .select()
      .from(classes)
      .where(and(eq(classes.institutionId, id), inArray(classes.id, mine.map((m) => m.classId))));
    return { classes: rows };
  });

  app.post("/institutions/:id/classes", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const actor = app.authorize(req, "classes.manage", { institutionId: id });
    const input = parse(createClassSchema, req.body);
    const [dup] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.institutionId, id), eq(classes.name, input.name), eq(classes.academicYear, input.academicYear)))
      .limit(1);
    if (dup) throw conflict("A class with that name already exists for this academic year");
    const [created] = await db.insert(classes).values({ ...input, institutionId: id, createdBy: actor.id }).returning();
    await audit(db, { action: "class.create", actorUserId: actor.id, institutionId: id, targetType: "class", targetId: created!.id, ip: req.ip });
    return reply.status(201).send({ class: created });
  });

  /** Object-level check: load the class first, then authorise against ITS institution, never a client-supplied one. */
  async function classFor(req: Parameters<typeof app.authorize>[0], classId: string, permission: "classes.read" | "classes.manage") {
    const actor = app.requireActor(req);
    const [cls] = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
    if (!cls) {
      // Only actors with platform-wide access learn that an id doesn't exist; everyone else
      // gets the same 403 they'd get for another tenant's class, so ids can't be probed.
      if (can(actor, permission)) throw notFound("Class not found");
      throw forbidden();
    }
    app.authorize(req, permission, { institutionId: cls.institutionId }); // throws 403 + audits a denial
    return { actor, cls };
  }

  app.get("/classes/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, cls } = await classFor(req, id, "classes.read");
    if (!can(actor, "classes.manage", { institutionId: cls.institutionId })) {
      const [m] = await db.select().from(classMembers).where(and(eq(classMembers.classId, id), eq(classMembers.userId, actor.id))).limit(1);
      if (!m) throw forbidden();
    }
    return { class: cls };
  });

  app.get("/classes/:id/members", async (req) => {
    const { id } = parse(idParam, req.params);
    await classFor(req, id, "classes.manage");
    const rows = await db
      .select({ userId: users.id, fullName: users.fullName, email: users.email, role: classMembers.role })
      .from(classMembers)
      .innerJoin(users, eq(users.id, classMembers.userId))
      .where(eq(classMembers.classId, id));
    return { members: rows };
  });

  app.post("/classes/:id/members", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { actor, cls } = await classFor(req, id, "classes.manage");
    const body = parse(z.object({ userId: z.string().uuid(), role: z.enum(["teacher", "student"]) }), req.body);

    // The user must already belong to THIS institution with a matching role.
    const [m] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, body.userId),
          eq(memberships.institutionId, cls.institutionId),
          eq(memberships.role, body.role),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    if (!m) throw badRequest("That user is not an active " + body.role + " of this institution");

    await db.insert(classMembers).values({ classId: id, userId: body.userId, role: body.role }).onConflictDoNothing();
    await audit(db, { action: "class.member_add", actorUserId: actor.id, institutionId: cls.institutionId, targetType: "class", targetId: id, ip: req.ip, metadata: { userId: body.userId, role: body.role } });
    return reply.status(201).send({ classId: id, userId: body.userId, role: body.role });
  });

  app.post("/classes/:id/archive", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, cls } = await classFor(req, id, "classes.manage");
    await db.update(classes).set({ archivedAt: new Date() }).where(eq(classes.id, id));
    await audit(db, { action: "class.archive", actorUserId: actor.id, institutionId: cls.institutionId, targetType: "class", targetId: id, ip: req.ip });
    return { id, archived: true };
  });
}
