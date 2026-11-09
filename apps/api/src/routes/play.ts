import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { answerSchema, joinSessionSchema, normaliseJoinCode } from "@tmp/shared";
import { audit } from "../audit.js";
import type { Actor } from "../authz/can.js";
import { classMembers, quizSessions, sessionParticipants, sessionQuestions } from "../db/schema.js";
import { HttpError, forbidden, notFound, parse } from "../errors.js";
import { can } from "../authz/can.js";
import { shuffled } from "../quiz/order.js";
import { LiveHub } from "../quiz/hub.js";
import { effectiveStatus, getPlayState, submitAnswer } from "../quiz/play.js";

const idParam = z.object({ id: z.string().uuid() });
const MAX_PARTICIPANTS = 2000;

/** Students are people with an ACTIVE student membership in an ACTIVE school. Platform staff don't play. */
const isStudentOf = (actor: Actor, institutionId: string) =>
  actor.memberships.some((m) => m.institutionId === institutionId && m.role === "student" && m.membershipStatus === "active" && m.institutionStatus === "active");

const defaultName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.` : parts[0]!.slice(0, 24);
};

export async function playRoutes(app: FastifyInstance) {
  const { db } = app.deps;
  const notFoundForCode = () => new HttpError(404, "not_found", "No open quiz found for that code");

  /** Enter a code. Every failure looks the same, so codes can't be used to probe other schools. */
  app.post("/sessions/join", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const actor = app.requireActor(req);
    const input = parse(joinSessionSchema, req.body);
    const code = normaliseJoinCode(input.code);
    const [s] = await db.select().from(quizSessions).where(and(eq(quizSessions.joinCode, code), sql`${quizSessions.status} <> 'ended'`)).limit(1);
    if (!s || effectiveStatus(s) === "ended") throw notFoundForCode();
    if (!isStudentOf(actor, s.institutionId)) {
      await audit(db, { action: "session.join_denied", actorUserId: actor.id, institutionId: s.institutionId, outcome: "denied", ip: req.ip });
      throw notFoundForCode();
    }
    if (s.classId) {
      const [m] = await db.select().from(classMembers).where(and(eq(classMembers.classId, s.classId), eq(classMembers.userId, actor.id))).limit(1);
      if (!m) throw notFoundForCode();
    }

    let [p] = await db.select().from(sessionParticipants).where(and(eq(sessionParticipants.sessionId, s.id), eq(sessionParticipants.userId, actor.id))).limit(1);
    let created = false;
    if (!p) {
      const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(sessionParticipants).where(eq(sessionParticipants.sessionId, s.id));
      if ((n?.n ?? 0) >= MAX_PARTICIPANTS) throw new HttpError(409, "session_full", "This quiz is full");
      const positions = (await db.select({ position: sessionQuestions.position }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, s.id)).orderBy(sessionQuestions.position)).map((r) => r.position);
      const order = s.settings.shuffleQuestions ? shuffled(positions, `${s.id}:${actor.id}`) : positions;
      const [ins] = await db
        .insert(sessionParticipants)
        .values({ sessionId: s.id, userId: actor.id, displayName: input.displayName ?? defaultName(actor.fullName), questionOrder: order })
        .onConflictDoNothing()
        .returning();
      created = !!ins;
      p = ins ?? (await db.select().from(sessionParticipants).where(and(eq(sessionParticipants.sessionId, s.id), eq(sessionParticipants.userId, actor.id))).limit(1))[0]!;
    }
    if (created) {
      await app.leaderboard.record(s.id, p!.id, 0, 0);
      app.hub.schedule(s.id);
    }
    return reply.status(created ? 201 : 200).send({ sessionId: s.id, title: s.settings.title, status: effectiveStatus(s), displayName: p!.displayName });
  });

  /** Participant lookup + the checks every play route needs. Non-participants get 403 (no existence leak). */
  async function mine(req: FastifyRequest, sessionId: string) {
    const actor = app.requireActor(req);
    const [s] = await db.select().from(quizSessions).where(eq(quizSessions.id, sessionId)).limit(1);
    const [p] = s ? await db.select().from(sessionParticipants).where(and(eq(sessionParticipants.sessionId, sessionId), eq(sessionParticipants.userId, actor.id))).limit(1) : [];
    if (!s || !p || !isStudentOf(actor, s.institutionId)) throw forbidden();
    return { actor, s, p };
  }

  app.get("/sessions/:id/play", async (req) => {
    const { id } = parse(idParam, req.params);
    const { s, p } = await mine(req, id);
    const r = await getPlayState(db, s, p.id);
    if (r.changed) {
      await app.leaderboard.record(id, p.id, r.totals.totalPoints, r.totals.totalTimeMs);
      app.hub.schedule(id);
    }
    return { ...r.state, showLeaderboard: s.settings.showLeaderboard, title: s.settings.title };
  });

  app.post("/sessions/:id/answer", async (req) => {
    const { id } = parse(idParam, req.params);
    const { s, p } = await mine(req, id);
    const input = parse(answerSchema, req.body);
    const r = await submitAnswer(db, s, p.id, input);
    if (r.changed) {
      await app.leaderboard.record(id, p.id, r.totals.totalPoints, r.totals.totalTimeMs);
      app.hub.schedule(id);
    }
    const rank = await app.leaderboard.rankOf(id, p.id);
    return {
      correct: r.correct, late: r.late, points: r.points, totalPoints: r.totals.totalPoints, finished: r.finished, replayed: r.replayed,
      correctAnswer: r.correctAnswer, explanation: r.explanation,
      rank: s.settings.showLeaderboard || r.finished ? rank : null,
    };
  });

  /**
   * Leaderboard over plain HTTP: the polling fallback for clients that can't hold a WebSocket.
   * Teachers get everyone; students get the top 10 (if the quiz shows it) plus their own standing.
   */
  app.get("/sessions/:id/leaderboard", async (req) => {
    const { id } = parse(idParam, req.params);
    const actor = app.requireActor(req);
    const [s] = await db.select().from(quizSessions).where(eq(quizSessions.id, id)).limit(1);
    if (!s) {
      if (can(actor, "sessions.host")) throw notFound("Not found");
      throw forbidden();
    }
    const event = await app.hub.snapshot(id);
    if (can(actor, "sessions.host", { institutionId: s.institutionId })) return { role: "host", ...event };
    const { p } = await mine(req, id);
    const view = LiveHub.view(event!, "player");
    return { role: "player", ...view, me: { rank: await app.leaderboard.rankOf(id, p.id), points: p.totalPoints } };
  });
}
