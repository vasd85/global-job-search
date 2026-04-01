import type { Job } from "pg-boss";

/**
 * Stub handler for LLM scoring jobs. Logs receipt and completes immediately.
 * Real implementation will be added in a future phase.
 */
export async function handleLlmScoring(jobs: Job[]): Promise<void> {
  for (const job of jobs) {
    console.info(`[stub] LLM scoring job received: ${job.id}`);
  }
}

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
