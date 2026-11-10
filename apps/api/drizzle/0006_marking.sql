CREATE TABLE "ai_mark_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"item_position" integer NOT NULL,
	"requested_by" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"answer_hash" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"proposed_total" double precision NOT NULL,
	"reasoning" text NOT NULL,
	"missing_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_mark_proposals_status_ck" CHECK ("ai_mark_proposals"."status" in ('pending','used')),
	CONSTRAINT "ai_mark_proposals_conf_ck" CHECK ("ai_mark_proposals"."confidence" in ('low','medium','high'))
);
--> statement-breakpoint
CREATE TABLE "exam_mark_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"item_position" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"previous_awarded" double precision,
	"awarded" double precision NOT NULL,
	"criteria" jsonb NOT NULL,
	"reason" text,
	"ai_proposal_id" uuid,
	CONSTRAINT "exam_mark_events_action_ck" CHECK ("exam_mark_events"."action" in ('mark','adjust'))
);
--> statement-breakpoint
ALTER TABLE "exam_marks" ADD COLUMN "marked_by" uuid;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD COLUMN "criteria" jsonb;--> statement-breakpoint
ALTER TABLE "exam_marks" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "ai_mark_proposals" ADD CONSTRAINT "ai_mark_proposals_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_mark_proposals" ADD CONSTRAINT "ai_mark_proposals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_mark_events" ADD CONSTRAINT "exam_mark_events_session_id_exam_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."exam_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_mark_events" ADD CONSTRAINT "exam_mark_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_mark_proposals_item_idx" ON "ai_mark_proposals" USING btree ("session_id","item_position","created_at");--> statement-breakpoint
CREATE INDEX "exam_mark_events_item_idx" ON "exam_mark_events" USING btree ("session_id","item_position","at");--> statement-breakpoint
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The mark history may only grow. (Rows can still vanish if a whole exam attempt is deleted, which no feature does.)
CREATE OR REPLACE FUNCTION exam_mark_events_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'exam_mark_events is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER exam_mark_events_no_update
  BEFORE UPDATE ON exam_mark_events
  FOR EACH ROW EXECUTE FUNCTION exam_mark_events_block_update();
