import { describe, expect, it } from "vitest";
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, normaliseJoinCode } from "@tmp/shared";
import { answerFits, markAnswer, normaliseText, publicQuestion, reveal, type QuestionRow } from "../src/quiz/marking.js";
import { shuffled } from "../src/quiz/order.js";
import { newJoinCode } from "../src/quiz/joinCode.js";
import { GRACE_MS, computePoints } from "../src/quiz/scoring.js";
import { TIME_SCALE, decodePoints, encodeScore } from "../src/quiz/leaderboard.js";

const mcq: QuestionRow = { type: "mcq", stem: "s", explanation: "because", marks: 1, content: { options: [{ id: "A", text: "a" }, { id: "B", text: "b" }, { id: "C", text: "c" }], correctOptionId: "B" } };
const tf: QuestionRow = { type: "true_false", stem: "s", explanation: null, marks: 1, content: { correct: false } };
const sa: QuestionRow = { type: "short_answer", stem: "s", explanation: null, marks: 2, content: { acceptedAnswers: ["Accra", "the city of Accra"] } };

describe("marking", () => {
  it("marks MCQ, true/false and short answer exactly", () => {
    expect(markAnswer(mcq, { optionId: "B" })).toBe(true);
    expect(markAnswer(mcq, { optionId: "A" })).toBe(false);
    expect(markAnswer(tf, { value: false })).toBe(true);
    expect(markAnswer(tf, { value: true })).toBe(false);
    expect(markAnswer(sa, { text: "  ACCRA. " })).toBe(true);
    expect(markAnswer(sa, { text: "the  city of accra" })).toBe(true);
    expect(markAnswer(sa, { text: "Kumasi" })).toBe(false);
  });
  it("treats blank, missing and wrong-shape answers as wrong", () => {
    expect(markAnswer(mcq, null)).toBe(false);
    expect(markAnswer(mcq, { value: true })).toBe(false);
    expect(markAnswer(sa, { text: "   " })).toBe(false);
    expect(markAnswer({ ...sa, type: "essay" }, { text: "Accra" })).toBe(false);
  });
  it("answerFits rejects shapes that don't match the type", () => {
    expect(answerFits("mcq", { optionId: "A" })).toBe(true);
    expect(answerFits("mcq", { text: "A" })).toBe(false);
    expect(answerFits("true_false", { value: true })).toBe(true);
    expect(answerFits("short_answer", { optionId: "A" })).toBe(false);
    expect(answerFits("essay", { text: "x" })).toBe(false);
    expect(answerFits("mcq", null)).toBe(true); // "no answer" fits everything
  });
  it("normaliseText ignores case, spacing and edge punctuation only", () => {
    expect(normaliseText("  Hello,   World!! ")).toBe("hello, world");
    expect(normaliseText("Cedi")).not.toBe(normaliseText("Cedis"));
  });
  it("never puts the answer key in what a participant sees before answering", () => {
    const seen = JSON.stringify([publicQuestion(mcq, (x) => x), publicQuestion(tf, (x) => x), publicQuestion(sa, (x) => x)]);
    for (const secret of ["correctOptionId", "acceptedAnswers", "because", "correct\":"]) expect(seen).not.toContain(secret);
  });
  it("reveals the key only through reveal()", () => {
    expect(reveal(mcq)).toEqual({ correctAnswer: { optionId: "B" }, explanation: "because" });
    expect(reveal(tf).correctAnswer).toEqual({ value: false });
    expect(reveal(sa).correctAnswer).toEqual({ text: "Accra" });
  });
});

describe("scoring", () => {
  const base = { correct: true, marks: 1, limitMs: 30_000 };
  it("gives 100/mark plus up to 50% for speed", () => {
    expect(computePoints({ ...base, elapsedMs: 0 }).points).toBe(150);
    expect(computePoints({ ...base, elapsedMs: 15_000 }).points).toBe(125);
    expect(computePoints({ ...base, elapsedMs: 30_000 }).points).toBe(100);
    expect(computePoints({ ...base, marks: 2, elapsedMs: 0 }).points).toBe(300);
  });
  it("scores 0 for wrong answers and for answers past limit + grace", () => {
    expect(computePoints({ ...base, correct: false, elapsedMs: 1000 }).points).toBe(0);
    const late = computePoints({ ...base, elapsedMs: 30_000 + GRACE_MS + 1 });
    expect(late).toEqual({ points: 0, late: true });
    expect(computePoints({ ...base, elapsedMs: 30_000 + GRACE_MS }).late).toBe(false); // grace edge is on time, bonus floored at 0
  });
  it("is monotonic: answering faster never scores less", () => {
    let prev = Infinity;
    for (let t = 0; t <= 30_000; t += 500) { const p = computePoints({ ...base, elapsedMs: t }).points; expect(p).toBeLessThanOrEqual(prev); prev = p; }
  });
});

describe("leaderboard score encoding", () => {
  it("orders by points, then by LESS total time", () => {
    expect(encodeScore(200, 5000)).toBeGreaterThan(encodeScore(100, 1));
    expect(encodeScore(100, 4000)).toBeGreaterThan(encodeScore(100, 9000));
    expect(encodeScore(100, 4000)).toBe(encodeScore(100, 4000));
  });
  it("round-trips points and stays exactly representable at large values", () => {
    for (const [p, t] of [[0, 0], [7500, 123456], [99_999, TIME_SCALE * 5]] as const) {
      const sc = encodeScore(p, t);
      expect(decodePoints(sc)).toBe(p);
      expect(Number.isSafeInteger(sc)).toBe(true);
    }
  });
  it("clamps absurd times instead of corrupting the points part", () => {
    expect(decodePoints(encodeScore(500, 10 ** 12))).toBe(500);
  });
});

describe("join codes and shuffles", () => {
  it("are the right length, from the unambiguous alphabet, and not repeating", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const c = newJoinCode();
      expect(c).toHaveLength(JOIN_CODE_LENGTH);
      for (const ch of c) expect(JOIN_CODE_ALPHABET).toContain(ch);
      seen.add(c);
    }
    expect(seen.size).toBeGreaterThan(2990); // ~1e9 space: collisions in 3000 draws are vanishingly rare
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });
  it("normaliseJoinCode tolerates case, spaces and dashes", () => {
    expect(normaliseJoinCode(" ab-c 2d3 ")).toBe("ABC2D3");
  });
  it("shuffles deterministically per seed, differently across seeds, without losing items", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    expect(shuffled(items, "a")).toEqual(shuffled(items, "a"));
    expect(shuffled(items, "a")).not.toEqual(shuffled(items, "b"));
    expect([...shuffled(items, "a")].sort((x, y) => x - y)).toEqual(items);
  });
});
