CREATE TABLE "quiz_items" (
	"quiz_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"question_id" uuid NOT NULL,
	"question_version" integer NOT NULL,
	CONSTRAINT "quiz_items_quiz_id_position_pk" PRIMARY KEY("quiz_id","position")
);
--> statement-breakpoint
CREATE TABLE "quiz_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"quiz_id" uuid NOT NULL,
	"class_id" uuid,
	"host_id" uuid,
	"join_code" text NOT NULL,
	"status" text DEFAULT 'lobby' NOT NULL,
	"settings" jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quiz_sessions_status_ck" CHECK ("quiz_sessions"."status" in ('lobby','active','ended'))
);
--> statement-breakpoint
CREATE TABLE "quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"time_per_question_sec" integer DEFAULT 30 NOT NULL,
	"shuffle_questions" boolean DEFAULT true NOT NULL,
	"shuffle_options" boolean DEFAULT true NOT NULL,
	"show_leaderboard" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quizzes_time_ck" CHECK ("quizzes"."time_per_question_sec" between 5 and 300)
);
--> statement-breakpoint
CREATE TABLE "session_answers" (
	"participant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"question_position" integer NOT NULL,
	"answer" jsonb,
	"correct" boolean NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"points" integer NOT NULL,
	"time_ms" integer NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_answers_participant_id_idx_pk" PRIMARY KEY("participant_id","idx"),
	CONSTRAINT "session_answers_points_ck" CHECK ("session_answers"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "session_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"question_order" jsonb NOT NULL,
	"current_index" integer DEFAULT 0 NOT NULL,
	"question_served_at" timestamp with time zone,
	"total_points" integer DEFAULT 0 NOT NULL,
	"total_time_ms" integer DEFAULT 0 NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"answered_count" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_questions" (
	"session_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"question_id" uuid NOT NULL,
	"question_version" integer NOT NULL,
	"type" text NOT NULL,
	"stem" text NOT NULL,
	"explanation" text,
	"marks" double precision NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "session_questions_session_id_position_pk" PRIMARY KEY("session_id","position")
);
--> statement-breakpoint
ALTER TABLE "quiz_items" ADD CONSTRAINT "quiz_items_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_items" ADD CONSTRAINT "quiz_items_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD CONSTRAINT "quiz_sessions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD CONSTRAINT "quiz_sessions_quiz_id_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quizzes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD CONSTRAINT "quiz_sessions_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD CONSTRAINT "quiz_sessions_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_answers" ADD CONSTRAINT "session_answers_participant_id_session_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."session_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_session_id_quiz_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."quiz_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_participants" ADD CONSTRAINT "session_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_questions" ADD CONSTRAINT "session_questions_session_id_quiz_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."quiz_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quiz_sessions_inst_idx" ON "quiz_sessions" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_sessions_open_code_uq" ON "quiz_sessions" USING btree ("join_code") WHERE "quiz_sessions"."status" <> 'ended';--> statement-breakpoint
CREATE INDEX "quizzes_institution_idx" ON "quizzes" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "session_answers_session_q_idx" ON "session_answers" USING btree ("session_id","question_position");--> statement-breakpoint
CREATE UNIQUE INDEX "session_participants_session_user_uq" ON "session_participants" USING btree ("session_id","user_id");--> statement-breakpoint
CREATE INDEX "session_participants_session_idx" ON "session_participants" USING btree ("session_id");