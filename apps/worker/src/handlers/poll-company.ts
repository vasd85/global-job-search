import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import type { Database } from "@gjs/db";
import { companies } from "@gjs/db/schema";
import { pollCompany, computeNextPoll } from "@gjs/ingestion";
import { createLogger } from "@gjs/logger";
import { jitter } from "../lib/jitter";
import { getAppConfigValue } from "../lib/app-config";

const log = createLogger("poll-company");

// ─── Types ──────────────────────────────────────────────────────────────────

interface PollJobData {
  companyId: string;
}

// ─── Handler ────────────────────────────────────────────────────────────────

/**
 * pg-boss handler for ATS polling jobs. Receives a job with
 * `{ companyId }` payload, loads the company, applies jitter,
 * polls via the shared ingestion module, then updates adaptive
 * polling fields on the company row.
 */
export function createPollCompanyHandler(db: Database) {
  return async (jobs: Job<PollJobData>[]): Promise<void> => {
    // Load config once per batch invocation to avoid N+1 queries.
    // Coerce with Number() before clamping: getAppConfigValue performs an
    // unsafe `value as T` cast, so a non-numeric string stored in jsonb
    // would produce NaN from Math.floor, and Math.max(N, NaN) = NaN.
    const rawJitter = Number(
      await getAppConfigValue<number>(db, "polling.jitter_max_ms", 5000),
    );
    const jitterMaxMs = Number.isNaN(rawJitter) ? 5000 : Math.max(0, rawJitter);

    const rawStale = Number(
      await getAppConfigValue<number>(db, "polling.stale_threshold_days", 7),
    );
    const staleThresholdDays = Number.isNaN(rawStale) ? 7 : Math.max(1, Math.floor(rawStale));

    const rawClosed = Number(
      await getAppConfigValue<number>(db, "polling.closed_threshold_days", 30),
    );
    const closedThresholdDays = Number.isNaN(rawClosed) ? 30 : Math.max(1, Math.floor(rawClosed));

    for (const job of jobs) {
      const { companyId } = job.data;

      // 1. Load the company row
      const [company] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);

      if (!company) {
        log.warn({ companyId, jobId: job.id }, "Company not found, skipping");
        continue;
      }

      if (!company.isActive) {
        log.info(
          { slug: company.slug, companyId: company.id },
          "Company inactive, skipping",
        );
        continue;
      }

      // 2. Apply jitter to avoid thundering herd
      await jitter(jitterMaxMs);

      // 3. Execute the poll
      log.info(
        { slug: company.slug, vendor: company.atsVendor },
        "Polling company",
      );
      const result = await pollCompany(db, company, {
        staleThresholdDays,
        closedThresholdDays,
      });

      log.info(
        {
          slug: company.slug,
          status: result.status,
          jobsFound: result.jobsFound,
          jobsNew: result.jobsNew,
          jobsClosed: result.jobsClosed,
          jobsUpdated: result.jobsUpdated,
          durationMs: result.durationMs,
        },
        "Poll complete",
      );

      // 4. Compute adaptive polling schedule
      const hadChanges = result.jobsNew > 0 || result.jobsClosed > 0;
      const adaptiveResult = computeNextPoll({
        lastPollStatus: result.status,
        consecutiveErrors: company.consecutiveErrors,
        lastPolledAt: company.lastPolledAt,
        createdAt: company.createdAt,
        lastChangedAt: company.lastChangedAt,
        jobsNew: result.jobsNew,
        jobsClosed: result.jobsClosed,
      });

      // 5. Update company with adaptive polling fields.
      // Wrapped in try-catch: if this fails, the poll itself already
      // succeeded (pollCompany wrote its results). Letting the pg-boss
      // job succeed avoids a non-idempotent retry that would re-poll.
      try {
        await db
          .update(companies)
          .set({
            nextPollAfter: adaptiveResult.nextPollAfter,
            pollPriority: adaptiveResult.pollPriority,
            consecutiveErrors: adaptiveResult.consecutiveErrors,
            ...(hadChanges ? { lastChangedAt: new Date() } : {}),
            updatedAt: new Date(),
          })
          .where(eq(companies.id, companyId));
      } catch (updateError) {
        log.error(
          { slug: company.slug, companyId, err: updateError },
          "Failed to update adaptive poll fields (poll succeeded; scheduling may be stale)",
        );
      }
    }
  };
}
