import { and, eq, sql } from "drizzle-orm";
import type { AnswerInput } from "@tmp/shared";
import type { Db } from "../db/client.js";
import { sessionAnswers, sessionParticipants, sessionQuestions, type Participant, type QuizSession } from "../db/schema.js";
import { HttpError, conflict } from "../errors.js";
import { answerFits, markAnswer, publicQuestion, reveal, type QuestionRow } from "./marking.js";
import { shuffled } from "./order.js";
import { GRACE_MS, computePoints } from "./scoring.js";

/** "Active" sessions with a deadline that has passed are ended, whether or not anyone has flipped the flag yet. */
export function effectiveStatus(s: Pick<QuizSession, "status" | "endsAt">, now = new Date()) {
  return s.status === "active" && s.endsAt && s.endsAt.getTime() <= now.getTime() ? "ended" : s.status;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function questionAt(tx: Tx | Db, sessionId: string, position: number): Promise<QuestionRow> {
  const [q] = await tx.select().from(sessionQuestions).where(and(eq(sessionQuestions.sessionId, sessionId), eq(sessionQuestions.position, position))).limit(1);
  if (!q) throw new HttpError(500, "internal_error", "Question missing");
  return q;
}

export interface Totals { totalPoints: number; totalTimeMs: number; correctCount: number; answeredCount: number }

/** Write one answer and advance the participant. Caller holds the participant row lock. */
async function record(
  tx: Tx, session: QuizSession, p: Participant, total: number, given: AnswerInput["answer"], elapsedMs: number, forceLate = false,
) {
  const position = p.questionOrder[p.currentIndex]!;
  const q = await questionAt(tx, session.id, position);
  const limitMs = session.settings.timePerQuestionSec * 1000;
  const correct = !forceLate && markAnswer(q, given);
  const { points, late } = forceLate ? { points: 0, late: true } : computePoints({ correct, marks: q.marks, elapsedMs, limitMs });
  const counted = late ? false : correct;
  const timeMs = Math.min(elapsedMs, limitMs + GRACE_MS);
  await tx.insert(sessionAnswers).values({
    participantId: p.id, sessionId: session.id, index: p.currentIndex, questionPosition: position,
    answer: given, correct: counted, late, points, timeMs,
  });
  const nextIndex = p.currentIndex + 1;
  const finished = nextIndex >= total;
  const [updated] = await tx
    .update(sessionParticipants)
    .set({
      currentIndex: nextIndex, questionServedAt: null,
      totalPoints: sql`${sessionParticipants.totalPoints} + ${points}`,
      totalTimeMs: sql`${sessionParticipants.totalTimeMs} + ${timeMs}`,
      correctCount: sql`${sessionParticipants.correctCount} + ${counted ? 1 : 0}`,
      answeredCount: sql`${sessionParticipants.answeredCount} + 1`,
      finishedAt: finished ? new Date() : null,
    })
    .where(eq(sessionParticipants.id, p.id))
    .returning();
  return { q, counted, late, points, finished, updated: updated! };
}

async function lock(tx: Tx, participantId: string) {
  const [p] = await tx.select().from(sessionParticipants).where(eq(sessionParticipants.id, participantId)).for("update").limit(1);
  return p!;
}

/** Questions the participant left unanswered past the time limit (e.g. closed the tab) are settled as late and skipped. */
async function settleTimeouts(tx: Tx, session: QuizSession, p0: Participant, total: number, now: Date) {
  let p = p0;
  const limitMs = session.settings.timePerQuestionSec * 1000;
  while (p.currentIndex < total && p.questionServedAt && now.getTime() - p.questionServedAt.getTime() > limitMs + GRACE_MS) {
    p = (await record(tx, session, p, total, null, limitMs + GRACE_MS, true)).updated;
  }
  return p;
}

const summary = (p: Participant, total: number) => ({
  points: p.totalPoints, correct: p.correctCount, answered: p.answeredCount, total,
});

export type PlayState =
  | { status: "lobby" }
  | { status: "active"; index: number; total: number; limitSec: number; remainingMs: number; question: ReturnType<typeof publicQuestion>; points: number }
  | { status: "finished" | "ended"; result: ReturnType<typeof summary> };

/** What this participant should see right now. Serving a question starts ITS server-side clock. */
export async function getPlayState(db: Db, session: QuizSession, participantId: string, now = new Date()): Promise<{ state: PlayState; totals: Totals; changed: boolean }> {
  return db.transaction(async (tx) => {
    let p = await lock(tx, participantId);
    const [cnt] = await tx.select({ n: sql<number>`count(*)::int` }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, session.id));
    const total = cnt?.n ?? 0;
    const status = effectiveStatus(session, now);
    const totals = () => ({ totalPoints: p.totalPoints, totalTimeMs: p.totalTimeMs, correctCount: p.correctCount, answeredCount: p.answeredCount });
    if (status === "lobby") return { state: { status: "lobby" as const }, totals: totals(), changed: false };
    if (status === "ended") return { state: { status: "ended" as const, result: summary(p, total) }, totals: totals(), changed: false };

    const before = p.answeredCount;
    p = await settleTimeouts(tx, session, p, total, now);
    const changed = p.answeredCount !== before;
    if (p.currentIndex >= total) return { state: { status: "finished" as const, result: summary(p, total) }, totals: totals(), changed };

    if (!p.questionServedAt) {
      const [u] = await tx.update(sessionParticipants).set({ questionServedAt: now }).where(and(eq(sessionParticipants.id, p.id), sql`${sessionParticipants.questionServedAt} is null`)).returning();
      if (u) p = u;
    }
    const q = await questionAt(tx, session.id, p.questionOrder[p.currentIndex]!);
    const limitMs = session.settings.timePerQuestionSec * 1000;
    const served = (p.questionServedAt ?? now).getTime();
    const optionOrder = (ids: string[]) => (session.settings.shuffleOptions ? shuffled(ids, `${p.id}:${p.currentIndex}`) : ids);
    return {
      state: {
        status: "active" as const, index: p.currentIndex, total, limitSec: session.settings.timePerQuestionSec,
        remainingMs: Math.max(0, limitMs - (now.getTime() - served)), question: publicQuestion(q, optionOrder), points: p.totalPoints,
      },
      totals: totals(), changed,
    };
  });
}

