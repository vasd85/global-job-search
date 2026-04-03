import type { PgBoss } from "pg-boss";
import type { Database } from "@gjs/db";
import { VENDOR_QUEUES, FUTURE_QUEUES } from "@gjs/ingestion";
import { createPollCompanyHandler } from "./poll-company";
import { createLlmScoringHandler } from "./llm-scoring";
import {
  handleInternetExpansion,
  handleDescriptionFetch,
  handleRoleTaxonomy,
} from "./stubs";
import { getAppConfigValue } from "../lib/app-config";

/** Fallback if config row is missing or invalid. */
const DEFAULT_VENDOR_CONCURRENCY = 5;

/** Concurrent LLM scoring jobs (global, not per-user for MVP). */
const SCORING_CONCURRENCY = 3;

/**
 * Create all queues and register work handlers with pg-boss.
 *
 * Vendor queues get the real poll-company handler with concurrency 5.
 * The LLM scoring queue gets the real scoring handler with concurrency 3.
 * Remaining future queues get stub handlers that log and complete immediately.
 */
export async function registerHandlers(
  boss: PgBoss,
  db: Database
): Promise<void> {
  // Create all queues
  const allQueues = [
    ...Object.values(VENDOR_QUEUES),
    ...Object.values(FUTURE_QUEUES),
  ];

  for (const queue of allQueues) {
    await boss.createQueue(queue);
  }

  // Load vendor concurrency from config (requires restart to change)
  const rawConcurrency = await getAppConfigValue<number>(
    db,
    "polling.vendor_concurrency",
    DEFAULT_VENDOR_CONCURRENCY,
  );
  const vendorConcurrency = Math.max(1, Math.floor(rawConcurrency));

  // Register ATS polling handlers (one per vendor, same handler function)
  const pollHandler = createPollCompanyHandler(db);

  for (const queue of Object.values(VENDOR_QUEUES)) {
    await boss.work(queue, { localConcurrency: vendorConcurrency }, pollHandler);
    console.info(`[handlers] Registered ${queue} (concurrency: ${vendorConcurrency})`);
  }

  // Register LLM scoring handler
  await boss.work(
    FUTURE_QUEUES.llmScoring,
    { localConcurrency: SCORING_CONCURRENCY },
    createLlmScoringHandler(db),
  );
  console.info(`[handlers] Registered ${FUTURE_QUEUES.llmScoring} (concurrency: ${SCORING_CONCURRENCY})`);

  // Register stub handlers for remaining future queues
  await boss.work(FUTURE_QUEUES.internetExpansion, handleInternetExpansion);
  console.info(`[handlers] Registered ${FUTURE_QUEUES.internetExpansion} (stub)`);

  await boss.work(FUTURE_QUEUES.descriptionFetch, handleDescriptionFetch);
  console.info(`[handlers] Registered ${FUTURE_QUEUES.descriptionFetch} (stub)`);

  await boss.work(FUTURE_QUEUES.roleTaxonomy, handleRoleTaxonomy);
  console.info(`[handlers] Registered ${FUTURE_QUEUES.roleTaxonomy} (stub)`);
}
