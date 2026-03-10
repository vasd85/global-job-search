CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"industry" text[],
	"ats_vendor" text NOT NULL,
	"ats_slug" text NOT NULL,
	"ats_careers_url" text,
	"source" text DEFAULT 'seed_list' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_polled_at" timestamp with time zone,
	"last_poll_status" text,
	"last_poll_error" text,
	"jobs_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "company_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submitted_by" text,
	"company_name" text NOT NULL,
	"company_website" text,
	"ats_careers_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_company_id" uuid,
	"resolved_ats_vendor" text,
	"resolved_ats_slug" text,
	"reviewer_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "job_match" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_profile_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"score_m" integer,
	"score_d" integer,
	"score_s" integer,
	"score_c" integer,
	"match_percent" integer,
	"match_reason" text,
	"evidence_quotes" text[],
	"user_status" text DEFAULT 'new' NOT NULL,
	"user_notes" text,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL,
	"job_content_hash" text,
	"is_stale" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"ats_job_id" text NOT NULL,
	"job_uid" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"location_raw" text,
	"department_raw" text,
	"posted_date_raw" text,
	"employment_type_raw" text,
	"description_text" text,
	"salary_raw" text,
	"workplace_type" text,
	"apply_url" text,
	"description_hash" text,
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"content_updated_at" timestamp with time zone,
	"source_type" text DEFAULT 'ats_api' NOT NULL,
	"source_ref" text NOT NULL,
	"source_raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_job_uid_unique" UNIQUE("job_uid")
);
--> statement-breakpoint
CREATE TABLE "poll_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"polled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"jobs_found" integer DEFAULT 0,
	"jobs_new" integer DEFAULT 0,
	"jobs_closed" integer DEFAULT 0,
	"jobs_updated" integer DEFAULT 0,
	"error_message" text,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "user_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"target_titles" text[],
	"target_seniority" text[],
	"primary_skills" text[],
	"secondary_skills" text[],
	"years_experience" integer,
	"preferred_locations" text[],
	"remote_preference" text DEFAULT 'any',
	"min_salary" integer,
	"preferred_industries" text[],
	"weight_mobility" real DEFAULT 0.3 NOT NULL,
	"weight_domain" real DEFAULT 0.15 NOT NULL,
	"weight_skills" real DEFAULT 0.25 NOT NULL,
	"weight_compensation" real DEFAULT 0.3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profile_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "company_submission" ADD CONSTRAINT "company_submission_resolved_company_id_company_id_fk" FOREIGN KEY ("resolved_company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_match" ADD CONSTRAINT "job_match_user_profile_id_user_profile_id_fk" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_match" ADD CONSTRAINT "job_match_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_log" ADD CONSTRAINT "poll_log_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_ats_vendor_slug_idx" ON "company" USING btree ("ats_vendor","ats_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "job_match_profile_job_idx" ON "job_match" USING btree ("user_profile_id","job_id");--> statement-breakpoint
CREATE INDEX "job_match_score_idx" ON "job_match" USING btree ("user_profile_id","match_percent");--> statement-breakpoint
CREATE INDEX "job_match_status_idx" ON "job_match" USING btree ("user_profile_id","user_status");--> statement-breakpoint
CREATE UNIQUE INDEX "job_company_ats_job_id_idx" ON "job" USING btree ("company_id","ats_job_id");--> statement-breakpoint
CREATE INDEX "job_status_idx" ON "job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_first_seen_idx" ON "job" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "job_company_id_idx" ON "job" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "poll_log_company_idx" ON "poll_log" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "poll_log_polled_at_idx" ON "poll_log" USING btree ("polled_at");