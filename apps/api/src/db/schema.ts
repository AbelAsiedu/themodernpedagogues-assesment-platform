import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  doublePrecision,
  integer,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ users */

export const users = pgTable(
  "users",
  {
    id: id(),
    /** Always stored lowercase; enforced by the check constraint below. */
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** null = ordinary user whose authority comes only from institution memberships. */
    platformRole: text("platform_role"),
    status: text("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    index("users_platform_role_idx").on(t.platformRole),
    check("users_email_lower_ck", sql`${t.email} = lower(${t.email})`),
    check("users_status_ck", sql`${t.status} in ('active','suspended','deactivated')`),
    check(
      "users_platform_role_ck",
      sql`${t.platformRole} is null or ${t.platformRole} in ('super_admin','platform_admin','academic_admin')`,
    ),
  ],
);

/** Opaque server-side sessions. Only a SHA-256 hash of the token is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** Extra permissions the super admin delegates to an individual platform-level user. */
export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permission] })],
);

/* ----------------------------------------------------------- institutions */

export const institutions = pgTable(
  "institutions",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    country: text("country").notNull().default("GH"),
    timezone: text("timezone").notNull().default("Africa/Accra"),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("institutions_slug_uq").on(t.slug),
    check("institutions_status_ck", sql`${t.status} in ('pending','active','suspended')`),
  ],
);

/** A user's role inside ONE institution. This is the tenant boundary. */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memberships_user_inst_role_uq").on(t.userId, t.institutionId, t.role),
    index("memberships_institution_idx").on(t.institutionId),
    check("memberships_role_ck", sql`${t.role} in ('institution_admin','teacher','student')`),
    check("memberships_status_ck", sql`${t.status} in ('active','suspended')`),
  ],
);

/* ---------------------------------------------------------------- classes */

export const classes = pgTable(
  "classes",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    level: text("level").notNull(),
    academicYear: text("academic_year").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("classes_institution_idx").on(t.institutionId),
    uniqueIndex("classes_inst_name_year_uq").on(t.institutionId, t.name, t.academicYear),
  ],
);

export const classMembers = pgTable(
  "class_members",
  {
    classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.classId, t.userId] }),
    index("class_members_user_idx").on(t.userId),
    check("class_members_role_ck", sql`${t.role} in ('teacher','student')`),
  ],
);


/* ----------------------------------------------------------- question bank */

export const subjects = pgTable(
  "subjects",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    level: text("level").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("subjects_inst_name_level_uq").on(t.institutionId, t.name, t.level)],
);

export const topics = pgTable(
  "topics",
  {
    id: id(),
    subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("topics_subject_name_uq").on(t.subjectId, t.name), index("topics_institution_idx").on(t.institutionId)],
);

/** One row per generation request, successful or not. Never contains the API key. */
export const aiGenerations = pgTable(
  "ai_generations",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    /** What was asked for (counts, type, difficulty…). The grounding text itself is not stored, only its length. */
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull(),
    requestedCount: integer("requested_count").notNull(),
    savedCount: integer("saved_count").notNull().default(0),
    rejectedCount: integer("rejected_count").notNull().default(0),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ai_generations_inst_time_idx").on(t.institutionId, t.createdAt),
    index("ai_generations_user_time_idx").on(t.requestedBy, t.createdAt),
    check("ai_generations_status_ck", sql`${t.status} in ('succeeded','failed')`),
  ],
);

/**
 * A file a teacher uploaded as source material. Only the EXTRACTED text and any parsed question table are kept;
 * the original file is not stored. Deleting a row deletes that text.
 */
export interface StoredSection { id: string; label: string; text: string; ocr: boolean }
export interface StoredParsedQuestion {
  /** Item number, unique within the upload (what the import request refers to). */
  row: number; /** Row in the sheet it came from. */ sourceRow: number; sheet: string | null; type: string; stem: string; options: string[]; correctIndex: number | null; correctBool: boolean | null;
  accepted: string[]; explanation: string | null; marks: number | null; difficulty: string | null; timeSec: number | null;
  problems: string[]; notes: string[];
}
export interface StoredQuestionTable { layout: string; items: StoredParsedQuestion[]; suggestedTimeSec: number | null; truncated: boolean }

