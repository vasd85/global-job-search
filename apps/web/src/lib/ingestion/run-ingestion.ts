import { eq } from "drizzle-orm";
import { createLogger } from "@gjs/logger";
import type { Database } from "../db";
import { companies } from "../db/schema";
import { pollCompany } from "./poll-company";

const log = createLogger("ingestion");

interface IngestionResult {
  totalCompanies: number;
  successful: number;
  failed: number;
  totalJobsNew: number;
  totalJobsClosed: number;
  totalJobsUpdated: number;
  durationMs: number;
  errors: Array<{ companySlug: string; error: string }>;
}

/**
 * Run ingestion for all active companies with concurrency control.
 */
export async function runIngestion(
  db: Database,
  options: {
    concurrency?: number;
    /** If provided, only poll these company IDs */
    companyIds?: string[];
  } = {}
): Promise<IngestionResult> {
  const { concurrency = 10, companyIds } = options;
  const startTime = Date.now();

  // Fetch companies to poll
  let companyList;
  if (companyIds && companyIds.length > 0) {
    companyList = await db
      .select()
      .from(companies)
      .where(eq(companies.isActive, true));
    companyList = companyList.filter((c) => companyIds.includes(c.id));
  } else {
    companyList = await db
      .select()
      .from(companies)
      .where(eq(companies.isActive, true));
  }

  const result: IngestionResult = {
    totalCompanies: companyList.length,
    successful: 0,
    failed: 0,
    totalJobsNew: 0,
    totalJobsClosed: 0,
    totalJobsUpdated: 0,
    durationMs: 0,
    errors: [],
  };

  // Process companies with concurrency limit
  const queue = [...companyList];
  const processing: Promise<void>[] = [];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const company = queue.shift()!;
      try {
        const pollResult = await pollCompany(db, company);

        if (pollResult.status === "error") {
          result.failed++;
          result.errors.push({
            companySlug: company.slug,
            error: pollResult.errorMessage ?? "unknown error",
          });
        } else {
          result.successful++;
        }
        result.totalJobsNew += pollResult.jobsNew;
        result.totalJobsClosed += pollResult.jobsClosed;
        result.totalJobsUpdated += pollResult.jobsUpdated;
      } catch (error) {
        result.failed++;
        result.errors.push({
          companySlug: company.slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  // Launch `concurrency` workers
  for (let i = 0; i < Math.min(concurrency, companyList.length); i++) {
    processing.push(processNext());
  }

  await Promise.all(processing);

  result.durationMs = Date.now() - startTime;

  log.info(
    {
      successful: result.successful,
      totalCompanies: result.totalCompanies,
      jobsNew: result.totalJobsNew,
      jobsUpdated: result.totalJobsUpdated,
      jobsClosed: result.totalJobsClosed,
      durationMs: result.durationMs,
    },
    "Ingestion done",
  );

  if (result.errors.length > 0) {
    log.warn(
      {
        count: result.errors.length,
        sample: result.errors.slice(0, 10),
      },
      "Ingestion errors",
    );
  }

  return result;
}
