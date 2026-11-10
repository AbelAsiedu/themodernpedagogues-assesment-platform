import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { markEssaySchema, type Permission } from "@tmp/shared";
import { MARK_PROMPT_VERSION, proposeMark } from "../ai/markingGen.js";
import { AiProviderError } from "../ai/provider.js";
import { audit } from "../audit.js";
import { can } from "../authz/can.js";
import { aiGenerations, aiMarkProposals, examMarkEvents, examMarks, examResponses, examSessions, examSittings, sittingItems, users } from "../db/schema.js";
import { isAnswered } from "../exam/answers.js";
import { answerText, hashText, markEssay, rubricOf } from "../exam/marking.js";
import { HttpError, badRequest, conflict, forbidden, notFound, parse } from "../errors.js";

const idParam = z.object({ id: z.string().uuid() });
const markPath = z.object({ id: z.string().uuid(), position: z.coerce.number().int().min(0).max(1000) });

/** Teacher side of marking written answers. The AI part only ever proposes; marks are always a person's. */
export async function markingRoutes(app: FastifyInstance) {
  const { db, config, ai } = app.deps;

  async function load<T extends { institutionId: string }>(req: FastifyRequest, row: T | undefined, permission: Permission) {
    const actor = app.requireActor(req);
    if (!row) {
      if (can(actor, permission)) throw notFound("Not found");
      throw forbidden();
    }
    app.authorize(req, permission, { institutionId: row.institutionId });
    return { actor, row };
  }
  const sittingFor = async (req: FastifyRequest, id: string) => load(req, (await db.select().from(examSittings).where(eq(examSittings.id, id)).limit(1))[0], "exams.manage");
  /** An attempt is authorised through ITS sitting's institution. */
  async function sessionFor(req: FastifyRequest, id: string) {
    const [r] = await db.select({ s: examSessions, institutionId: examSittings.institutionId, sittingTitle: examSittings.title }).from(examSessions).innerJoin(examSittings, eq(examSittings.id, examSessions.sittingId)).where(eq(examSessions.id, id)).limit(1);
    return load(req, r, "exams.manage");
  }

  /** Everything a marker needs: each written question with every submitted answer to it, the rubric, any mark and any AI suggestion. */
  app.get("/sittings/:id/marking", async (req) => {
    const { id } = parse(idParam, req.params);
    const { row: sitting } = await sittingFor(req, id);
    const essays = await db.select().from(sittingItems).where(and(eq(sittingItems.sittingId, id), eq(sittingItems.type, "essay"))).orderBy(asc(sittingItems.position));
    if (!essays.length) return { sitting: { id, title: sitting.title }, essays: [], counts: { answers: 0, marked: 0, pending: 0 }, ai: { configured: !!ai } };
    const sessions = await db.select({ id: examSessions.id, userId: examSessions.userId, fullName: users.fullName }).from(examSessions).innerJoin(users, eq(users.id, examSessions.userId)).where(and(eq(examSessions.sittingId, id), eq(examSessions.status, "submitted"))).orderBy(users.fullName);
    const ids = sessions.map((s) => s.id);
    const positions = essays.map((e) => e.position);
    const [responses, marks, proposals] = ids.length ? await Promise.all([
      db.select().from(examResponses).where(and(inArray(examResponses.sessionId, ids), inArray(examResponses.itemPosition, positions))),
      db.select({ m: examMarks, markerName: users.fullName }).from(examMarks).leftJoin(users, eq(users.id, examMarks.markedBy)).where(and(inArray(examMarks.sessionId, ids), inArray(examMarks.itemPosition, positions))),
      db.select().from(aiMarkProposals).where(and(inArray(aiMarkProposals.sessionId, ids), inArray(aiMarkProposals.itemPosition, positions))).orderBy(desc(aiMarkProposals.createdAt)),
    ]) : [[], [], []];
    const key = (s: string, p: number) => `${s}:${p}`;
    const respOf = new Map(responses.map((r) => [key(r.sessionId, r.itemPosition), r]));
    const markOf = new Map(marks.map((m) => [key(m.m.sessionId, m.m.itemPosition), m]));
    const propOf = new Map<string, (typeof proposals)[number]>();
    for (const p of proposals) if (!propOf.has(key(p.sessionId, p.itemPosition))) propOf.set(key(p.sessionId, p.itemPosition), p); // newest first
    let answers = 0, marked = 0;
    const out = essays.map((e) => {
      const list = [];
      for (const s of sessions) {
        const r = respOf.get(key(s.id, e.position));
        if (!r || !isAnswered(r.answer)) continue;
        const mk = markOf.get(key(s.id, e.position));
        const pr = propOf.get(key(s.id, e.position));
        answers++; if (mk) marked++;
        list.push({
          sessionId: s.id, userId: s.userId, fullName: s.fullName, text: answerText(r.answer),
          mark: mk ? { awarded: mk.m.awarded, criteria: mk.m.criteria ?? [], comment: mk.m.comment, markedBy: mk.markerName, markedAt: mk.m.markedAt } : null,
          proposal: pr ? { id: pr.id, criteria: pr.criteria, total: pr.proposedTotal, reasoning: pr.reasoning, missingPoints: pr.missingPoints, confidence: pr.confidence, used: pr.status === "used", answerChanged: pr.answerHash !== hashText(answerText(r.answer)), model: pr.model, at: pr.createdAt } : null,
        });
      }
      return { position: e.position, stem: e.stem, marks: e.marks, rubric: rubricOf(e.content), answers: list };
    });
    return { sitting: { id, title: sitting.title }, essays: out, counts: { answers, marked, pending: answers - marked }, ai: { configured: !!ai } };
  });

  /** Set or change a person's mark for one essay answer. */
  app.put("/exam-sessions/:id/marks/:position", async (req) => {
    const { id, position } = parse(markPath, req.params);
    const { actor, row } = await sessionFor(req, id);
    const input = parse(markEssaySchema, req.body);
    const r = await markEssay(db, { sessionId: id, position, actorId: actor.id, input });
    if (r.changed) {
      await audit(db, { action: r.action === "adjust" ? "mark.adjust" : "mark.set", actorUserId: actor.id, institutionId: row.institutionId, targetType: "exam_session", targetId: id, ip: req.ip, metadata: { position, awarded: r.awarded, fromAi: !!input.proposalId } });
    }
    return { awarded: r.awarded, changed: r.changed };
  });

  /** Who marked this, what it was before, and why it changed. */
  app.get("/exam-sessions/:id/marks/:position/history", async (req) => {
    const { id, position } = parse(markPath, req.params);
    await sessionFor(req, id);
    const rows = await db.select({ e: examMarkEvents, actorName: users.fullName }).from(examMarkEvents).leftJoin(users, eq(users.id, examMarkEvents.actorId)).where(and(eq(examMarkEvents.sessionId, id), eq(examMarkEvents.itemPosition, position))).orderBy(asc(examMarkEvents.at), asc(examMarkEvents.id));
    return { events: rows.map(({ e, actorName }) => ({ at: e.at, by: actorName, action: e.action, previous: e.previousAwarded, awarded: e.awarded, reason: e.reason, fromAi: !!e.aiProposalId })) };
  });

  /**
   * Ask the AI to SUGGEST a mark for one answer. The suggestion is stored apart from marks, is never counted, never shown to students,
   * and only the marker can turn it into a mark. The student's name is not sent: only the question, rubric and answer text.
   */
  app.post("/exam-sessions/:id/marks/:position/ai-proposal", { config: { rateLimit: { max: config.AI_RATE_LIMIT_PER_MIN, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { id, position } = parse(markPath, req.params);
    const { actor, row } = await sessionFor(req, id);
    app.authorize(req, "ai.generate", { institutionId: row.institutionId });
    if (!ai) throw new HttpError(503, "ai_not_configured", "AI suggestions aren't set up on this server yet");
    if (row.s.status !== "submitted") throw conflict("This attempt hasn't been submitted yet");
    const [item] = await db.select().from(sittingItems).where(and(eq(sittingItems.sittingId, row.s.sittingId), eq(sittingItems.position, position))).limit(1);
    if (!item || item.type !== "essay") throw badRequest("AI suggestions are only for written (essay) answers");
    const [resp] = await db.select().from(examResponses).where(and(eq(examResponses.sessionId, id), eq(examResponses.itemPosition, position))).limit(1);
    if (!resp || !isAnswered(resp.answer)) throw badRequest("The student didn't write an answer to this question");
    const [mk] = await db.select({ method: examMarks.method }).from(examMarks).where(and(eq(examMarks.sessionId, id), eq(examMarks.itemPosition, position))).limit(1);
    if (mk) throw conflict("This answer already has a mark. Change it directly if you need to");

    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(aiGenerations).where(and(eq(aiGenerations.requestedBy, actor.id), gt(aiGenerations.createdAt, since)));
    if ((used?.n ?? 0) >= config.AI_DAILY_LIMIT_PER_USER) throw new HttpError(429, "ai_quota", `Daily AI limit reached (${config.AI_DAILY_LIMIT_PER_USER} requests per 24 hours)`);

    const text = answerText(resp.answer);
    const rubric = rubricOf(item.content);
    const started = Date.now();
    const log = { institutionId: row.institutionId, requestedBy: actor.id, provider: ai.name, promptVersion: MARK_PROMPT_VERSION, params: { kind: "mark_proposal", position }, requestedCount: 1 };
    try {
      const out = await proposeMark(ai, { stem: item.stem, rubric, answer: text });
      const saved = await db.transaction(async (tx) => {
        await tx.insert(aiGenerations).values({ ...log, model: out.model, status: "succeeded", savedCount: 1, tokensIn: out.inputTokens, tokensOut: out.outputTokens, latencyMs: Date.now() - started });
        const [p] = await tx.insert(aiMarkProposals).values({
          sessionId: id, itemPosition: position, requestedBy: actor.id, provider: ai.name, model: out.model, promptVersion: MARK_PROMPT_VERSION, answerHash: hashText(text),
          criteria: out.proposal.criteria, proposedTotal: out.proposal.total, reasoning: out.proposal.reasoning, missingPoints: out.proposal.missingPoints, confidence: out.proposal.confidence,
        }).returning();
        return p!;
      });
      await audit(db, { action: "mark.ai_proposal", actorUserId: actor.id, institutionId: row.institutionId, targetType: "exam_session", targetId: id, ip: req.ip, metadata: { position, model: out.model, confidence: out.proposal.confidence } });
      return reply.status(201).send({ proposal: { id: saved.id, criteria: saved.criteria, total: saved.proposedTotal, reasoning: saved.reasoning, missingPoints: saved.missingPoints, confidence: saved.confidence, used: false, answerChanged: false, model: saved.model, at: saved.createdAt } });
    } catch (e) {
      const err = e instanceof AiProviderError ? e : null;
      await db.insert(aiGenerations).values({ ...log, model: ai.model, status: "failed", latencyMs: Date.now() - started, error: err ? `${err.kind}: ${err.message}` : "unexpected_error" });
      if (!err) throw e;
      throw new HttpError(err.kind === "rate_limit" ? 429 : err.kind === "timeout" ? 504 : 502, `ai_${err.kind}`, err.message);
    }
  });
}