export const uploads = pgTable(
  "uploads",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    /** For display only. Never used as a path. */
    filename: text("filename").notNull(),
    kind: text("kind").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    sections: jsonb("sections").$type<StoredSection[]>().notNull(),
    charCount: integer("char_count").notNull(),
    questionTable: jsonb("question_table").$type<StoredQuestionTable>(),
    warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** The uploader confirmed they wrote this material or have permission to use it. */
    rightsConfirmedAt: timestamp("rights_confirmed_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("uploads_inst_time_idx").on(t.institutionId, t.createdAt),
    uniqueIndex("uploads_inst_sha_uq").on(t.institutionId, t.sha256),
    check("uploads_kind_ck", sql`${t.kind} in ('xlsx','docx','pptx','pdf','csv','txt','image')`),
  ],
);

export const questions = pgTable(
  "questions",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "restrict" }),
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    stem: text("stem").notNull(),
    explanation: text("explanation"),
    difficulty: text("difficulty").notNull().default("medium"),
    marks: doublePrecision("marks").notNull().default(1),
    /** Type-specific answer data (options + key, accepted answers, rubric). Validated by Zod before every write. */
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("draft"),
    source: text("source").notNull().default("manual"),
    aiGenerationId: uuid("ai_generation_id").references(() => aiGenerations.id, { onDelete: "set null" }),
    /** The uploaded file this question was imported or generated from, if any. */
    uploadId: uuid("upload_id").references(() => uploads.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("questions_inst_status_idx").on(t.institutionId, t.status),
    index("questions_subject_idx").on(t.subjectId),
    index("questions_topic_idx").on(t.topicId),
    check("questions_type_ck", sql`${t.type} in ('mcq','true_false','short_answer','essay')`),
    check("questions_difficulty_ck", sql`${t.difficulty} in ('easy','medium','hard')`),
    check("questions_status_ck", sql`${t.status} in ('draft','needs_review','approved','rejected','archived')`),
    check("questions_source_ck", sql`${t.source} in ('manual','ai','import')`),
    check("questions_marks_ck", sql`${t.marks} > 0`),
    // The database itself refuses to hold an AI-written question that skipped human review.
    check("questions_ai_reviewed_ck", sql`${t.source} <> 'ai' or ${t.status} not in ('approved') or ${t.reviewedBy} is not null`),
  ],
);

/** Every content version is kept, so a question used in a past exam can always be shown as it was. */
export const questionVersions = pgTable(
  "question_versions",
  {
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.version] })],
);


/* ------------------------------------------------------------ quizzes & live */

export const quizzes = pgTable(
  "quizzes",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    timePerQuestionSec: integer("time_per_question_sec").notNull().default(30),
    shuffleQuestions: boolean("shuffle_questions").notNull().default(true),
    shuffleOptions: boolean("shuffle_options").notNull().default(true),
    showLeaderboard: boolean("show_leaderboard").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("quizzes_institution_idx").on(t.institutionId),
    check("quizzes_time_ck", sql`${t.timePerQuestionSec} between 5 and 300`),
  ],
);

/** A quiz points at a SPECIFIC version of each approved question, so later edits can't change it. */
export const quizItems = pgTable(
  "quiz_items",
  {
    quizId: uuid("quiz_id").notNull().references(() => quizzes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
    questionVersion: integer("question_version").notNull(),
  },
  (t) => [primaryKey({ columns: [t.quizId, t.position] })],
);

export interface SessionSettings {
  title: string;
  timePerQuestionSec: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  showLeaderboard: boolean;
  durationMinutes: number | null;
}

export const quizSessions = pgTable(
  "quiz_sessions",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    quizId: uuid("quiz_id").notNull().references(() => quizzes.id, { onDelete: "restrict" }),
    classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
    hostId: uuid("host_id").references(() => users.id, { onDelete: "set null" }),
    joinCode: text("join_code").notNull(),
    status: text("status").notNull().default("lobby"),
    /** Copy of the quiz settings at the moment the session was created. */
    settings: jsonb("settings").$type<SessionSettings>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("quiz_sessions_inst_idx").on(t.institutionId, t.createdAt),
    // A join code is unique among sessions that are still open; ended sessions release theirs.
    uniqueIndex("quiz_sessions_open_code_uq").on(t.joinCode).where(sql`${t.status} <> 'ended'`),
    check("quiz_sessions_status_ck", sql`${t.status} in ('lobby','active','ended')`),
  ],
);

