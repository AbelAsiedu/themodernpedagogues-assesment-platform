import type { ExamAnswer } from "@tmp/shared";
import { markAnswer, type QuestionRow } from "../quiz/marking.js";

/** Does the SHAPE of an answer fit the question's type? (A wrong shape is a client bug, so it is refused, not marked wrong.) */
export function fits(type: string, answer: ExamAnswer): boolean {
  if (answer === null) return true; // clearing an answer
  switch (type) {
    case "mcq": return "optionId" in answer;
    case "true_false": return "value" in answer;
    case "short_answer":
    case "essay": return "text" in answer;
    default: return false;
  }
}

/** Is there an answer at all? Empty text and null both count as unanswered. */
export function isAnswered(answer: unknown): boolean {
  if (answer === null || answer === undefined) return false;
  const a = answer as Record<string, unknown>;
  if ("text" in a) return typeof a.text === "string" && a.text.trim().length > 0;
  return "optionId" in a || "value" in a;
}

/** Question types the platform marks by itself. Essays wait for a person. */
export const isAutoMarked = (type: string) => type === "mcq" || type === "true_false" || type === "short_answer";

/** Marks for one item. Same deterministic rules as quizzes; never any AI. */
export function autoMarks(q: QuestionRow, answer: unknown): number {
  if (!isAnswered(answer)) return 0;
  return markAnswer(q, answer as Parameters<typeof markAnswer>[1]) ? q.marks : 0;
}
