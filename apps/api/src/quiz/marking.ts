import type { AnswerInput } from "@tmp/shared";

/**
 * Deterministic marking. No AI is involved anywhere in this file, and none ever will be:
 * the same answer against the same key always gives the same result.
 */

export interface QuestionRow {
  type: string;
  stem: string;
  explanation: string | null;
  marks: number;
  content: Record<string, unknown>;
}

export const normaliseText = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").replace(/^[\s.,;:!?'"]+|[\s.,;:!?'"]+$/g, "").trim();

type Given = AnswerInput["answer"];

export function markAnswer(q: QuestionRow, given: Given): boolean {
  if (!given) return false;
  switch (q.type) {
    case "mcq": {
      const key = (q.content as { correctOptionId?: string }).correctOptionId;
      return "optionId" in given && !!key && given.optionId === key;
    }
    case "true_false":
      return "value" in given && given.value === (q.content as { correct?: boolean }).correct;
    case "short_answer": {
      if (!("text" in given)) return false;
      const t = normaliseText(given.text);
      if (!t) return false;
      return ((q.content as { acceptedAnswers?: string[] }).acceptedAnswers ?? []).some((a) => normaliseText(a) === t);
    }
    default:
      return false; // essay and anything else is never auto-marked
  }
}

/** Does the SHAPE of the answer fit the question type? (A wrong shape is a client bug, not a wrong answer.) */
export function answerFits(type: string, given: Given): boolean {
  if (given === null) return true;
  if (type === "mcq") return "optionId" in given;
  if (type === "true_false") return "value" in given;
  if (type === "short_answer") return "text" in given;
  return false;
}

/** The question as a participant sees it BEFORE answering: no key, no accepted answers, no explanation. */
export function publicQuestion(q: QuestionRow, optionOrder: (ids: string[]) => string[]) {
  const base = { type: q.type, stem: q.stem, marks: q.marks };
  if (q.type === "mcq") {
    const opts = (q.content as { options: { id: string; text: string }[] }).options;
    const order = optionOrder(opts.map((o) => o.id));
    return { ...base, options: order.map((id) => ({ id, text: opts.find((o) => o.id === id)!.text })) };
  }
  return base;
}

/** What is revealed AFTER a participant has answered. */
export function reveal(q: QuestionRow) {
  const c = q.content as Record<string, unknown>;
  const correctAnswer =
    q.type === "mcq" ? { optionId: c.correctOptionId }
    : q.type === "true_false" ? { value: c.correct }
    : q.type === "short_answer" ? { text: (c.acceptedAnswers as string[])[0] }
    : null;
  return { correctAnswer, explanation: q.explanation };
}
