CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"uploaded_by" uuid,
	"filename" text NOT NULL,
	"kind" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"sections" jsonb NOT NULL,
	"char_count" integer NOT NULL,
	"question_table" jsonb,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rights_confirmed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_kind_ck" CHECK ("uploads"."kind" in ('xlsx','docx','pptx','pdf','csv','txt','image'))
);
--> statement-breakpoint
ALTER TABLE "questions" DROP CONSTRAINT "questions_source_ck";--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploads_inst_time_idx" ON "uploads" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_inst_sha_uq" ON "uploads" USING btree ("institution_id","sha256");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_ck" CHECK ("questions"."source" in ('manual','ai','import'));