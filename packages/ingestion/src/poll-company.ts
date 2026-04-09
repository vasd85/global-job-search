import { eq, and } from "drizzle-orm";
import type { Database } from "@gjs/db";
import { companies, jobs, pollLogs } from "@gjs/db/schema";
import {
  extractFromGreenhouse,
  extractFromLever,
  extractFromAshby,
  extractFromSmartRecruiters,
  buildCareersUrl,
  createEmptyDiagnostics,
  sha256,
  SUPPORTED_ATS_VENDORS,
  type AllJob,
  type ExtractionContext,
  type ExtractionResult,
} from "@gjs/ats-core";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PollResult {
  status: "ok" | "error" | "empty" | "not_found";
  jobsFound: number;
  jobsNew: number;
  jobsClosed: number;
  jobsUpdated: number;
  errorMessage?: string;
  durationMs: number;
}

export interface PollOptions {
  staleThresholdDays?: number;
  closedThresholdDays?: number;
}

type CompanyRow = typeof companies.$inferSelect;
type JobRow = typeof jobs.$inferSelect;

// ─── ATS Extractor Dispatch ─────────────────────────────────────────────────

const SUPPORTED_VENDORS = new Set<string>(SUPPORTED_ATS_VENDORS);

async function fetchJobsFromAts(
  vendor: string,
  slug: string
): Promise<ExtractionResult> {
  if (!SUPPORTED_VENDORS.has(vendor)) {
    return { jobs: [], errors: [`Unsupported ATS vendor: ${vendor}`] };
  }

  const careersUrl = buildCareersUrl(vendor, slug);
  const diagnostics = createEmptyDiagnostics();
  const context: ExtractionContext = {
    careersUrl,
    timeoutMs: 30_000,
    maxRetries: 2,
    diagnostics,
  };

  switch (vendor) {
    case "greenhouse":
      return extractFromGreenhouse(context);
    case "lever":
      return extractFromLever(context);
    case "ashby":
      return extractFromAshby(context);
    case "smartrecruiters":
      return extractFromSmartRecruiters(context);
    default:
      return { jobs: [], errors: [`Unknown vendor: ${vendor}`] };
  }
}

// ─── Diff Engine ────────────────────────────────────────────────────────────

const STALE_THRESHOLD_DAYS = 7;
const CLOSED_THRESHOLD_DAYS = 30;

function computeDescriptionHash(descriptionText: string | null | undefined): string | null {
  if (!descriptionText) return null;
  return sha256(descriptionText);
}

async function syncCompanyJobs(
  db: Database,
  company: CompanyRow,
  freshJobs: AllJob[],
  options?: PollOptions,
): Promise<Omit<PollResult, "durationMs">> {
  const staleThreshold = options?.staleThresholdDays ?? STALE_THRESHOLD_DAYS;
  const closedThreshold = options?.closedThresholdDays ?? CLOSED_THRESHOLD_DAYS;
  const now = new Date();

  // 1. Fetch all currently-open stored jobs for this company
  const storedOpenJobs = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.companyId, company.id), eq(jobs.status, "open")));

  // 2. Build lookup maps
  const storedByAtsId = new Map<string, JobRow>();
  for (const job of storedOpenJobs) {
    storedByAtsId.set(job.atsJobId, job);
  }
  const freshByAtsId = new Map<string, AllJob>();
  for (const job of freshJobs) {
    freshByAtsId.set(job.job_id, job);
  }

  let jobsNew = 0;
  let jobsUpdated = 0;
  let jobsClosed = 0;

  // 3. Process fresh jobs
  for (const fresh of freshJobs) {
    const existing = storedByAtsId.get(fresh.job_id);
    const newHash = computeDescriptionHash(fresh.description_text);

    if (!existing) {
      // NEW JOB
      await db.insert(jobs).values({
        companyId: company.id,
        atsJobId: fresh.job_id,
        jobUid: fresh.job_uid,
        title: fresh.title,
        url: fresh.url,
        canonicalUrl: fresh.canonical_url,
        location: fresh.location,
        department: fresh.department,
        postedAt: fresh.posted_at,
        employmentType: fresh.employment_type,
        descriptionText: fresh.description_text ?? null,
        salary: fresh.salary ?? null,
        workplaceType: fresh.workplace_type ?? null,
        applyUrl: fresh.apply_url ?? null,
        sourceRaw: fresh.source_job_raw ?? null,
        descriptionHash: newHash,
        status: "open",
        firstSeenAt: now,
        lastSeenAt: now,
        sourceType: fresh.source_type,
        sourceRef: fresh.source_ref,
      }).onConflictDoNothing();
      jobsNew++;
    } else {
      // EXISTING JOB — check for content changes
      if (newHash && newHash !== existing.descriptionHash) {
        // Content changed
        await db
          .update(jobs)
          .set({
            title: fresh.title,
            location: fresh.location,
            department: fresh.department,
            descriptionText: fresh.description_text ?? null,
            salary: fresh.salary ?? null,
            workplaceType: fresh.workplace_type ?? null,
            sourceRaw: fresh.source_job_raw ?? null,
            descriptionHash: newHash,
            lastSeenAt: now,
            contentUpdatedAt: now,
            updatedAt: now,
          })
          .where(eq(jobs.id, existing.id));
        jobsUpdated++;
      } else {
        // No content change — just bump last_seen_at
        await db
          .update(jobs)
          .set({ lastSeenAt: now, updatedAt: now })
          .where(eq(jobs.id, existing.id));
      }
    }
  }

  // 4. Mark jobs no longer in API response
  for (const stored of storedOpenJobs) {
    if (!freshByAtsId.has(stored.atsJobId)) {
      const daysSinceLastSeen = Math.floor(
        (now.getTime() - stored.lastSeenAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceLastSeen >= closedThreshold) {
        await db
          .update(jobs)
          .set({ status: "closed", closedAt: now, updatedAt: now })
          .where(eq(jobs.id, stored.id));
        jobsClosed++;
      } else if (daysSinceLastSeen >= staleThreshold) {
        await db
          .update(jobs)
          .set({ status: "stale", updatedAt: now })
          .where(eq(jobs.id, stored.id));
        jobsClosed++;
      }
      // < 7 days: leave as open (grace period for API glitches)
    }
  }

  return {
    status: freshJobs.length > 0 ? "ok" : "empty",
    jobsFound: freshJobs.length,
    jobsNew,
    jobsClosed,
    jobsUpdated,
  };
}