export async function submitAnswer(db: Db, session: QuizSession, participantId: string, input: AnswerInput, now = new Date()) {
  return db.transaction(async (tx) => {
    const p = await lock(tx, participantId);
    const [cnt] = await tx.select({ n: sql<number>`count(*)::int` }).from(sessionQuestions).where(eq(sessionQuestions.sessionId, session.id));
    const total = cnt?.n ?? 0;
    const status = effectiveStatus(session, now);
    if (status === "lobby") throw conflict("This quiz hasn't started yet");

    // A repeat of an answer we already hold gets the SAME result back, even after the session has ended.
    if (input.index < p.currentIndex) {
      const [prev] = await tx.select().from(sessionAnswers).where(and(eq(sessionAnswers.participantId, p.id), eq(sessionAnswers.index, input.index))).limit(1);
      if (!prev) throw conflict("That question has already moved on");
      const q = await questionAt(tx, session.id, prev.questionPosition);
      return { replayed: true, correct: prev.correct, late: prev.late, points: prev.points, finished: p.currentIndex >= total, ...reveal(q), totals: { totalPoints: p.totalPoints, totalTimeMs: p.totalTimeMs, correctCount: p.correctCount, answeredCount: p.answeredCount }, participantId: p.id, changed: false };
    }
    if (status === "ended") throw new HttpError(409, "session_ended", "This quiz has ended");
    // No timeout-settling here: an answer that arrives late for the CURRENT question is recorded as late (0 points)
    // rather than refused, so a slow connection never turns into an error screen.
    if (input.index !== p.currentIndex || p.currentIndex >= total) throw conflict("That question has already moved on");
    if (!p.questionServedAt) throw conflict("Load the question before answering it");

    const q = await questionAt(tx, session.id, p.questionOrder[p.currentIndex]!);
    if (!answerFits(q.type, input.answer)) throw new HttpError(400, "bad_request", "That answer doesn't fit this question");
    const elapsedMs = Math.max(0, now.getTime() - p.questionServedAt.getTime());
    const r = await record(tx, session, p, total, input.answer, elapsedMs);
    const u = r.updated;
    return {
      replayed: false, correct: r.counted, late: r.late, points: r.points, finished: r.finished, ...reveal(r.q),
      totals: { totalPoints: u.totalPoints, totalTimeMs: u.totalTimeMs, correctCount: u.correctCount, answeredCount: u.answeredCount }, participantId: u.id, changed: true,
    };
  });
}
