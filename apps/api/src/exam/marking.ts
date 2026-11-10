import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { MarkEssayInput } from "@tmp/shared";
import type { Db } from "../db/client.js";
import { aiMarkProposals, examMarkEvents, examMarks, examResponses, examSessions, sittingItems, type CriterionAward } from "../db/schema.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { isAnswered } from "./answers.js";

export interface RubricPoint { point: string; marks: number }

export const rubricOf = (content: Record<string, unknown>): RubricPoint[] => ((content as { rubric?: RubricPoint[] }).rubric ?? []);
export const answerText = (answer: unknown): string => (typeof (answer as { text?: unknown } | null)?.text === "string" ? (answer as { text: string }).text : "");
export const hashText = (t: string) => createHash("sha256").update(t).digest("hex");

/** Round away floating-point dust (0.1 + 0.2) without hiding real half marks. */
export const tidy = (n: number) => Math.round(n * 1000) / 1000;
const same = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? a == b : Math.abs(a - b) < 1e-9);

/** Check a marker's per-point awards against the rubric that was frozen into the sitting. */
export function checkCriteria(rubric: RubricPoint[], criteria: number[]): CriterionAward[] {
  if (criteria.length !== rubric.length) throw badRequest(`This answer is marked against ${rubric.length} rubric point${rubric.length === 1 ? "" : "s"}, so give ${rubric.length} value${rubric.length === 1 ? "" : "s"}`);
  const bad = criteria.findIndex((c, i) => c > rubric[i]!.marks + 1e-9);
  if (bad >= 0) throw badRequest(`Point ${bad + 1} is worth at most ${rubric[bad]!.marks}`);
  return criteria.map((awarded, index) => ({ index, awarded: tidy(awarded) }));
}

/**
 * Set or change a person's mark for one essay answer.
 *  - only essays, only on a SUBMITTED attempt, only if something was written
 *  - per-point awards within the frozen rubric; the total is computed here, never trusted from the client
 *  - first mark: no reason needed. Changing a mark: a reason is required and recorded
 *  - `basedOn` must equal the current mark, so concurrent markers conflict instead of overwriting each other
 *  - every change appends a history row in the same transaction
 * Idempotent: repeating exactly the same mark changes nothing and writes no history.
 */
export async function markEssay(db: Db, p: { sessionId: string; position: number; actorId: string; input: MarkEssayInput }) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(examSessions).where(eq(examSessions.id, p.sessionId)).for("share").limit(1);
    if (!s) throw notFound("Not found");
    if (s.status !== "submitted") throw conflict("This attempt hasn't been submitted yet, so it can't be marked");
    const [item] = await tx.select().from(sittingItems).where(and(eq(sittingItems.sittingId, s.sittingId), eq(sittingItems.position, p.position))).limit(1);
    if (!item) throw notFound("Not found");
    if (item.type !== "essay") throw badRequest("Only written (essay) answers are marked by hand. The rest are marked automatically");
    const [resp] = await tx.select().from(examResponses).where(and(eq(examResponses.sessionId, p.sessionId), eq(examResponses.itemPosition, p.position))).limit(1);
    if (!resp || !isAnswered(resp.answer)) throw badRequest("The student didn't write an answer to this question");

    const rubric = rubricOf(item.content);
    const criteria = checkCriteria(rubric, p.input.criteria);
    const total = tidy(criteria.reduce((a, c) => a + c.awarded, 0));
    const comment = p.input.comment || null;

    if (p.input.proposalId) {
      const [prop] = await tx.select().from(aiMarkProposals).where(and(eq(aiMarkProposals.id, p.input.proposalId), eq(aiMarkProposals.sessionId, p.sessionId), eq(aiMarkProposals.itemPosition, p.position))).limit(1);
      if (!prop) throw badRequest("That AI suggestion doesn't belong to this answer");
    }

    const [current] = await tx.select().from(examMarks).where(and(eq(examMarks.sessionId, p.sessionId), eq(examMarks.itemPosition, p.position))).for("update").limit(1);
    if (!same(current?.awarded ?? null, p.input.basedOn)) throw conflict("Someone else changed this mark while you were working. Reload to see the latest mark.");
    if (current && current.method !== "manual") throw conflict("This answer was marked automatically");

    if (current) {
      const unchanged = same(current.awarded, total) && (current.comment ?? null) === comment && JSON.stringify(current.criteria ?? []) === JSON.stringify(criteria);
      if (unchanged) return { awarded: current.awarded, changed: false, action: null as null };
      if (!p.input.reason) throw badRequest("Say briefly why you are changing this mark");
    }

    const values = { sessionId: p.sessionId, itemPosition: p.position, awarded: total, maxMarks: item.marks, method: "manual" as const, markedBy: p.actorId, criteria, comment, markedAt: new Date() };
    if (current) {
      await tx.update(examMarks).set(values).where(and(eq(examMarks.sessionId, p.sessionId), eq(examMarks.itemPosition, p.position)));
    } else {
      const ins = await tx.insert(examMarks).values(values).onConflictDoNothing().returning({ sessionId: examMarks.sessionId });
      if (!ins.length) throw conflict("Someone else marked this answer while you were working. Reload to see their mark.");
    }
    const action = current ? ("adjust" as const) : ("mark" as const);
    await tx.insert(examMarkEvents).values({
      sessionId: p.sessionId, itemPosition: p.position, actorId: p.actorId, action, previousAwarded: current?.awarded ?? null,
      awarded: total, criteria, reason: current ? p.input.reason! : null, aiProposalId: p.input.proposalId ?? null,
    });
    if (p.input.proposalId) await tx.update(aiMarkProposals).set({ status: "used" }).where(eq(aiMarkProposals.id, p.input.proposalId));
    return { awarded: total, changed: true, action };
  });
}