// ─── Main Poll Function ─────────────────────────────────────────────────────

export async function pollCompany(
  db: Database,
  company: CompanyRow,
  options?: PollOptions,
): Promise<PollResult> {
  const startTime = Date.now();

  try {
    // 1. Fetch fresh jobs from ATS API
    if (!company.atsSlug) {
      const durationMs = Date.now() - startTime;
      return { status: "error", jobsFound: 0, jobsNew: 0, jobsClosed: 0, jobsUpdated: 0, errorMessage: "Company has no ATS slug", durationMs };
    }
    const result = await fetchJobsFromAts(company.atsVendor, company.atsSlug);

    if (result.errors.length > 0 && result.jobs.length === 0) {
      const durationMs = Date.now() - startTime;
      const errorMessage = result.errors.join("; ");

      // Update company status
      await db
        .update(companies)
        .set({
          lastPolledAt: new Date(),
          lastPollStatus: "error",
          lastPollError: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(companies.id, company.id));

      // Log
      await db.insert(pollLogs).values({
        companyId: company.id,
        status: "error",
        jobsFound: 0,
        jobsNew: 0,
        jobsClosed: 0,
        jobsUpdated: 0,
        errorMessage,
        durationMs,
      });

      return {
        status: "error",
        jobsFound: 0,
        jobsNew: 0,
        jobsClosed: 0,
        jobsUpdated: 0,
        errorMessage,
        durationMs,
      };
    }

    // 2. Sync jobs (diff engine)
    const syncResult = await syncCompanyJobs(db, company, result.jobs, options);
    const durationMs = Date.now() - startTime;

    // 3. Update company metadata
    await db
      .update(companies)
      .set({
        lastPolledAt: new Date(),
        lastPollStatus: syncResult.status,
        lastPollError: null,
        jobsCount: result.jobs.length,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, company.id));

    // 4. Log
    await db.insert(pollLogs).values({
      companyId: company.id,
      status: syncResult.status,
      jobsFound: syncResult.jobsFound,
      jobsNew: syncResult.jobsNew,
      jobsClosed: syncResult.jobsClosed,
      jobsUpdated: syncResult.jobsUpdated,
      durationMs,
    });

    return { ...syncResult, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    await db
      .update(companies)
      .set({
        lastPolledAt: new Date(),
        lastPollStatus: "error",
        lastPollError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(companies.id, company.id));

    await db.insert(pollLogs).values({
      companyId: company.id,
      status: "error",
      errorMessage,
      durationMs,
    });

    return {
      status: "error",
      jobsFound: 0,
      jobsNew: 0,
      jobsClosed: 0,
      jobsUpdated: 0,
      errorMessage,
      durationMs,
    };
  }
}
