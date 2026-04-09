-- =============================================================================
-- 0009_separate_match_signals
--
-- Splits the single `workFormats` tier axis into two independent dimensions:
--   1. Work format: remote | hybrid | onsite (structured, ATS-sourced)
--   2. Immigration signals: visa sponsorship, relocation package, work-auth
--      restriction (LLM-extracted from description text)
--
-- Also renames five `_raw`-suffixed columns that were never actually raw at
-- rest — they were already cleaned/normalized at ingestion — to their primary
-- names, and converts `posted_date_raw` (text) to `posted_at` (timestamptz).
--
-- Data preservation:
--   - location_raw, department_raw, salary_raw, employment_type_raw values are
--     preserved via ALTER TABLE ... RENAME COLUMN.
--   - posted_date_raw is copied into the new `posted_at` timestamptz column
--     for rows whose value matches an ISO-8601-ish prefix (YYYY-MM-DD*);
--     non-ISO rows become NULL and will be backfilled by the normalizer on
--     the next poll.
--   - workplace_type and employment_type are normalized in place; values not
--     in the canonical set become NULL (intentional, lossy).
--
-- NOTE: This file was hand-edited on top of drizzle-kit autogen to convert
-- ADD/DROP pairs into RENAME COLUMN statements (preserving data), add the
-- posted_date_raw -> posted_at backfill, and add the in-place normalizations
-- for workplace_type and employment_type.
-- =============================================================================

-- §A. Rename columns whose `_raw` suffix was a lie. Data is preserved.
ALTER TABLE "job" RENAME COLUMN "location_raw" TO "location";--> statement-breakpoint
ALTER TABLE "job" RENAME COLUMN "department_raw" TO "department";--> statement-breakpoint
ALTER TABLE "job" RENAME COLUMN "salary_raw" TO "salary";--> statement-breakpoint
ALTER TABLE "job" RENAME COLUMN "employment_type_raw" TO "employment_type";--> statement-breakpoint

-- §B. posted_date_raw (text) -> posted_at (timestamptz) with ISO-only backfill.
ALTER TABLE "job" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "job"
SET "posted_at" = "posted_date_raw"::timestamptz
WHERE "posted_date_raw" ~ '^\d{4}-\d{2}-\d{2}';--> statement-breakpoint
ALTER TABLE "job" DROP COLUMN "posted_date_raw";--> statement-breakpoint

-- §C. New LLM-extracted immigration signal columns (three-valued enums).
ALTER TABLE "job" ADD COLUMN "visa_sponsorship" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "relocation_package" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "work_auth_restriction" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint

-- §D. New LLM-extracted soft signal columns (nullable — scoring-prompt only).
ALTER TABLE "job" ADD COLUMN "language_requirements" text[];--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "travel_percent" integer;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "security_clearance" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "shift_pattern" text;--> statement-breakpoint

-- §E. Provenance + idempotency for signal extraction.
ALTER TABLE "job" ADD COLUMN "signals_extracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "signals_extracted_from_hash" text;--> statement-breakpoint

-- §F. Normalize workplace_type in place (case folding + on-site/on_site -> onsite).
--     Any value not in the canonical set becomes NULL (lossy, intentional).
--     The matcher treats NULL as "unknown" and passes it through.
UPDATE "job"
SET "workplace_type" = CASE lower(trim("workplace_type"))
    WHEN 'remote'  THEN 'remote'
    WHEN 'hybrid'  THEN 'hybrid'
    WHEN 'onsite'  THEN 'onsite'
    WHEN 'on-site' THEN 'onsite'
    WHEN 'on_site' THEN 'onsite'
    ELSE NULL
END
WHERE "workplace_type" IS NOT NULL;--> statement-breakpoint

-- §G. Normalize employment_type in place (runs AFTER the rename in §A).
--     Canonical set: full_time | part_time | contract | intern | temp | NULL.
UPDATE "job"
SET "employment_type" = CASE lower(trim("employment_type"))
    WHEN 'full-time'   THEN 'full_time'
    WHEN 'fulltime'    THEN 'full_time'
    WHEN 'full time'   THEN 'full_time'
    WHEN 'permanent'   THEN 'full_time'
    WHEN 'part-time'   THEN 'part_time'
    WHEN 'parttime'    THEN 'part_time'
    WHEN 'part time'   THEN 'part_time'
    WHEN 'contract'    THEN 'contract'
    WHEN 'contractor'  THEN 'contract'
    WHEN 'intern'      THEN 'intern'
    WHEN 'internship'  THEN 'intern'
    WHEN 'temporary'   THEN 'temp'
    WHEN 'temp'        THEN 'temp'
    ELSE NULL
END
WHERE "employment_type" IS NOT NULL;
