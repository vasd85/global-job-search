CREATE TABLE "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_family" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"strong_match" text[],
	"moderate_match" text[],
	"department_boost" text[],
	"department_exclude" text[],
	"is_system_defined" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_family_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_company_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"industries" text[],
	"company_sizes" text[],
	"company_stages" text[],
	"work_format" text,
	"hq_geographies" text[],
	"product_types" text[],
	"exclusions" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_company_preference_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "job_match" RENAME COLUMN "score_m" TO "score_r";--> statement-breakpoint
ALTER TABLE "user_profile" RENAME COLUMN "primary_skills" TO "core_skills";--> statement-breakpoint
ALTER TABLE "user_profile" RENAME COLUMN "secondary_skills" TO "growth_skills";--> statement-breakpoint
ALTER TABLE "user_profile" RENAME COLUMN "weight_mobility" TO "weight_role";--> statement-breakpoint
ALTER TABLE "user_profile" ALTER COLUMN "weight_role" SET DEFAULT 0.25;--> statement-breakpoint
ALTER TABLE "user_profile" ALTER COLUMN "weight_compensation" SET DEFAULT 0.15;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "consecutive_errors" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "poll_priority" text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "next_poll_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_match" ADD COLUMN "score_l" integer;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "avoid_skills" text[];--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "target_salary" integer;--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "salary_currency" text DEFAULT 'USD';--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "deal_breakers" text[];--> statement-breakpoint
ALTER TABLE "user_profile" ADD COLUMN "weight_location" real DEFAULT 0.2 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_company_preference" ADD CONSTRAINT "user_company_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;