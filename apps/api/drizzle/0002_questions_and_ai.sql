CREATE TABLE "ai_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"requested_by" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"requested_count" integer NOT NULL,
	"saved_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_generations_status_ck" CHECK ("ai_generations"."status" in ('succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE "question_versions" (
	"question_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "question_versions_question_id_version_pk" PRIMARY KEY("question_id","version")
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"topic_id" uuid,
	"type" text NOT NULL,
	"stem" text NOT NULL,
	"explanation" text,
	"difficulty" text DEFAULT 'medium' NOT NULL,
	"marks" double precision DEFAULT 1 NOT NULL,
	"content" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"ai_generation_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "questions_type_ck" CHECK ("questions"."type" in ('mcq','true_false','short_answer','essay')),
	CONSTRAINT "questions_difficulty_ck" CHECK ("questions"."difficulty" in ('easy','medium','hard')),
	CONSTRAINT "questions_status_ck" CHECK ("questions"."status" in ('draft','needs_review','approved','rejected','archived')),
	CONSTRAINT "questions_source_ck" CHECK ("questions"."source" in ('manual','ai')),
	CONSTRAINT "questions_marks_ck" CHECK ("questions"."marks" > 0),
	CONSTRAINT "questions_ai_reviewed_ck" CHECK ("questions"."source" <> 'ai' or "questions"."status" not in ('approved') or "questions"."reviewed_by" is not null)
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"institution_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_versions" ADD CONSTRAINT "question_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_ai_generation_id_ai_generations_id_fk" FOREIGN KEY ("ai_generation_id") REFERENCES "public"."ai_generations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_generations_inst_time_idx" ON "ai_generations" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_generations_user_time_idx" ON "ai_generations" USING btree ("requested_by","created_at");--> statement-breakpoint
CREATE INDEX "questions_inst_status_idx" ON "questions" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "questions_subject_idx" ON "questions" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "questions_topic_idx" ON "questions" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_inst_name_level_uq" ON "subjects" USING btree ("institution_id","name","level");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_subject_name_uq" ON "topics" USING btree ("subject_id","name");--> statement-breakpoint
CREATE INDEX "topics_institution_idx" ON "topics" USING btree ("institution_id");