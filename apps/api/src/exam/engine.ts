import { createHash, randomInt } from "node:crypto";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { JOIN_CODE_ALPHABET, describeRule, type ExamAnswer } from "@tmp/shared";
import type { Db } from "../db/client.js";
import {
  examMarks, examResponseVersions, examResponses, examSessions, examSittings, examSubmissions, sittingItems, sittingSections,
  type ExamSession, type ExamSitting,
} from "../db/schema.js";
import { HttpError, conflict, notFound } from "../errors.js";
import { publicQuestion } from "../quiz/marking.js";
import { shuffled } from "../quiz/order.js";
import { autoMarks, fits, isAnswered, isAutoMarked } from "./answers.js";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Network latency allowance. A save is accepted until deadline + this; the sweeper auto-submits after it.
 * Kept small on purpose: the deadline is the server's, and this only stops a last-second save from being lost.
 */
export const SAVE_GRACE_MS = 3000;

export type SubmitKind = "student" | "auto";

const newReceipt = () => {
  const c = Array.from({ length: 10 }, () => JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)]).join("");
  return `${c.slice(0, 5)}-${c.slice(5)}`;
};

/**
 * The examination engine. Principles (see docs/EXAMINATION_ENGINE.md):
 *  1. The server owns time. Candidates never decide when an exam ends.
 *  2. Never lose an answer: saving is small, idempotent and ordered by a sequence number.
 *  3. Submitting is idempotent and contains no marking and no AI. Marking runs afterwards and can fail without harming a submission.
 */
export class ExamEngine {
  /** Replaceable in tests. Everything time-related goes through this, never `new Date()` directly. */
  clock: () => Date = () => new Date();
  private pending = new Set<Promise<unknown>>();

  constructor(private db: Db, private log: (m: string, e?: unknown) => void = () => {}) {}

  now() { return this.clock(); }

  /** Resolves when background marking has finished. Used by tests and graceful shutdown. */
  async idle() { while (this.pending.size) await Promise.allSettled([...this.pending]); }