/** Frozen copy of every question in a session (content, key, marks), served from here and nowhere else. */
export const sessionQuestions = pgTable(
  "session_questions",
  {
    sessionId: uuid("session_id").notNull().references(() => quizSessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    questionId: uuid("question_id").notNull(),
    questionVersion: integer("question_version").notNull(),
    type: text("type").notNull(),
    stem: text("stem").notNull(),
    explanation: text("explanation"),
    marks: doublePrecision("marks").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.position] })],
);

export const sessionParticipants = pgTable(
  "session_participants",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => quizSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    /** This participant's question order (a permutation of session_questions.position). */
    questionOrder: jsonb("question_order").$type<number[]>().notNull(),
    currentIndex: integer("current_index").notNull().default(0),
    /** Server time the current question was first shown. The timer is measured from here, never from the client. */
    questionServedAt: timestamp("question_served_at", { withTimezone: true }),
    totalPoints: integer("total_points").notNull().default(0),
    totalTimeMs: integer("total_time_ms").notNull().default(0),
    correctCount: integer("correct_count").notNull().default(0),
    answeredCount: integer("answered_count").notNull().default(0),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("session_participants_session_user_uq").on(t.sessionId, t.userId),
    index("session_participants_session_idx").on(t.sessionId),
  ],
);

/** One row per (participant, question). The unique key makes a double submit impossible to count twice. */
export const sessionAnswers = pgTable(
  "session_answers",
  {
    participantId: uuid("participant_id").notNull().references(() => sessionParticipants.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    /** Index in the participant's own order. */
    index: integer("idx").notNull(),
    questionPosition: integer("question_position").notNull(),
    answer: jsonb("answer").$type<unknown>(),
    correct: boolean("correct").notNull(),
    late: boolean("late").notNull().default(false),
    points: integer("points").notNull(),
    timeMs: integer("time_ms").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.participantId, t.index] }),
    index("session_answers_session_q_idx").on(t.sessionId, t.questionPosition),
    check("session_answers_points_ck", sql`${t.points} >= 0`),
  ],
);

/* ------------------------------------------------------------- examinations */

/** A reusable exam structure. Sitting it (scheduling it) freezes a copy, so editing or archiving this never alters a sitting. */
export const exams = pgTable(
  "exams",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    instructions: text("instructions"),
    durationMinutes: integer("duration_minutes").notNull(),
    shuffleOptions: boolean("shuffle_options").notNull().default(true),
    provenance: text("provenance").notNull().default("teacher_created"),
    sourceSpec: text("source_spec"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("exams_institution_idx").on(t.institutionId),
    check("exams_duration_ck", sql`${t.durationMinutes} between 5 and 360`),
    check("exams_provenance_ck", sql`${t.provenance} in ('teacher_created','tmp_practice','official_verified')`),
    // The database refuses an "official" structure that doesn't say where it was verified from.
    check("exams_official_source_ck", sql`${t.provenance} <> 'official_verified' or ${t.sourceSpec} is not null`),
  ],
);

