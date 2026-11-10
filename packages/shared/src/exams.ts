import { z } from "zod";

/**
 * Examinations: vocabulary shared by the API (which enforces it) and the web app (which renders it).
 * This is separate from live quizzes: an exam is a timed, scheduled sitting with a server-owned deadline.
 */

export const MIN_EXAM_MINUTES = 5;
export const MAX_EXAM_MINUTES = 360;
export const MAX_EXAM_SECTIONS = 10;
export const MAX_ITEMS_PER_SECTION = 60;
export const MAX_ESSAY_CHARS = 10_000;
export const MAX_EXTENSION_MINUTES = 120;

/**
 * Where a template's structure came from.
 *  teacher_created   – built by a teacher in the platform
 *  tmp_practice      – a TMP-authored practice format (not an official paper)
 *  official_verified – only allowed with a recorded source specification. No WAEC affiliation is ever implied.
 */
export const EXAM_PROVENANCE = ["teacher_created", "tmp_practice", "official_verified"] as const;
export type ExamProvenance = (typeof EXAM_PROVENANCE)[number];

/** answer_all: every item counts. answer_any: the candidate chooses `count` of the section's items. */
export const selectionRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("answer_all") }),
  z.object({ type: z.literal("answer_any"), count: z.number().int().min(1).max(MAX_ITEMS_PER_SECTION) }),
]);
export type SelectionRule = z.infer<typeof selectionRuleSchema>;

const text = (max: number) => z.string().trim().min(1).max(max);

export const examSectionSchema = z.object({
  title: text(80),
  instructions: z.string().trim().max(1000).nullable().default(null),
  rule: selectionRuleSchema.default({ type: "answer_all" }),
  questionIds: z.array(z.string().uuid()).min(1, "A section needs at least one question").max(MAX_ITEMS_PER_SECTION),
});

export const createExamSchema = z
  .object({
    title: text(160),
    instructions: z.string().trim().max(2000).nullable().default(null),
    durationMinutes: z.number().int().min(MIN_EXAM_MINUTES).max(MAX_EXAM_MINUTES),
    shuffleOptions: z.boolean().default(true),
    provenance: z.enum(EXAM_PROVENANCE).default("teacher_created"),
    /** Required for official_verified: where the structure was verified from. */
    sourceSpec: z.string().trim().max(500).nullable().default(null),
    sections: z.array(examSectionSchema).min(1).max(MAX_EXAM_SECTIONS),
  })
  .superRefine((e, ctx) => {
    if (e.provenance === "official_verified" && !e.sourceSpec) {
      ctx.addIssue({ code: "custom", path: ["sourceSpec"], message: "An official_verified structure needs the source specification it was verified from" });
    }
    e.sections.forEach((s, i) => {
      if (s.rule.type === "answer_any" && s.rule.count > s.questionIds.length) {
        ctx.addIssue({ code: "custom", path: ["sections", i, "rule", "count"], message: "Can't ask candidates to answer more questions than the section has" });
      }
    });
    const all = e.sections.flatMap((s) => s.questionIds);
    if (new Set(all).size !== all.length) ctx.addIssue({ code: "custom", path: ["sections"], message: "A question is used more than once" });
  });
export type CreateExamInput = z.infer<typeof createExamSchema>;

export const createSittingSchema = z
  .object({
    /** Restrict to one class. Omit for every student in the school. */
    classId: z.string().uuid().nullable().default(null),
    opensAt: z.string().datetime({ offset: true }),
    closesAt: z.string().datetime({ offset: true }),
  })
  .superRefine((s, ctx) => {
    if (new Date(s.closesAt) <= new Date(s.opensAt)) ctx.addIssue({ code: "custom", path: ["closesAt"], message: "The closing time must be after the opening time" });
  });
export type CreateSittingInput = z.infer<typeof createSittingSchema>;

/** One saved answer. The same shapes as quizzes, plus longer free text for essays. */
export const examAnswerSchema = z
  .union([
    z.object({ optionId: z.string().min(1).max(2) }),
    z.object({ value: z.boolean() }),
    z.object({ text: z.string().max(MAX_ESSAY_CHARS) }),
  ])
  .nullable();
export type ExamAnswer = z.infer<typeof examAnswerSchema>;

export const saveResponseSchema = z.object({
  /** Increases with every change the browser makes to this answer. The server ignores anything not newer than what it holds. */
  seq: z.number().int().min(1).max(2_000_000_000),
  answer: examAnswerSchema,
});

export const extendSchema = z.object({
  minutes: z.number().int().min(1).max(MAX_EXTENSION_MINUTES),
  reason: z.string().trim().min(5, "Give a reason (it is recorded)").max(300),
});

/** What a candidate can see of a section's rule, as a sentence. */
export function describeRule(rule: SelectionRule, total: number) {
  return rule.type === "answer_all" ? `Answer all ${total} question${total === 1 ? "" : "s"}.` : `Answer any ${rule.count} of the ${total} questions.`;
}
