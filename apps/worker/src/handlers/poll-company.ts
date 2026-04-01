import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import type { Database } from "@gjs/db";
import { companies } from "@gjs/db/schema";
import { pollCompany, computeNextPoll } from "@gjs/ingestion";
import { jitter } from "../lib/jitter";

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
    for (const job of jobs) {
      const { companyId } = job.data;

      // 1. Load the company row
      const [company] = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);

      if (!company) {
        console.warn(
          `[poll-company] Company not found: ${companyId}, skipping job ${job.id}`
        );
        continue;
      }

      if (!company.isActive) {
        console.info(
          `[poll-company] Company ${company.slug} is inactive, skipping`
        );
        continue;
      }

      // 2. Apply jitter to avoid thundering herd
      await jitter(5000);

      // 3. Execute the poll
      console.info(`[poll-company] Polling ${company.slug} (${company.atsVendor})`);
      const result = await pollCompany(db, company);

      console.info(
        `[poll-company] ${company.slug}: status=${result.status} ` +
          `found=${result.jobsFound} new=${result.jobsNew} ` +
          `closed=${result.jobsClosed} updated=${result.jobsUpdated} ` +
          `duration=${result.durationMs}ms`
      );

      // 4. Compute adaptive polling schedule
      const adaptiveResult = computeNextPoll({
        lastPollStatus: result.status,
        consecutiveErrors: company.consecutiveErrors,
        lastPolledAt: company.lastPolledAt,
        createdAt: company.createdAt,
        jobsNew: result.jobsNew,
        jobsClosed: result.jobsClosed,
      });

      // 5. Update company with adaptive polling fields
      await db
        .update(companies)
        .set({
          nextPollAfter: adaptiveResult.nextPollAfter,
          pollPriority: adaptiveResult.pollPriority,
          consecutiveErrors: adaptiveResult.consecutiveErrors,
          updatedAt: new Date(),
        })
        .where(eq(companies.id, companyId));
    }
  };
}
