import type { Job } from "pg-boss";

/**
 * Stub handler for internet expansion jobs.
 */
export async function handleInternetExpansion(jobs: Job[]): Promise<void> {
  for (const job of jobs) {
    console.info(`[stub] Internet expansion job received: ${job.id}`);
  }
}

/**
 * Stub handler for description fetch jobs.
 */
export async function handleDescriptionFetch(jobs: Job[]): Promise<void> {
  for (const job of jobs) {
    console.info(`[stub] Description fetch job received: ${job.id}`);
  }
}

/**
 * Stub handler for role taxonomy expansion jobs.
 */
export async function handleRoleTaxonomy(jobs: Job[]): Promise<void> {
  for (const job of jobs) {
    console.info(`[stub] Role taxonomy job received: ${job.id}`);
  }
}