export const examSections = pgTable(
  "exam_sections",
  {
    examId: uuid("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    ruleType: text("rule_type").notNull().default("answer_all"),
    ruleCount: integer("rule_count"),
  },
  (t) => [
    primaryKey({ columns: [t.examId, t.position] }),
    check("exam_sections_rule_ck", sql`(${t.ruleType} = 'answer_all' and ${t.ruleCount} is null) or (${t.ruleType} = 'answer_any' and ${t.ruleCount} >= 1)`),
  ],
);

export const examItems = pgTable(
  "exam_items",
  {
    examId: uuid("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
    /** Number across the whole exam (0-based). */
    position: integer("position").notNull(),
    sectionPosition: integer("section_position").notNull(),
    questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
    questionVersion: integer("question_version").notNull(),
  },
  (t) => [primaryKey({ columns: [t.examId, t.position] })],
);

/** One scheduled run of an exam for a school or class, with an opening and closing time. */
export const examSittings = pgTable(
  "exam_sittings",
  {
    id: id(),
    institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
    examId: uuid("exam_id").notNull().references(() => exams.id, { onDelete: "restrict" }),
    classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    instructions: text("instructions"),
    durationMinutes: integer("duration_minutes").notNull(),
    shuffleOptions: boolean("shuffle_options").notNull(),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("scheduled"),
    /** Until a teacher releases results, candidates see only that they submitted. */
    resultsReleasedAt: timestamp("results_released_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("exam_sittings_inst_idx").on(t.institutionId, t.opensAt),
    check("exam_sittings_status_ck", sql`${t.status} in ('scheduled','cancelled')`),
    check("exam_sittings_window_ck", sql`${t.closesAt} > ${t.opensAt}`),
  ],
);

export const sittingSections = pgTable(
  "sitting_sections",
  {
    sittingId: uuid("sitting_id").notNull().references(() => examSittings.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    instructions: text("instructions"),
    ruleType: text("rule_type").notNull(),
    ruleCount: integer("rule_count"),
  },
  (t) => [primaryKey({ columns: [t.sittingId, t.position] })],
);

/** Frozen copy of each question (content, key, marks) as it was when the exam was scheduled. */
export const sittingItems = pgTable(
  "sitting_items",
  {
    sittingId: uuid("sitting_id").notNull().references(() => examSittings.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    sectionPosition: integer("section_position").notNull(),
    questionId: uuid("question_id").notNull(),
    questionVersion: integer("question_version").notNull(),
    type: text("type").notNull(),
    stem: text("stem").notNull(),
    explanation: text("explanation"),
    marks: doublePrecision("marks").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.sittingId, t.position] })],
);

/** One candidate's attempt. The deadline is set by the server when they start and only a recorded, audited extension moves it. */
export const examSessions = pgTable(
  "exam_sessions",
  {
    id: id(),
    sittingId: uuid("sitting_id").notNull().references(() => examSittings.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }).notNull(),
    extensionMinutes: integer("extension_minutes").notNull().default(0),
    status: text("status").notNull().default("in_progress"),
    /** null until submitted; then pending -> marked. Marking never runs inside the submit transaction. */
    markingStatus: text("marking_status"),
  },
  (t) => [
    uniqueIndex("exam_sessions_sitting_user_uq").on(t.sittingId, t.userId),
    index("exam_sessions_due_idx").on(t.status, t.deadlineAt),
    index("exam_sessions_marking_idx").on(t.markingStatus),
    check("exam_sessions_status_ck", sql`${t.status} in ('in_progress','submitted')`),
    check("exam_sessions_marking_ck", sql`${t.markingStatus} is null or ${t.markingStatus} in ('pending','marked')`),
  ],
);

/** The candidate's CURRENT answer per item. `seq` only ever goes up, so a late, out-of-order save can't overwrite a newer one. */
export const examResponses = pgTable(
  "exam_responses",
  {
    sessionId: uuid("session_id").notNull().references(() => examSessions.id, { onDelete: "cascade" }),
    itemPosition: integer("item_position").notNull(),
    seq: integer("seq").notNull(),
    answer: jsonb("answer").$type<unknown>(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.itemPosition] })],
);

/** Every accepted change, kept (insert-only by the application). */
export const examResponseVersions = pgTable(
  "exam_response_versions",
  {
    sessionId: uuid("session_id").notNull().references(() => examSessions.id, { onDelete: "cascade" }),
    itemPosition: integer("item_position").notNull(),
    seq: integer("seq").notNull(),
    answer: jsonb("answer").$type<unknown>(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.itemPosition, t.seq] })],
);

/** One per session (primary key), so a second submit can only ever return the first receipt. */
export const examSubmissions = pgTable(
  "exam_submissions",
  {
    sessionId: uuid("session_id").primaryKey().references(() => examSessions.id, { onDelete: "cascade" }),
    receipt: text("receipt").notNull(),
    /** SHA-256 of the final answers, so a receipt can be checked against what was actually stored. */
    contentHash: text("content_hash").notNull(),
    kind: text("kind").notNull(),
    answeredCount: integer("answered_count").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("exam_submissions_receipt_uq").on(t.receipt), check("exam_submissions_kind_ck", sql`${t.kind} in ('student','auto')`)],
);

export interface CriterionAward { index: number; awarded: number }

