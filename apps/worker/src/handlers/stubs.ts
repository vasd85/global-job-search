import type { Job } from "pg-boss";
import { createLogger } from "@gjs/logger";

const log = createLogger("stubs");

/**
 * Stub handler for description fetch jobs.
 */
export async function handleDescriptionFetch(jobs: Job[]): Promise<void> {
  for (const job of jobs) {
    log.warn(
      { jobId: job.id, handler: "descriptionFetch" },
      "Stub handler invoked",
    );
  }
}

/**
 * Stub handler for role taxonomy expansion jobs.
 */
export async function handleRoleTaxonomy(jobs: Job[]): Promise<void> {
  for (const job of jobs) {
    log.warn(
      { jobId: job.id, handler: "roleTaxonomy" },
      "Stub handler invoked",
    );
  }
}
