ALTER TABLE "company" ALTER COLUMN "ats_slug" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "ats_search_log" jsonb;