  private background(p: Promise<unknown>) {
    const tracked = p.catch((e) => this.log("exam background task failed", e)).finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  /* ------------------------------------------------------------------ start */

  /** Begin (or resume) a candidate's attempt. The deadline is fixed here, by the server, and is idempotent. */
  async start(sitting: ExamSitting, userId: string): Promise<ExamSession> {
    const existing = await this.sessionOf(sitting.id, userId);
    if (existing) return existing;
    const now = this.now();
    if (sitting.status === "cancelled") throw new HttpError(409, "exam_cancelled", "This exam has been cancelled");
    if (now < sitting.opensAt) throw new HttpError(409, "exam_not_open", "This exam hasn't opened yet");
    if (now >= sitting.closesAt) throw new HttpError(409, "exam_closed", "This exam has closed");
    const deadline = new Date(Math.min(now.getTime() + sitting.durationMinutes * 60_000, sitting.closesAt.getTime()));
    const [row] = await this.db
      .insert(examSessions)
      .values({ sittingId: sitting.id, userId, startedAt: now, deadlineAt: deadline })
      .onConflictDoNothing()
      .returning();
    // Lost a race with our own double-click: the other request created it. Return that one.
    return row ?? (await this.sessionOf(sitting.id, userId))!;
  }

  async sessionOf(sittingId: string, userId: string) {
    const [s] = await this.db.select().from(examSessions).where(and(eq(examSessions.sittingId, sittingId), eq(examSessions.userId, userId))).limit(1);
    return s;
  }

  /* ------------------------------------------------------------------- view */

  /** Everything the exam room needs, with the answer key removed. Auto-submits first if time is up. */
  async view(userId: string, sessionId: string) {
    let s = await this.ownSession(userId, sessionId);
    if (this.isExpired(s)) {
      await this.submit(s.id, "auto");
      s = (await this.ownSession(userId, sessionId));
    }
    const [sitting] = await this.db.select().from(examSittings).where(eq(examSittings.id, s.sittingId)).limit(1);
    if (!sitting) throw notFound("Not found");
    const [sections, items, responses, [submission]] = await Promise.all([
      this.db.select().from(sittingSections).where(eq(sittingSections.sittingId, sitting.id)).orderBy(asc(sittingSections.position)),
      this.db.select().from(sittingItems).where(eq(sittingItems.sittingId, sitting.id)).orderBy(asc(sittingItems.position)),
      this.db.select().from(examResponses).where(eq(examResponses.sessionId, s.id)),
      this.db.select().from(examSubmissions).where(eq(examSubmissions.sessionId, s.id)).limit(1),
    ]);
    const now = this.now();
    return {
      session: {
        id: s.id, status: s.status, startedAt: s.startedAt, deadlineAt: s.deadlineAt, extensionMinutes: s.extensionMinutes,
        serverNow: now, remainingMs: s.status === "in_progress" ? Math.max(0, s.deadlineAt.getTime() - now.getTime()) : 0,
      },
      sitting: { id: sitting.id, title: sitting.title, instructions: sitting.instructions, durationMinutes: sitting.durationMinutes, resultsReleased: !!sitting.resultsReleasedAt },
      sections: sections.map((sec) => {
        const its = items.filter((i) => i.sectionPosition === sec.position);
        const rule = sec.ruleType === "answer_any" ? ({ type: "answer_any", count: sec.ruleCount! } as const) : ({ type: "answer_all" } as const);
        return {
          position: sec.position, title: sec.title, instructions: sec.instructions, rule, ruleText: describeRule(rule, its.length),
          items: its.map((i) => ({
            position: i.position,
            // Option order is stable per candidate and differs between candidates; never contains the key.
            ...publicQuestion(i, (ids) => (sitting.shuffleOptions ? shuffled(ids, `${s.id}:${i.position}`) : ids)),
          })),
        };
      }),
      responses: Object.fromEntries(responses.map((r) => [r.itemPosition, { seq: r.seq, answer: r.answer }])),
      submission: submission ? { receipt: submission.receipt, submittedAt: submission.submittedAt, kind: submission.kind, answeredCount: submission.answeredCount } : null,
    };
  }

  private async ownSession(userId: string, sessionId: string) {
    const [s] = await this.db.select().from(examSessions).where(eq(examSessions.id, sessionId)).limit(1);
    // Someone else's attempt looks exactly like a missing one.
    if (!s || s.userId !== userId) throw notFound("Not found");
    return s;
  }

  private isExpired(s: Pick<ExamSession, "status" | "deadlineAt">) {
    return s.status === "in_progress" && this.now().getTime() > s.deadlineAt.getTime() + SAVE_GRACE_MS;
  }

  /* ------------------------------------------------------------------- save */

  /**
   * Save one answer. Idempotent and order-safe: only a higher `seq` than what is stored changes anything, so a delayed
   * retry or an offline sync arriving late can never overwrite a newer answer. Returns whether this save was applied.
   */
  async save(userId: string, sessionId: string, position: number, seq: number, answer: ExamAnswer) {
    const outcome = await this.db.transaction(async (tx) => {
      // FOR SHARE: many saves run together, but a submit (FOR UPDATE) waits for them and later saves see "submitted".
      // Saves must never UPDATE this row: two saves holding shared locks would deadlock trying to upgrade them.
      const [s] = await tx.select().from(examSessions).where(eq(examSessions.id, sessionId)).for("share").limit(1);
      if (!s || s.userId !== userId) throw notFound("Not found");
      if (s.status !== "in_progress") throw new HttpError(409, "exam_submitted", "This exam has already been submitted");
      if (this.now().getTime() > s.deadlineAt.getTime() + SAVE_GRACE_MS) return { timeUp: true as const };
      const [item] = await tx.select({ type: sittingItems.type }).from(sittingItems).where(and(eq(sittingItems.sittingId, s.sittingId), eq(sittingItems.position, position))).limit(1);
      if (!item) throw notFound("No such question in this exam");
      if (!fits(item.type, answer)) throw new HttpError(400, "bad_answer", "That answer doesn't fit this question");

      const now = this.now();
      const applied = await tx
        .insert(examResponses)
        .values({ sessionId, itemPosition: position, seq, answer, savedAt: now })
        .onConflictDoUpdate({
          target: [examResponses.sessionId, examResponses.itemPosition],
          set: { seq, answer, savedAt: now },
          setWhere: lt(examResponses.seq, seq),
        })
        .returning({ seq: examResponses.seq });
      if (applied.length) {
        await tx.insert(examResponseVersions).values({ sessionId, itemPosition: position, seq, answer, savedAt: now }).onConflictDoNothing();
        return { timeUp: false as const, applied: true, seq };
      }
      const [cur] = await tx.select({ seq: examResponses.seq }).from(examResponses).where(and(eq(examResponses.sessionId, sessionId), eq(examResponses.itemPosition, position))).limit(1);
      return { timeUp: false as const, applied: false, seq: cur?.seq ?? seq };
    });
    if (outcome.timeUp) {
      await this.submit(sessionId, "auto"); // the time is up: end it now rather than wait for the sweeper
      throw new HttpError(409, "time_up", "Time is up. Your answers so far have been submitted.");
    }
    return { applied: outcome.applied, seq: outcome.seq };
  }

  /* ----------------------------------------------------------------- submit */

  /**
   * Submit. Idempotent: the second call (double click, retry, the sweeper racing the candidate) returns the first receipt.
   * Contains NO marking and NO AI: it validates, persists, and returns a receipt. Marking is queued afterwards.
   */
  async submit(sessionId: string, requestedKind: SubmitKind) {
    const result = await this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(examSessions).where(eq(examSessions.id, sessionId)).for("update").limit(1);
      if (!s) throw notFound("Not found");
      if (s.status !== "in_progress") return { ...(await this.receiptOf(tx, sessionId)), already: true as const, userId: s.userId, sittingId: s.sittingId };

      const rows = await tx.select().from(examResponses).where(eq(examResponses.sessionId, sessionId)).orderBy(asc(examResponses.itemPosition));
      const hash = createHash("sha256").update(JSON.stringify(rows.map((r) => [r.itemPosition, r.seq, r.answer ?? null]))).digest("hex");
      // A student pressing Submit after time ran out is recorded as an automatic submission, honestly.
      const late = this.now().getTime() > s.deadlineAt.getTime() + SAVE_GRACE_MS;
      const kind: SubmitKind = requestedKind === "auto" || late ? "auto" : "student";
      const now = this.now();
      const [sub] = await tx
        .insert(examSubmissions)
        .values({ sessionId, receipt: newReceipt(), contentHash: hash, kind, answeredCount: rows.filter((r) => isAnswered(r.answer)).length, submittedAt: now })
        .returning();
      await tx.update(examSessions).set({ status: "submitted", markingStatus: "pending" }).where(eq(examSessions.id, sessionId));
      return { receipt: sub!.receipt, submittedAt: sub!.submittedAt, kind: sub!.kind as SubmitKind, answeredCount: sub!.answeredCount, already: false as const, userId: s.userId, sittingId: s.sittingId };
    });
    // After the commit: the submission is safe whatever happens to marking.
    if (!result.already) this.background(this.markSession(sessionId));
    return result;
  }

  private async receiptOf(tx: Tx | Db, sessionId: string) {
    const [sub] = await tx.select().from(examSubmissions).where(eq(examSubmissions.sessionId, sessionId)).limit(1);
    if (!sub) throw new Error("submitted session has no submission row");
    return { receipt: sub.receipt, submittedAt: sub.submittedAt, kind: sub.kind as SubmitKind, answeredCount: sub.answeredCount };
  }

  /* -------------------------------------------------------------- extension */

  /** Staff-granted extra time. Refuses once the attempt has ended: an ended attempt is never reopened. */
  async extend(sessionId: string, minutes: number) {
    return this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(examSessions).where(eq(examSessions.id, sessionId)).for("update").limit(1);
      if (!s) throw notFound("Not found");
      if (s.status !== "in_progress" || this.isExpired(s)) throw conflict("This attempt has already ended, so it can't be extended");
      const deadline = new Date(s.deadlineAt.getTime() + minutes * 60_000);
      await tx.update(examSessions).set({ deadlineAt: deadline, extensionMinutes: s.extensionMinutes + minutes }).where(eq(examSessions.id, sessionId));
      return { userId: s.userId, sittingId: s.sittingId, deadlineAt: deadline, extensionMinutes: s.extensionMinutes + minutes };
    });
  }

  /* ---------------------------------------------------------------- marking */

  /**
   * Deterministic marking of auto-markable items for ONE submitted session. Idempotent: safe to run twice, and the sweeper
   * re-runs anything left 'pending'. Essays get no row here: they wait for a person to mark them (see exam/marking.ts).
   */
  async markSession(sessionId: string) {
    await this.db.transaction(async (tx) => {
      const [s] = await tx.select().from(examSessions).where(eq(examSessions.id, sessionId)).for("update").limit(1);
      if (!s || s.status !== "submitted" || s.markingStatus !== "pending") return;
      const [items, responses] = await Promise.all([
        tx.select().from(sittingItems).where(eq(sittingItems.sittingId, s.sittingId)),
        tx.select().from(examResponses).where(eq(examResponses.sessionId, sessionId)),
      ]);
      const answerOf = new Map(responses.map((r) => [r.itemPosition, r.answer]));
      const rows = items
        .filter((i) => isAutoMarked(i.type))
        .map((i) => ({ sessionId, itemPosition: i.position, awarded: autoMarks(i, answerOf.get(i.position)), maxMarks: i.marks, method: "auto" as const }));
      if (rows.length) {
        await tx
          .insert(examMarks)
          .values(rows)
          .onConflictDoUpdate({ target: [examMarks.sessionId, examMarks.itemPosition], set: { awarded: sql`excluded.awarded`, maxMarks: sql`excluded.max_marks`, markedAt: sql`now()` }, setWhere: sql`${examMarks.method} = 'auto'` });
      }
      await tx.update(examSessions).set({ markingStatus: "marked" }).where(eq(examSessions.id, sessionId));
    });
  }

  /**
   * The scored result of one session, applying each section's selection rule.
   * answer_any: of the items the candidate answered, the best `count` are counted (the rule is shown to candidates up front).
   * If an essay in an answer_any section is still unmarked and could change the selection, that section is reported as pending.
   */
  async result(sessionId: string) {
    const [s] = await this.db.select().from(examSessions).where(eq(examSessions.id, sessionId)).limit(1);
    if (!s) throw notFound("Not found");
    const [sections, items, responses, marks] = await Promise.all([
      this.db.select().from(sittingSections).where(eq(sittingSections.sittingId, s.sittingId)).orderBy(asc(sittingSections.position)),
      this.db.select().from(sittingItems).where(eq(sittingItems.sittingId, s.sittingId)).orderBy(asc(sittingItems.position)),
      this.db.select().from(examResponses).where(eq(examResponses.sessionId, sessionId)),
      this.db.select().from(examMarks).where(eq(examMarks.sessionId, sessionId)),
    ]);
    const answered = new Set(responses.filter((r) => isAnswered(r.answer)).map((r) => r.itemPosition));
    const awardedOf = new Map(marks.map((m) => [m.itemPosition, m.awarded]));
    const commentOf = new Map(marks.map((m) => [m.itemPosition, m.comment]));

    let totalAwarded = 0, totalMax = 0, pendingItems = 0;
    const out = sections.map((sec) => {
      const its = items.filter((i) => i.sectionPosition === sec.position);
      type St = "marked" | "pending" | "unanswered" | "not_counted";
      const row = its.map((i) => ({
        position: i.position, max: i.marks, type: i.type,
        status: (!answered.has(i.position) ? "unanswered" : awardedOf.has(i.position) ? "marked" : "pending") as St,
        awarded: awardedOf.get(i.position) ?? null as number | null,
        /** A marker's note to the student. Only ever sent to the student once results are released. */
        comment: (commentOf.get(i.position) ?? null) as string | null,
      }));
      let secAwarded = 0, secMax = 0, secPending = 0;
      if (sec.ruleType === "answer_any") {
        const k = sec.ruleCount!;
        secMax = k * (its[0]?.marks ?? 0); // builders must give every item in an answer_any section equal marks
        const given = row.filter((r) => r.status !== "unanswered");
        const hasPending = given.some((r) => r.status === "pending");
        if (given.length <= k) {
          secAwarded = given.reduce((a, r) => a + (r.awarded ?? 0), 0);
          secPending = given.filter((r) => r.status === "pending").length;
        } else if (hasPending) {
          // More answered than allowed AND an unmarked essay: the best-k choice can't be made yet.
          secAwarded = 0; secPending = given.length; // reported as pending; nothing is guessed
        } else {
          const ranked = [...given].sort((a, b) => (b.awarded ?? 0) - (a.awarded ?? 0) || a.position - b.position);
          const chosen = new Set(ranked.slice(0, k).map((r) => r.position));
          for (const r of row) if (r.status === "marked" && !chosen.has(r.position)) r.status = "not_counted";
          secAwarded = ranked.slice(0, k).reduce((a, r) => a + (r.awarded ?? 0), 0);
        }
      } else {
        secMax = its.reduce((a, i) => a + i.marks, 0);
        secAwarded = row.reduce((a, r) => a + (r.awarded ?? 0), 0);
        secPending = row.filter((r) => r.status === "pending").length;
      }
      totalAwarded += secAwarded; totalMax += secMax; pendingItems += secPending;
      return { position: sec.position, title: sec.title, rule: sec.ruleType === "answer_any" ? { type: "answer_any" as const, count: sec.ruleCount! } : { type: "answer_all" as const }, awarded: secAwarded, max: secMax, pending: secPending, items: row };
    });
    return { sessionId, status: s.status, markingStatus: s.markingStatus, totalAwarded, totalMax, pendingItems, sections: out };
  }

  /* ---------------------------------------------------------------- sweeper */

  /**
   * Housekeeping, safe to run on every instance at once: auto-submit attempts whose deadline has passed (so a closed browser
   * or dead network still ends on time) and finish any marking left pending.
   */
  async sweep(limit = 200) {
    const cutoff = new Date(this.now().getTime() - SAVE_GRACE_MS);
    const due = await this.db.select({ id: examSessions.id }).from(examSessions).where(and(eq(examSessions.status, "in_progress"), lt(examSessions.deadlineAt, cutoff))).orderBy(asc(examSessions.deadlineAt)).limit(limit);
    for (const d of due) await this.submit(d.id, "auto").catch((e) => this.log("auto-submit failed", e));
    const toMark = await this.db.select({ id: examSessions.id }).from(examSessions).where(and(eq(examSessions.status, "submitted"), eq(examSessions.markingStatus, "pending"))).limit(limit);
    for (const m of toMark) await this.markSession(m.id).catch((e) => this.log("marking failed", e));
    return { autoSubmitted: due.length, marked: toMark.length };
  }
}

