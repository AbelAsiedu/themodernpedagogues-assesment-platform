import { z } from "zod";
import { DIFFICULTIES, MAX_SOURCE_TEXT } from "./questions.js";
import { MAX_QUIZ_QUESTIONS, MAX_SECONDS_PER_QUESTION, MIN_SECONDS_PER_QUESTION } from "./quizzes.js";

/** File uploads: vocabulary shared by the API (which enforces it) and the web app. */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** What the platform can read. Detection is by the file's CONTENT, not its name. */
export const UPLOAD_KINDS = ["xlsx", "docx", "pptx", "pdf", "csv", "txt", "image"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export const UPLOAD_KIND_LABEL: Record<UploadKind, string> = {
  xlsx: "Excel spreadsheet", docx: "Word document", pptx: "PowerPoint slides", pdf: "PDF", csv: "CSV / table", txt: "Text / Markdown", image: "Image (read by OCR)",
};

/** File-picker hint only. The server decides what it accepts. */
export const UPLOAD_ACCEPT = ".xlsx,.docx,.pptx,.pdf,.csv,.tsv,.txt,.md,.png,.jpg,.jpeg";

/** A section of extracted text a teacher can pick to ground AI questions in. */
export interface UploadSectionSummary { id: string; label: string; chars: number; preview: string; ocr: boolean }

export const MAX_GROUNDING_CHARS = MAX_SOURCE_TEXT;

export const importQuestionsSchema = z
  .object({
    subjectId: z.string().uuid(),
    topicId: z.string().uuid().nullable().default(null),
    difficulty: z.enum(DIFFICULTIES).default("medium"),
    /** Item numbers (from the preview) to import. Omit for every valid item. */
    rows: z.array(z.number().int().min(1)).max(1000).optional(),
    /** Teachers who can review may approve what they import in one step. Otherwise it lands in the review queue. */
    approve: z.boolean().default(false),
    /** Also build a quiz from the imported questions (needs approve). */
    quiz: z
      .object({
        title: z.string().trim().min(2).max(160),
        timePerQuestionSec: z.number().int().min(MIN_SECONDS_PER_QUESTION).max(MAX_SECONDS_PER_QUESTION).optional(),
        shuffleQuestions: z.boolean().default(true),
        shuffleOptions: z.boolean().default(true),
        showLeaderboard: z.boolean().default(true),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.quiz && !v.approve) ctx.addIssue({ code: "custom", path: ["quiz"], message: "A quiz can only use approved questions, so choose 'approve' to build one now" });
    if (v.rows && v.rows.length > MAX_QUIZ_QUESTIONS && v.quiz) ctx.addIssue({ code: "custom", path: ["rows"], message: `A quiz can hold up to ${MAX_QUIZ_QUESTIONS} questions` });
  });
export type ImportQuestionsInput = z.infer<typeof importQuestionsSchema>;
