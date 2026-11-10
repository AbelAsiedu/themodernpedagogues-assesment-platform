CREATE TABLE "exam_items" (
	"exam_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"section_position" integer NOT NULL,
	"question_id" uuid NOT NULL,
	"question_version" integer NOT NULL,
	CONSTRAINT "exam_items_exam_id_position_pk" PRIMARY KEY("exam_id","position")
);
--> statement-breakpoint
CREATE TABLE "exam_marks" (
	"session_id" uuid NOT NULL,
	"item_position" integer NOT NULL,
	"awarded" double precision NOT NULL,
	"max_marks" double precision NOT NULL,
	"method" text DEFAULT 'auto' NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_marks_session_id_item_position_pk" PRIMARY KEY("session_id","item_position"),
	CONSTRAINT "exam_marks_range_ck" CHECK ("exam_marks"."awarded" >= 0 and "exam_marks"."awarded" <= "exam_marks"."max_marks"),
	CONSTRAINT "exam_marks_method_ck" CHECK ("exam_marks"."method" in ('auto','manual'))
);
--> statement-breakpoint
CREATE TABLE "exam_response_versions" (
	"session_id" uuid NOT NULL,
	"item_position" integer NOT NULL,
	"seq" integer NOT NULL,
	"answer" jsonb,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_response_versions_session_id_item_position_seq_pk" PRIMARY KEY("session_id","item_position","seq")
);
--> statement-breakpoint
CREATE TABLE "exam_responses" (
	"session_id" uuid NOT NULL,
	"item_position" integer NOT NULL,
	"seq" integer NOT NULL,
	"answer" jsonb,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_responses_session_id_item_position_pk" PRIMARY KEY("session_id","item_position")
);
--> statement-breakpoint
CREATE TABLE "exam_sections" (
	"exam_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"rule_type" text DEFAULT 'answer_all' NOT NULL,
	"rule_count" integer,
	CONSTRAINT "exam_sections_exam_id_position_pk" PRIMARY KEY("exam_id","position"),
	CONSTRAINT "exam_sections_rule_ck" CHECK (("exam_sections"."rule_type" = 'answer_all' and "exam_sections"."rule_count" is null) or ("exam_sections"."rule_type" = 'answer_any' and "exam_sections"."rule_count" >= 1))
);
--> statement-breakpoint
CREATE TABLE "exam_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sitting_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone NOT NULL,
	"extension_minutes" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"marking_status" text,
	CONSTRAINT "exam_sessions_status_ck" CHECK ("exam_sessions"."status" in ('in_progress','submitted')),
	CONSTRAINT "exam_sessions_marking_ck" CHECK ("exam_sessions"."marking_status" is null or "exam_sessions"."marking_status" in ('pending','marked'))
);
--> statement-breakpoint
CREATE TABLE "exam_sittings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"class_id" uuid,
	"title" text NOT NULL,
	"instructions" text,
	"duration_minutes" integer NOT NULL,
	"shuffle_options" boolean NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"results_released_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_sittings_status_ck" CHECK ("exam_sittings"."status" in ('scheduled','cancelled')),
	CONSTRAINT "exam_sittings_window_ck" CHECK ("exam_sittings"."closes_at" > "exam_sittings"."opens_at")
);
--> statement-breakpoint
CREATE TABLE "exam_submissions" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"receipt" text NOT NULL,
	"content_hash" text NOT NULL,
	"kind" text NOT NULL,
	"answered_count" integer NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_submissions_kind_ck" CHECK ("exam_submissions"."kind" in ('student','auto'))
);
--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"duration_minutes" integer NOT NULL,
	"shuffle_options" boolean DEFAULT true NOT NULL,
	"provenance" text DEFAULT 'teacher_created' NOT NULL,
	"source_spec" text,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exams_duration_ck" CHECK ("exams"."duration_minutes" between 5 and 360),
	CONSTRAINT "exams_provenance_ck" CHECK ("exams"."provenance" in ('teacher_created','tmp_practice','official_verified')),
	CONSTRAINT "exams_official_source_ck" CHECK ("exams"."provenance" <> 'official_verified' or "exams"."source_spec" is not null)
);
--> statement-breakpoint
CREATE TABLE "sitting_items" (
	"sitting_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"section_position" integer NOT NULL,
	"question_id" uuid NOT NULL,
	"question_version" integer NOT NULL,
	"type" text NOT NULL,
	"stem" text NOT NULL,
	"explanation" text,
	"marks" double precision NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "sitting_items_sitting_id_position_pk" PRIMARY KEY("sitting_id","position")
);
--> statement-breakpoint
CREATE TABLE "sitting_sections" (
	"sitting_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"rule_type" text NOT NULL,
	"rule_count" integer,
	CONSTRAINT "sitting_sections_sitting_id_position_pk" PRIMARY KEY("sitting_id","position")
);
--> statement-breakpoint
ALTER TABLE "exam_items" ADD CONSTRAINT "exam_items_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_items" ADD CONSTRAINT "exam_items_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_response_versions" ADD CONSTRAINT "exam_response_versions_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_responses" ADD CONSTRAINT "exam_responses_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sections" ADD CONSTRAINT "exam_sections_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_sitting_id_exam_sittings_id_fk" FOREIGN KEY ("sitting_id") REFERENCES "public"."exam_sittings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sessions" ADD CONSTRAINT "exam_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sittings" ADD CONSTRAINT "exam_sittings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sittings" ADD CONSTRAINT "exam_sittings_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sittings" ADD CONSTRAINT "exam_sittings_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_sittings" ADD CONSTRAINT "exam_sittings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_submissions" ADD CONSTRAINT "exam_submissions_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sitting_items" ADD CONSTRAINT "sitting_items_sitting_id_exam_sittings_id_fk" FOREIGN KEY ("sitting_id") REFERENCES "public"."exam_sittings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sitting_sections" ADD CONSTRAINT "sitting_sections_sitting_id_exam_sittings_id_fk" FOREIGN KEY ("sitting_id") REFERENCES "public"."exam_sittings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exam_sessions_sitting_user_uq" ON "exam_sessions" USING btree ("sitting_id","user_id");--> statement-breakpoint
CREATE INDEX "exam_sessions_due_idx" ON "exam_sessions" USING btree ("status","deadline_at");--> statement-breakpoint
CREATE INDEX "exam_sessions_marking_idx" ON "exam_sessions" USING btree ("marking_status");--> statement-breakpoint
CREATE INDEX "exam_sittings_inst_idx" ON "exam_sittings" USING btree ("institution_id","opens_at");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_submissions_receipt_uq" ON "exam_submissions" USING btree ("receipt");--> statement-breakpoint
CREATE INDEX "exams_institution_idx" ON "exams" USING btree ("institution_id");