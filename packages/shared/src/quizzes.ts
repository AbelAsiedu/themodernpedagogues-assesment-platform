import { z } from "zod";

/** Quizzes and live sessions: vocabulary shared by the API (which enforces it) and the web app. */

/** No 0/O/1/I/L so codes can be read aloud and typed from a board. 31^6 ≈ 888 million codes. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;
export const normaliseJoinCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

export const SESSION_STATUSES = ["lobby", "active", "ended"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const MAX_QUIZ_QUESTIONS = 100;
export const MIN_SECONDS_PER_QUESTION = 5;
export const MAX_SECONDS_PER_QUESTION = 300;

export const createQuizSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().max(500).nullable().default(null),
  timePerQuestionSec: z.number().int().min(MIN_SECONDS_PER_QUESTION).max(MAX_SECONDS_PER_QUESTION).default(30),
  shuffleQuestions: z.boolean().default(true),
  shuffleOptions: z.boolean().default(true),
  showLeaderboard: z.boolean().default(true),
  questionIds: z.array(z.string().uuid()).min(1, "Choose at least one question").max(MAX_QUIZ_QUESTIONS),
});
export type CreateQuizInput = z.infer<typeof createQuizSchema>;

export const startSessionSchema = z.object({
  /** Restrict to the members of one class. Omit to open it to every student in the school. */
  classId: z.string().uuid().nullable().default(null),
  /** Skip the lobby and open immediately. */
  startNow: z.boolean().default(false),
  /** Optional self-paced deadline (homework mode). The session closes by itself after this many minutes. */
  durationMinutes: z.number().int().min(1).max(60 * 24 * 14).nullable().default(null),
});

export const joinSessionSchema = z.object({
  code: z.string().trim().min(4).max(12),
  /** Name shown on the public leaderboard. Defaults to first name + last initial. */
  displayName: z.string().trim().min(2).max(24).regex(/^[\p{L}\p{N} ._'-]+$/u, "Letters, numbers and simple punctuation only").optional(),
});

/** What a participant sends for one question. Which shape is valid depends on the question's type. */
export const answerSchema = z.object({
  index: z.number().int().min(0).max(MAX_QUIZ_QUESTIONS),
  answer: z
    .union([
      z.object({ optionId: z.string().min(1).max(2) }),
      z.object({ value: z.boolean() }),
      z.object({ text: z.string().max(200) }),
    ])
    .nullable(),
});
export type AnswerInput = z.infer<typeof answerSchema>;
