import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MAX_EXTENSION_MINUTES, createExamSchema, createSittingSchema, extendSchema, type Permission } from "@tmp/shared";
import { audit } from "../audit.js";
import { can } from "../authz/can.js";
import {
  classMembers, classes, examItems, examSections, examSessions, examSittings, examSubmissions, exams, memberships, questionVersions, questions,
  sittingItems, sittingSections, users,
} from "../db/schema.js";
import { badRequest, conflict, forbidden, notFound, parse } from "../errors.js";

const idParam = z.object({ id: z.string().uuid() });

/** Teacher/admin side of examinations: build an exam, schedule a sitting, watch it, extend time, release results. */
export async function examRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  /** Load by id, then authorise against the object's OWN institution. Missing and foreign look identical to school users. */
  async function load<T extends { institutionId: string }>(req: FastifyRequest, row: T | undefined, permission: Permission) {
    const actor = app.requireActor(req);
    if (!row) {
      if (can(actor, permission)) throw notFound("Not found");
      throw forbidden();
    }
    app.authorize(req, permission, { institutionId: row.institutionId });
    return { actor, row };
  }
  const examFor = async (req: FastifyRequest, id: string) => load(req, (await db.select().from(exams).where(eq(exams.id, id)).limit(1))[0], "exams.manage");
  const sittingFor = async (req: FastifyRequest, id: string) => load(req, (await db.select().from(examSittings).where(eq(examSittings.id, id)).limit(1))[0], "exams.manage");

  /* ------------------------------------------------------------------ exams */

  app.get("/institutions/:id/exams", async (req) => {
    const { id } = parse(idParam, req.params);
    app.authorize(req, "exams.manage", { institutionId: id });
    const rows = await db
      .select({
        exam: exams,
        questionCount: sql<number>`(select count(*)::int from exam_items ei where ei.exam_id = ${exams.id})`,
        sittings: sql<number>`(select count(*)::int from exam_sittings es where es.exam_id = ${exams.id})`,
      })
      .from(exams)
      .where(eq(exams.institutionId, id))
      .orderBy(desc(exams.createdAt));
    return { exams: rows.map((r) => ({ ...r.exam, questionCount: r.questionCount, sittings: r.sittings })) };
  });

  app.post("/institutions/:id/exams", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const actor = app.authorize(req, "exams.manage", { institutionId: id });
    const input = parse(createExamSchema, req.body);
    const allIds = input.sections.flatMap((s) => s.questionIds);
    const found = await db.select().from(questions).where(and(eq(questions.institutionId, id), inArray(questions.id, allIds)));
    const byId = new Map(found.map((q) => [q.id, q]));

    const problems: { path: string; message: string }[] = [];
    input.sections.forEach((sec, si) => {
      sec.questionIds.forEach((qid, qi) => {
        const q = byId.get(qid);
        if (!q) problems.push({ path: `sections.${si}.questionIds.${qi}`, message: "Not found in this school's question bank" });
        else if (q.status !== "approved") problems.push({ path: `sections.${si}.questionIds.${qi}`, message: "Only approved questions can be used in an exam" });
      });
      // "Answer any n" is only fair when every choice is worth the same.
      if (sec.rule.type === "answer_any") {
        const marks = new Set(sec.questionIds.map((qid) => byId.get(qid)?.marks));
        if (marks.size > 1) problems.push({ path: `sections.${si}.questionIds`, message: "In an 'answer any' section every question must carry the same marks" });
      }
    });
    if (problems.length) throw badRequest("Some questions can't be used", problems);

    const exam = await db.transaction(async (tx) => {
      const [e] = await tx
        .insert(exams)
        .values({
          institutionId: id, title: input.title, instructions: input.instructions, durationMinutes: input.durationMinutes,
          shuffleOptions: input.shuffleOptions, provenance: input.provenance, sourceSpec: input.sourceSpec, createdBy: actor.id,
        })
        .returning();
      await tx.insert(examSections).values(
        input.sections.map((s, position) => ({
          examId: e!.id, position, title: s.title, instructions: s.instructions, ruleType: s.rule.type, ruleCount: s.rule.type === "answer_any" ? s.rule.count : null,
        })),
      );
      let n = 0;
      await tx.insert(examItems).values(
        input.sections.flatMap((s, sectionPosition) =>
          s.questionIds.map((qid) => ({ examId: e!.id, position: n++, sectionPosition, questionId: qid, questionVersion: byId.get(qid)!.version })),
        ),
      );
      return e!;
    });
    await audit(db, { action: "exam.create", actorUserId: actor.id, institutionId: id, targetType: "exam", targetId: exam.id, ip: req.ip, metadata: { questions: allIds.length, sections: input.sections.length } });
    return reply.status(201).send({ exam });
  });

  app.get("/exams/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { row: exam } = await examFor(req, id);
    const [sections, items, sittings] = await Promise.all([
      db.select().from(examSections).where(eq(examSections.examId, id)).orderBy(examSections.position),
      db
        .select({ position: examItems.position, sectionPosition: examItems.sectionPosition, questionId: examItems.questionId, version: examItems.questionVersion, stem: questions.stem, type: questions.type, marks: questions.marks })
        .from(examItems)
        .innerJoin(questions, eq(questions.id, examItems.questionId))
        .where(eq(examItems.examId, id))
        .orderBy(examItems.position),
      db.select().from(examSittings).where(eq(examSittings.examId, id)).orderBy(desc(examSittings.opensAt)),
    ]);
    return { exam, sections, items, sittings };
  });

  app.post("/exams/:id/archive", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, row } = await examFor(req, id);
    await db.update(exams).set({ archivedAt: new Date() }).where(eq(exams.id, id));
    await audit(db, { action: "exam.archive", actorUserId: actor.id, institutionId: row.institutionId, targetType: "exam", targetId: id, ip: req.ip });
    return { id, archived: true };
  });

  /* --------------------------------------------------------------- sittings */

  /** Schedule an exam: freezes every question (content, key, marks) exactly as it is now. */
  app.post("/exams/:id/sittings", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { actor, row: exam } = await examFor(req, id);
    if (exam.archivedAt) throw conflict("This exam is archived");
    const input = parse(createSittingSchema, req.body);
    const opensAt = new Date(input.opensAt), closesAt = new Date(input.closesAt);
    if (closesAt.getTime() <= Date.now()) throw badRequest("The closing time is already in the past");
    if (closesAt.getTime() - opensAt.getTime() < exam.durationMinutes * 60_000) {
      throw badRequest(`The exam window must be at least as long as the exam (${exam.durationMinutes} minutes)`);
    }
    if (input.classId) {
      const [c] = await db.select({ id: classes.id }).from(classes).where(and(eq(classes.id, input.classId), eq(classes.institutionId, exam.institutionId))).limit(1);
      if (!c) throw badRequest("That class doesn't belong to this school");
    }
    const [sections, items] = await Promise.all([
      db.select().from(examSections).where(eq(examSections.examId, id)).orderBy(examSections.position),
      db.select().from(examItems).where(eq(examItems.examId, id)).orderBy(examItems.position),
    ]);
    const snaps = await db.select().from(questionVersions).where(inArray(questionVersions.questionId, items.map((i) => i.questionId)));
    const snapOf = (qid: string, v: number) => snaps.find((s) => s.questionId === qid && s.version === v)?.snapshot as
      | { type: string; stem: string; explanation: string | null; marks: number; content: Record<string, unknown> } | undefined;
    if (items.some((i) => !snapOf(i.questionId, i.questionVersion))) throw new Error("question snapshot missing");

    const sitting = await db.transaction(async (tx) => {
      const [s] = await tx
        .insert(examSittings)
        .values({
          institutionId: exam.institutionId, examId: id, classId: input.classId, title: exam.title, instructions: exam.instructions,
          durationMinutes: exam.durationMinutes, shuffleOptions: exam.shuffleOptions, opensAt, closesAt, createdBy: actor.id,
        })
        .returning();
      await tx.insert(sittingSections).values(sections.map((x) => ({ sittingId: s!.id, position: x.position, title: x.title, instructions: x.instructions, ruleType: x.ruleType, ruleCount: x.ruleCount })));
      await tx.insert(sittingItems).values(
        items.map((i) => {
          const sn = snapOf(i.questionId, i.questionVersion)!;
          return { sittingId: s!.id, position: i.position, sectionPosition: i.sectionPosition, questionId: i.questionId, questionVersion: i.questionVersion, type: sn.type, stem: sn.stem, explanation: sn.explanation, marks: sn.marks, content: sn.content };
        }),
      );
      return s!;
    });
    await audit(db, { action: "sitting.create", actorUserId: actor.id, institutionId: exam.institutionId, targetType: "exam_sitting", targetId: sitting.id, ip: req.ip, metadata: { opensAt: input.opensAt, closesAt: input.closesAt, classId: input.classId } });
    return reply.status(201).send({ sitting });
  });

  app.get("/institutions/:id/sittings", async (req) => {
    const { id } = parse(idParam, req.params);
    app.authorize(req, "exams.manage", { institutionId: id });
    const rows = await db
      .select({
        sitting: examSittings,
        started: sql<number>`(select count(*)::int from exam_sessions es where es.sitting_id = ${examSittings.id})`,
        submitted: sql<number>`(select count(*)::int from exam_sessions es where es.sitting_id = ${examSittings.id} and es.status = 'submitted')`,
      })
      .from(examSittings)
      .where(eq(examSittings.institutionId, id))
      .orderBy(desc(examSittings.opensAt))
      .limit(50);
    return { sittings: rows.map((r) => ({ ...r.sitting, started: r.started, submitted: r.submitted })) };
  });

  /** Who is expected: the class's students, or every active student in the school. */
  async function expectedStudents(sitting: { institutionId: string; classId: string | null }) {
    const base = db
      .select({ id: users.id, fullName: users.fullName })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.institutionId, sitting.institutionId), eq(memberships.role, "student"), eq(memberships.status, "active"),
          sitting.classId ? sql`${users.id} in (select user_id from class_members where class_id = ${sitting.classId})` : undefined,
        ),
      );
    return base.orderBy(users.fullName);
  }

  /** The control room: who has started, who is working, who has submitted, and when each deadline is. */
  app.get("/sittings/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { row: sitting } = await sittingFor(req, id);
    const [people, sessions, subs, answered, itemCount] = await Promise.all([
      expectedStudents(sitting),
      db.select().from(examSessions).where(eq(examSessions.sittingId, id)),
      db.select({ sessionId: examSubmissions.sessionId, kind: examSubmissions.kind, submittedAt: examSubmissions.submittedAt, receipt: examSubmissions.receipt }).from(examSubmissions).innerJoin(examSessions, eq(examSessions.id, examSubmissions.sessionId)).where(eq(examSessions.sittingId, id)),
      db.execute<{ session_id: string; n: number; last_saved: Date | null }>(sql`select r.session_id, (count(*) filter (where r.answer is not null))::int as n, max(r.saved_at) as last_saved from exam_responses r join exam_sessions s on s.id = r.session_id where s.sitting_id = ${id} group by r.session_id`),
      db.select({ n: sql<number>`count(*)::int` }).from(sittingItems).where(eq(sittingItems.sittingId, id)),
    ]);
    const now = app.exams.now();
    const sessOf = new Map(sessions.map((s) => [s.userId, s]));
    const subOf = new Map(subs.map((s) => [s.sessionId, s]));
    const nOf = new Map([...answered].map((r) => [r.session_id, r.n]));
    const lastOf = new Map([...answered].map((r) => [r.session_id, r.last_saved]));
    const students = people.map((p) => {
      const s = sessOf.get(p.id);
      const sub = s ? subOf.get(s.id) : undefined;
      // An attempt past its deadline is shown as ended even if the sweeper hasn't swept it yet.
      const status = !s ? "not_started" : s.status === "submitted" ? "submitted" : now.getTime() > s.deadlineAt.getTime() ? "timed_out" : "in_progress";
      return {
        userId: p.id, fullName: p.fullName, status, sessionId: s?.id ?? null, startedAt: s?.startedAt ?? null, deadlineAt: s?.deadlineAt ?? null,
        extensionMinutes: s?.extensionMinutes ?? 0, answered: s ? nOf.get(s.id) ?? 0 : 0, submittedAt: sub?.submittedAt ?? null, submitKind: sub?.kind ?? null,
        lastSavedAt: s ? lastOf.get(s.id) ?? null : null,
      };
    });
    const phase = sitting.status === "cancelled" ? "cancelled" : now < sitting.opensAt ? "upcoming" : now >= sitting.closesAt ? "closed" : "open";
    return {
      sitting: { ...sitting, phase }, serverNow: now, totalQuestions: itemCount[0]?.n ?? 0, students,
      counts: {
        expected: students.length,
        notStarted: students.filter((s) => s.status === "not_started").length,
        inProgress: students.filter((s) => s.status === "in_progress").length,
        submitted: students.filter((s) => s.status === "submitted" || s.status === "timed_out").length,
      },
    };
  });

  app.post("/sittings/:id/cancel", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, row } = await sittingFor(req, id);
    const [started] = await db.select({ n: sql<number>`count(*)::int` }).from(examSessions).where(eq(examSessions.sittingId, id));
    if ((started?.n ?? 0) > 0) throw conflict("Candidates have already started, so this sitting can't be cancelled");
    await db.update(examSittings).set({ status: "cancelled" }).where(eq(examSittings.id, id));
    await audit(db, { action: "sitting.cancel", actorUserId: actor.id, institutionId: row.institutionId, targetType: "exam_sitting", targetId: id, ip: req.ip });
    return { id, status: "cancelled" };
  });

  /** Per-candidate results (deterministic marks only; essays show as pending). */
  app.get("/sittings/:id/results", async (req) => {
    const { id } = parse(idParam, req.params);
    const { row: sitting } = await sittingFor(req, id);
    const rows = await db
      .select({ s: examSessions, fullName: users.fullName })
      .from(examSessions)
      .innerJoin(users, eq(users.id, examSessions.userId))
      .where(and(eq(examSessions.sittingId, id), eq(examSessions.status, "submitted")))
      .orderBy(users.fullName);
    const results = await Promise.all(rows.map(async (r) => {
      const res = await app.exams.result(r.s.id);
      return { sessionId: r.s.id, userId: r.s.userId, fullName: r.fullName, markingStatus: r.s.markingStatus, awarded: res.totalAwarded, max: res.totalMax, pendingItems: res.pendingItems };
    }));
    return { sitting: { id, title: sitting.title, resultsReleasedAt: sitting.resultsReleasedAt }, results };
  });

  app.post("/sittings/:id/release-results", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, row } = await sittingFor(req, id);
    if (app.exams.now() < row.closesAt) throw conflict("Results can be released after the exam closes");
    const [u] = await db.update(examSittings).set({ resultsReleasedAt: row.resultsReleasedAt ?? new Date() }).where(eq(examSittings.id, id)).returning();
    await audit(db, { action: "sitting.release_results", actorUserId: actor.id, institutionId: row.institutionId, targetType: "exam_sitting", targetId: id, ip: req.ip });
    return { sitting: u };
  });

  /** Extra time for one candidate: explicit, reasoned, recorded. */
  app.post("/exam-sessions/:id/extend", async (req) => {
    const { id } = parse(idParam, req.params);
    const [s] = await db.select().from(examSessions).where(eq(examSessions.id, id)).limit(1);
    const [sit] = s ? await db.select().from(examSittings).where(eq(examSittings.id, s.sittingId)).limit(1) : [];
    const { actor } = await load(req, sit, "exams.manage");
    const input = parse(extendSchema, req.body);
    const r = await app.exams.extend(id, input.minutes);
    await audit(db, {
      action: "exam.extend", actorUserId: actor.id, institutionId: sit!.institutionId, targetType: "exam_session", targetId: id, ip: req.ip,
      metadata: { minutes: input.minutes, reason: input.reason, candidate: r.userId, deadlineAt: r.deadlineAt, limit: MAX_EXTENSION_MINUTES },
    });
    return { sessionId: id, deadlineAt: r.deadlineAt, extensionMinutes: r.extensionMinutes };
  });
}
