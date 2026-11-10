import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { saveResponseSchema } from "@tmp/shared";
import { audit } from "../audit.js";
import { isStudentOf } from "../authz/student.js";
import { classMembers, examSessions, examSittings, examSubmissions } from "../db/schema.js";
import { HttpError, notFound, parse } from "../errors.js";

const idParam = z.object({ id: z.string().uuid() });
const savePath = z.object({ id: z.string().uuid(), position: z.coerce.number().int().min(0).max(1000) });

/** Candidate side of examinations. Every handler acts only on the signed-in student's OWN attempt. */
export async function examPlayRoutes(app: FastifyInstance) {
  const { db } = app.deps;
  const engine = () => app.exams;

  /** Exams this student can see: scheduled for their school (and class, if restricted). Everything else is invisible. */
  app.get("/my/exams", async (req) => {
    const actor = app.requireActor(req);
    const schools = actor.memberships.filter((m) => m.role === "student" && m.membershipStatus === "active" && m.institutionStatus === "active").map((m) => m.institutionId);
    if (!schools.length) return { exams: [], serverNow: engine().now() };
    const now = engine().now();
    const horizon = new Date(now.getTime() - 14 * 24 * 3600_000);
    const rows = await db
      .select()
      .from(examSittings)
      .where(and(inArray(examSittings.institutionId, schools), eq(examSittings.status, "scheduled"), gt(examSittings.closesAt, horizon)))
      .orderBy(desc(examSittings.opensAt))
      .limit(100);
    const myClasses = new Set((await db.select({ id: classMembers.classId }).from(classMembers).where(eq(classMembers.userId, actor.id))).map((c) => c.id));
    const visible = rows.filter((s) => !s.classId || myClasses.has(s.classId));
    const mine = visible.length ? await db.select().from(examSessions).where(and(eq(examSessions.userId, actor.id), inArray(examSessions.sittingId, visible.map((s) => s.id)))) : [];
    const byS = new Map(mine.map((m) => [m.sittingId, m]));
    return {
      serverNow: now,
      exams: visible.map((s) => {
        const sess = byS.get(s.id);
        const phase = now < s.opensAt ? "upcoming" : now >= s.closesAt ? "closed" : "open";
        return {
          sittingId: s.id, title: s.title, durationMinutes: s.durationMinutes, opensAt: s.opensAt, closesAt: s.closesAt, phase,
          resultsReleased: !!s.resultsReleasedAt,
          session: sess ? { id: sess.id, status: sess.status, deadlineAt: sess.deadlineAt } : null,
        };
      }),
    };
  });

  /** Begin or resume. Non-disclosing: not your school, not your class, or not there at all all answer the same. */
  app.post("/sittings/:id/start", async (req, reply) => {
    const actor = app.requireActor(req);
    const { id } = parse(idParam, req.params);
    const [sitting] = await db.select().from(examSittings).where(eq(examSittings.id, id)).limit(1);
    if (!sitting || !isStudentOf(actor, sitting.institutionId)) throw notFound("Not found");
    if (sitting.classId) {
      const [m] = await db.select().from(classMembers).where(and(eq(classMembers.classId, sitting.classId), eq(classMembers.userId, actor.id))).limit(1);
      if (!m) throw notFound("Not found");
    }
    const before = await engine().sessionOf(id, actor.id);
    const s = await engine().start(sitting, actor.id);
    if (!before) await audit(db, { action: "exam.start", actorUserId: actor.id, institutionId: sitting.institutionId, targetType: "exam_session", targetId: s.id, ip: req.ip, metadata: { deadlineAt: s.deadlineAt } });
    return reply.status(before ? 200 : 201).send({ sessionId: s.id, status: s.status, deadlineAt: s.deadlineAt, resumed: !!before });
  });

  app.get("/exam-sessions/:id", async (req) => {
    const actor = app.requireActor(req);
    const { id } = parse(idParam, req.params);
    return engine().view(actor.id, id);
  });

  /** Save one answer. Idempotent; stale sequence numbers are ignored, never errors. */
  app.put("/exam-sessions/:id/responses/:position", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req) => {
    const actor = app.requireActor(req);
    const { id, position } = parse(savePath, req.params);
    const body = parse(saveResponseSchema, req.body);
    return engine().save(actor.id, id, position, body.seq, body.answer);
  });

  app.post("/exam-sessions/:id/submit", async (req) => {
    const actor = app.requireActor(req);
    const { id } = parse(idParam, req.params);
    const [s] = await db.select().from(examSessions).where(eq(examSessions.id, id)).limit(1);
    if (!s || s.userId !== actor.id) throw notFound("Not found");
    // The page presses Submit itself when the clock reaches zero and says so. Believe that only if the server's clock agrees
    // (within 2 s), so a student can't label an early submission as automatic, and a timed-out one is recorded honestly.
    const body = parse(z.object({ timeUp: z.boolean().optional() }).default({}), req.body ?? {});
    const timeUp = body.timeUp === true && engine().now().getTime() >= s.deadlineAt.getTime() - 2000;
    const r = await engine().submit(id, timeUp ? "auto" : "student");
    if (!r.already) {
      const [sit] = await db.select({ institutionId: examSittings.institutionId }).from(examSittings).where(eq(examSittings.id, s.sittingId)).limit(1);
      await audit(db, { action: r.kind === "auto" ? "exam.auto_submit" : "exam.submit", actorUserId: actor.id, institutionId: sit?.institutionId ?? null, targetType: "exam_session", targetId: id, ip: req.ip, metadata: { answered: r.answeredCount } });
    }
    return { receipt: r.receipt, submittedAt: r.submittedAt, kind: r.kind, answeredCount: r.answeredCount, alreadySubmitted: r.already };
  });

  /** Until a teacher releases results this only confirms the submission. Answer keys are never returned. */
  app.get("/exam-sessions/:id/result", async (req) => {
    const actor = app.requireActor(req);
    const { id } = parse(idParam, req.params);
    const [s] = await db.select().from(examSessions).where(eq(examSessions.id, id)).limit(1);
    if (!s || s.userId !== actor.id) throw notFound("Not found");
    const [sub] = await db.select().from(examSubmissions).where(eq(examSubmissions.sessionId, id)).limit(1);
    if (!sub) throw new HttpError(409, "not_submitted", "You haven't submitted this exam yet");
    const [sit] = await db.select().from(examSittings).where(eq(examSittings.id, s.sittingId)).limit(1);
    if (!sit?.resultsReleasedAt) return { released: false, receipt: sub.receipt, submittedAt: sub.submittedAt };
    const r = await engine().result(id);
    // Marks per item only: the key and explanations are not revealed.
    return {
      released: true, receipt: sub.receipt, submittedAt: sub.submittedAt, markingComplete: r.pendingItems === 0,
      totalAwarded: r.totalAwarded, totalMax: r.totalMax, pendingItems: r.pendingItems,
      sections: r.sections.map((x) => ({ position: x.position, title: x.title, rule: x.rule, awarded: x.awarded, max: x.max, pending: x.pending, items: x.items.map(({ type: _t, ...i }) => i) })),
    };
  });
}
