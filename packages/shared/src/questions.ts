import { z } from "zod";

/** Question bank vocabulary, shared by the API (which enforces it) and the web app (which renders it). */

export const QUESTION_TYPES = ["mcq", "true_false", "short_answer", "essay"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  mcq: "Multiple choice",
  true_false: "True / false",
  short_answer: "Short answer",
  essay: "Essay / structured",
};

/** Types the platform can mark deterministically, with no AI involved. */
export const AUTO_MARKED_TYPES: readonly QuestionType[] = ["mcq", "true_false", "short_answer"];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * draft        – being written by a person
 * needs_review – waiting for a teacher to approve (ALL AI output starts here)
 * approved     – may be used in quizzes and exams
 * rejected     – reviewed and not accepted
 * archived     – retired; kept for history
 */
export const QUESTION_STATUSES = ["draft", "needs_review", "approved", "rejected", "archived"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const QUESTION_SOURCES = ["manual", "ai", "import"] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

const text = (max: number) => z.string().trim().min(1).max(max);

/* ----------------------------------------------------------------- content */

const OPTION_IDS = ["A", "B", "C", "D", "E", "F"] as const;

export const mcqContentSchema = z
  .object({
    options: z
      .array(z.object({ id: z.enum(OPTION_IDS), text: text(500) }))
      .min(2, "Give at least two options")
      .max(6),
    correctOptionId: z.enum(OPTION_IDS),
  })
  .superRefine((c, ctx) => {
    const ids = c.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Option labels must be unique" });
    const texts = c.options.map((o) => o.text.toLowerCase());
    if (new Set(texts).size !== texts.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Two options have the same text" });
    if (!ids.includes(c.correctOptionId)) ctx.addIssue({ code: "custom", path: ["correctOptionId"], message: "The correct answer must be one of the options" });
  });

export const trueFalseContentSchema = z.object({ correct: z.boolean() });

export const shortAnswerContentSchema = z.object({
  acceptedAnswers: z.array(text(200)).min(1, "Give at least one accepted answer").max(15),
});

export const essayContentSchema = z.object({
  /** The marking points. A marker (or the AI, proposing only) awards marks against these. */
  rubric: z
    .array(z.object({ point: text(400), marks: z.number().positive().max(50) }))
    .min(1, "Add at least one marking point")
    .max(25),
});

/* ------------------------------------------------------------------- input */

const base = {
  subjectId: z.string().uuid(),
  topicId: z.string().uuid().nullable().default(null),
  stem: text(2000),
  explanation: z.string().trim().max(2000).nullable().default(null),
  difficulty: z.enum(DIFFICULTIES).default("medium"),
  marks: z.number().positive().max(100).default(1),
};

export const createQuestionSchema = z
  .discriminatedUnion("type", [
    z.object({ ...base, type: z.literal("mcq"), content: mcqContentSchema }),
    z.object({ ...base, type: z.literal("true_false"), content: trueFalseContentSchema }),
    z.object({ ...base, type: z.literal("short_answer"), content: shortAnswerContentSchema }),
    z.object({ ...base, type: z.literal("essay"), content: essayContentSchema }),
  ])
  .superRefine((q, ctx) => {
    if (q.type === "essay") {
      const total = q.content.rubric.reduce((a, r) => a + r.marks, 0);
      if (Math.abs(total - q.marks) > 1e-9) {
        ctx.addIssue({ code: "custom", path: ["marks"], message: `Marks (${q.marks}) must equal the rubric total (${total})` });
      }
    }
  });
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

/** Validate content against a question's (immutable) type. Used for edits. */
export function parseContent(type: QuestionType, content: unknown) {
  switch (type) {
    case "mcq": return mcqContentSchema.safeParse(content);
    case "true_false": return trueFalseContentSchema.safeParse(content);
    case "short_answer": return shortAnswerContentSchema.safeParse(content);
    case "essay": return essayContentSchema.safeParse(content);
  }
}

export const updateQuestionSchema = z
  .object({
    topicId: z.string().uuid().nullable(),
    stem: text(2000),
    explanation: z.string().trim().max(2000).nullable(),
    difficulty: z.enum(DIFFICULTIES),
    marks: z.number().positive().max(100),
    content: z.unknown(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

export const reviewDecisionSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional(),
});

export const createSubjectSchema = z.object({ name: text(80), level: text(40) });
export const createTopicSchema = z.object({ name: text(120) });

export const listQuestionsQuery = z.object({
  subjectId: z.string().uuid().optional(),
  topicId: z.string().uuid().optional(),
  status: z.enum(QUESTION_STATUSES).optional(),
  type: z.enum(QUESTION_TYPES).optional(),
  source: z.enum(QUESTION_SOURCES).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).default(0),
});

/* ---------------------------------------------------------------- AI studio */

export const MAX_SOURCE_TEXT = 12_000;
export const MAX_QUESTIONS_PER_REQUEST = 10;

export const generateQuestionsSchema = z.object({
  subjectId: z.string().uuid(),
  topicId: z.string().uuid().nullable().default(null),
  type: z.enum(QUESTION_TYPES),
  count: z.number().int().min(1).max(MAX_QUESTIONS_PER_REQUEST),
  difficulty: z.enum(DIFFICULTIES).default("medium"),
  /** Class level the questions should suit, e.g. "JHS 3". */
  level: z.string().trim().min(1).max(40),
  /** Optional teacher notes / syllabus text to ground the questions in. Treated as untrusted data. */
  sourceText: z.string().trim().max(MAX_SOURCE_TEXT).optional(),
  /** Optional extra instruction, e.g. "focus on causes of ethnic conflict". */
  focus: z.string().trim().max(300).optional(),
  /** Ground the questions in sections of a file the teacher uploaded (the server reads the text; it is never sent by the browser). */
  uploadId: z.string().uuid().optional(),
  sectionIds: z.array(z.string().max(20)).max(60).optional(),
});
export type GenerateQuestionsInput = z.infer<typeof generateQuestionsSchema>;