/** Marks awarded per item. "auto" marks are deterministic; "manual" marks were set by a person against the frozen rubric. Essays have no row until a person marks them. */
export const examMarks = pgTable(
  "exam_marks",
  {
    sessionId: uuid("session_id").notNull().references(() => examSessions.id, { onDelete: "cascade" }),
    itemPosition: integer("item_position").notNull(),
    awarded: doublePrecision("awarded").notNull(),
    maxMarks: doublePrecision("max_marks").notNull(),
    method: text("method").notNull().default("auto"),
    markedAt: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
    /** Who set a manual mark. Null for automatic marks. */
    markedBy: uuid("marked_by").references(() => users.id, { onDelete: "set null" }),
    /** Per rubric point, for manual essay marks. */
    criteria: jsonb("criteria").$type<CriterionAward[]>(),
    /** Written for the student; shown to them only after results are released. */
    comment: text("comment"),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.itemPosition] }),
    check("exam_marks_range_ck", sql`${t.awarded} >= 0 and ${t.awarded} <= ${t.maxMarks}`),
    check("exam_marks_method_ck", sql`${t.method} in ('auto','manual')`),
  ],
);

/**
 * Every manual mark and every later change, with who, when, what it was before and why. Append-only: UPDATE is blocked by a
 * database trigger (see drizzle/0006_*.sql). The current mark lives in exam_marks; this is its history.
 */
export const examMarkEvents = pgTable(
  "exam_mark_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id").notNull().references(() => examSessions.id, { onDelete: "cascade" }),
    itemPosition: integer("item_position").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    previousAwarded: doublePrecision("previous_awarded"),
    awarded: doublePrecision("awarded").notNull(),
    criteria: jsonb("criteria").$type<CriterionAward[]>().notNull(),
    reason: text("reason"),
    /** Set when the marker started from an AI proposal (the mark itself is always the marker's). */
    aiProposalId: uuid("ai_proposal_id"),
  },
  (t) => [
    index("exam_mark_events_item_idx").on(t.sessionId, t.itemPosition, t.at),
    check("exam_mark_events_action_ck", sql`${t.action} in ('mark','adjust')`),
  ],
);

/**
 * An AI suggestion for one essay answer. NEVER a mark: it is stored apart from exam_marks, never counted in results and never
 * shown to students. A person decides, and the final mark is theirs.
 */
export const aiMarkProposals = pgTable(
  "ai_mark_proposals",
  {
    id: id(),
    sessionId: uuid("session_id").notNull().references(() => examSessions.id, { onDelete: "cascade" }),
    itemPosition: integer("item_position").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    /** SHA-256 of the answer text that was assessed. */
    answerHash: text("answer_hash").notNull(),
    criteria: jsonb("criteria").$type<(CriterionAward & { reason: string })[]>().notNull(),
    proposedTotal: doublePrecision("proposed_total").notNull(),
    reasoning: text("reasoning").notNull(),
    missingPoints: jsonb("missing_points").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    confidence: text("confidence").notNull(),
    /** pending → used (the marker started from it) */
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ai_mark_proposals_item_idx").on(t.sessionId, t.itemPosition, t.createdAt),
    check("ai_mark_proposals_status_ck", sql`${t.status} in ('pending','used')`),
    check("ai_mark_proposals_conf_ck", sql`${t.confidence} in ('low','medium','high')`),
  ],
);

export type ExamSitting = typeof examSittings.$inferSelect;
export type ExamSession = typeof examSessions.$inferSelect;

/* ------------------------------------------------------------ audit/settings */

/**
 * Append-only. UPDATE and DELETE are blocked by a database trigger
 * (see drizzle/*_audit_immutable.sql), not just by application convention.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    institutionId: uuid("institution_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    outcome: text("outcome").notNull().default("success"),
    ip: text("ip"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("audit_logs_at_idx").on(t.at),
    index("audit_logs_actor_idx").on(t.actorUserId),
    index("audit_logs_action_idx").on(t.action),
    index("audit_logs_institution_idx").on(t.institutionId),
    check("audit_logs_outcome_ck", sql`${t.outcome} in ('success','denied','failure')`),
  ],
);

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

export type User = typeof users.$inferSelect;
export type Institution = typeof institutions.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Upload = typeof uploads.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type QuizSession = typeof quizSessions.$inferSelect;
export type Participant = typeof sessionParticipants.$inferSelect;
