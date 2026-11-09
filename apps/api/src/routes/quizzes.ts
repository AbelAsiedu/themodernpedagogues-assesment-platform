import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AUTO_MARKED_TYPES, createQuizSchema, startSessionSchema, type Permission } from "@tmp/shared";
import { audit } from "../audit.js";
import { can } from "../authz/can.js";
import {
  classes, questionVersions, questions, quizItems, quizSessions, quizzes, sessionAnswers, sessionParticipants, sessionQuestions, users,
  type QuizSession,
} from "../db/schema.js";
import { badRequest, conflict, forbidden, notFound, parse } from "../errors.js";
import { newJoinCode } from "../quiz/joinCode.js";
import { effectiveStatus } from "../quiz/play.js";

const idParam = z.object({ id: z.string().uuid() });

export async function quizRoutes(app: FastifyInstance) {
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
  const quizFor = async (req: FastifyRequest, id: string, perm: Permission) =>
    load(req, (await db.select().from(quizzes).where(eq(quizzes.id, id)).limit(1))[0], perm);
  const sessionFor = async (req: FastifyRequest, id: string, perm: Permission) =>
    load(req, (await db.select().from(quizSessions).where(eq(quizSessions.id, id)).limit(1))[0], perm);

  /* ---------------------------------------------------------------- quizzes */

  app.get("/institutions/:id/quizzes", async (req) => {
    const { id } = parse(idParam, req.params);
    app.authorize(req, "quizzes.manage", { institutionId: id });
    const rows = await db
      .select({ quiz: quizzes, questionCount: sql<number>`(select count(*)::int from quiz_items qi where qi.quiz_id = ${quizzes.id})` })
      .from(quizzes)
      .where(eq(quizzes.institutionId, id))
      .orderBy(desc(quizzes.createdAt));
    return { quizzes: rows.map((r) => ({ ...r.quiz, questionCount: r.questionCount })) };
  });

  app.post("/institutions/:id/quizzes", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const actor = app.authorize(req, "quizzes.manage", { institutionId: id });
    const input = parse(createQuizSchema, req.body);
    if (new Set(input.questionIds).size !== input.questionIds.length) throw badRequest("A question appears more than once");

    const found = await db.select().from(questions).where(and(eq(questions.institutionId, id), inArray(questions.id, input.questionIds)));
    const byId = new Map(found.map((q) => [q.id, q]));
    const problems: { path: string; message: string }[] = [];
    input.questionIds.forEach((qid, i) => {
      const q = byId.get(qid);
      if (!q) problems.push({ path: `questionIds.${i}`, message: "Not found in this school's question bank" });
      else if (q.status !== "approved") problems.push({ path: `questionIds.${i}`, message: "Only approved questions can be used in a quiz" });
      else if (!AUTO_MARKED_TYPES.includes(q.type as never)) problems.push({ path: `questionIds.${i}`, message: "Essay questions can't be used in live quizzes (they aren't auto-marked)" });
    });
    if (problems.length) throw badRequest("Some questions can't be used", problems);

    const quiz = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(quizzes)
        .values({
          institutionId: id, title: input.title, description: input.description, timePerQuestionSec: input.timePerQuestionSec,
          shuffleQuestions: input.shuffleQuestions, shuffleOptions: input.shuffleOptions, showLeaderboard: input.showLeaderboard, createdBy: actor.id,
        })
        .returning();
      await tx.insert(quizItems).values(input.questionIds.map((qid, position) => ({ quizId: row!.id, position, questionId: qid, questionVersion: byId.get(qid)!.version })));
      return row!;
    });
    await audit(db, { action: "quiz.create", actorUserId: actor.id, institutionId: id, targetType: "quiz", targetId: quiz.id, ip: req.ip, metadata: { questions: input.questionIds.length } });
    return reply.status(201).send({ quiz });
  });

  app.get("/quizzes/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { row: quiz } = await quizFor(req, id, "quizzes.manage");
    const items = await db
      .select({ position: quizItems.position, questionId: quizItems.questionId, version: quizItems.questionVersion, stem: questions.stem, type: questions.type, marks: questions.marks })
      .from(quizItems)
      .innerJoin(questions, eq(questions.id, quizItems.questionId))
      .where(eq(quizItems.quizId, id))
      .orderBy(quizItems.position);
    return { quiz, items };
  });

  app.post("/quizzes/:id/archive", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, row } = await quizFor(req, id, "quizzes.manage");
    await db.update(quizzes).set({ archivedAt: new Date() }).where(eq(quizzes.id, id));
    await audit(db, { action: "quiz.archive", actorUserId: actor.id, institutionId: row.institutionId, targetType: "quiz", targetId: id, ip: req.ip });
    return { id, archived: true };
  });

  /* --------------------------------------------------------------- sessions */

  /** Open a quiz for students: freezes the questions, issues a join code. */
  app.post("/quizzes/:id/sessions", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { row: quiz } = await quizFor(req, id, "sessions.host");
    const actor = app.requireActor(req);
    if (quiz.archivedAt) throw conflict("This quiz is archived");
    const input = parse(startSessionSchema, req.body ?? {});
    if (input.classId) {
      const [c] = await db.select({ id: classes.id }).from(classes).where(and(eq(classes.id, input.classId), eq(classes.institutionId, quiz.institutionId))).limit(1);
      if (!c) throw badRequest("That class doesn't belong to this school");
    }
    const items = await db.select().from(quizItems).where(eq(quizItems.quizId, id)).orderBy(quizItems.position);
    if (!items.length) throw badRequest("This quiz has no questions");
    // Freeze exactly the pinned versions, so later edits to the bank can't change a running quiz.
    const snaps = await db.select().from(questionVersions).where(inArray(questionVersions.questionId, items.map((i) => i.questionId)));
    const snapOf = (qid: string, v: number) => snaps.find((s) => s.questionId === qid && s.version === v)?.snapshot as
      | { type: string; stem: string; explanation: string | null; marks: number; content: Record<string, unknown> } | undefined;
    if (items.some((i) => !snapOf(i.questionId, i.questionVersion))) throw new Error("question snapshot missing");

    const settings = {
      title: quiz.title, timePerQuestionSec: quiz.timePerQuestionSec, shuffleQuestions: quiz.shuffleQuestions,
      shuffleOptions: quiz.shuffleOptions, showLeaderboard: quiz.showLeaderboard, durationMinutes: input.durationMinutes,
    };
    const now = new Date();
    let session: QuizSession | undefined;
    for (let attempt = 0; attempt < 6 && !session; attempt++) {
      try {
        session = await db.transaction(async (tx) => {
          const [s] = await tx
            .insert(quizSessions)
            .values({
              institutionId: quiz.institutionId, quizId: id, classId: input.classId, hostId: actor.id, joinCode: newJoinCode(), settings,
              status: input.startNow ? "active" : "lobby", startedAt: input.startNow ? now : null,
              endsAt: input.startNow && input.durationMinutes ? new Date(now.getTime() + input.durationMinutes * 60_000) : null,
            })
            .returning();
          await tx.insert(sessionQuestions).values(
            items.map((i) => { const sn = snapOf(i.questionId, i.questionVersion)!; return { sessionId: s!.id, position: i.position, questionId: i.questionId, questionVersion: i.questionVersion, type: sn.type, stem: sn.stem, explanation: sn.explanation, marks: sn.marks, content: sn.content }; }),
          );
          return s!;
        });
      } catch (e) {
        // 23505 = the (extremely unlikely) join-code collision with another open session: draw a new code.
        if ((e as { code?: string }).code !== "23505") throw e;
      }
    }
    if (!session) throw new Error("could not allocate a join code");
    await audit(db, { action: "session.create", actorUserId: actor.id, institutionId: quiz.institutionId, targetType: "quiz_session", targetId: session.id, ip: req.ip });
    return reply.status(201).send({ session });
  });

  app.get("/institutions/:id/sessions", async (req) => {
    const { id } = parse(idParam, req.params);
    app.authorize(req, "sessions.host", { institutionId: id });
    const rows = await db
      .select({ session: quizSessions, participants: sql<number>`(select count(*)::int from session_participants sp where sp.session_id = ${quizSessions.id})` })
      .from(quizSessions)
      .where(eq(quizSessions.institutionId, id))
      .orderBy(desc(quizSessions.createdAt))
      .limit(30);
    return { sessions: rows.map((r) => ({ ...r.session, status: effectiveStatus(r.session), participants: r.participants })) };
  });

  app.post("/sessions/:id/start", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, row: s } = await sessionFor(req, id, "sessions.host");
    if (s.status !== "lobby") throw conflict("This session has already started");
    const now = new Date();
    const dur = s.settings.durationMinutes;
    const [u] = await db
      .update(quizSessions)
      .set({ status: "active", startedAt: now, endsAt: dur ? new Date(now.getTime() + dur * 60_000) : null })
      .where(and(eq(quizSessions.id, id), eq(quizSessions.status, "lobby")))
      .returning();
    if (!u) throw conflict("This session has already started");
    await audit(db, { action: "session.start", actorUserId: actor.id, institutionId: s.institutionId, targetType: "quiz_session", targetId: id, ip: req.ip });
    void app.hub.broadcastNow(id, "status");
    return { session: u };
  });

  app.post("/sessions/:id/end", async (req) => {
    const { id } = parse(idParam, req.params);
    const { actor, row: s } = await sessionFor(req, id, "sessions.host");
    if (s.status === "ended") return { session: s };
    const [u] = await db.update(quizSessions).set({ status: "ended", endedAt: new Date() }).where(eq(quizSessions.id, id)).returning();
    await audit(db, { action: "session.end", actorUserId: actor.id, institutionId: s.institutionId, targetType: "quiz_session", targetId: id, ip: req.ip });
    void app.hub.broadcastNow(id, "status");
    return { session: u };
  });

  /** Teacher's view: everyone's standing with real names, plus how each question went. */
  app.get("/sessions/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const { row: s } = await sessionFor(req, id, "sessions.host");
    const status = effectiveStatus(s);
    const ranked = await app.leaderboard.topFromDb(id, 500);
    const people = await db
      .select({ p: sessionParticipants, fullName: users.fullName })
      .from(sessionParticipants)
      .innerJoin(users, eq(users.id, sessionParticipants.userId))
      .where(eq(sessionParticipants.sessionId, id));
    const byId = new Map(people.map((x) => [x.p.id, x]));
    const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, id));
    const qs = await db.select().from(sessionQuestions).where(eq(sessionQuestions.sessionId, id)).orderBy(sessionQuestions.position);
    const stats = await db
      .select({ position: sessionAnswers.questionPosition, answered: sql<number>`count(*)::int`, correct: sql<number>`count(*) filter (where ${sessionAnswers.correct})::int`, avgMs: sql<number>`coalesce(avg(${sessionAnswers.timeMs}),0)::int` })
      .from(sessionAnswers)
      .where(eq(sessionAnswers.sessionId, id))
      .groupBy(sessionAnswers.questionPosition);
    return {
      session: { ...s, status },
      totalQuestions: total?.n ?? 0,
      participants: ranked.map((r) => {
        const x = byId.get(r.participantId)!;
        return { rank: r.rank, displayName: x.p.displayName, fullName: x.fullName, points: x.p.totalPoints, correct: x.p.correctCount, answered: x.p.answeredCount, finished: !!x.p.finishedAt };
      }),
      questions: qs.map((q) => {
        const st = stats.find((t) => t.position === q.position);
        return { position: q.position, stem: q.stem, type: q.type, answered: st?.answered ?? 0, correct: st?.correct ?? 0, avgMs: st?.avgMs ?? 0 };
      }),
    };
  });
}
