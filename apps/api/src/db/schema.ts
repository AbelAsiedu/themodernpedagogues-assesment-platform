import { sql } from "drizzle-orm";
import {
  bigserial,
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
    check("questions_source_ck", sql`${t.source} in ('manual','ai')`),
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
export type Subject = typeof subjects.$inferSelect;
