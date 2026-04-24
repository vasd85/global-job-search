import type { PgBoss } from "pg-boss";
import type { Database } from "@gjs/db";
import { VENDOR_QUEUES, FUTURE_QUEUES } from "@gjs/ingestion";
import { createLogger } from "@gjs/logger";
import { createPollCompanyHandler } from "./poll-company";
import { createLlmScoringHandler } from "./llm-scoring";
import { createInternetExpansionHandler } from "./internet-expansion";
import {
  handleDescriptionFetch,
  handleRoleTaxonomy,
} from "./stubs";
import { getAppConfigValue } from "../lib/app-config";

const log = createLogger("handlers");

/** Fallback if config row is missing or invalid. */
const DEFAULT_VENDOR_CONCURRENCY = 5;

/** Concurrent LLM scoring jobs (global, not per-user for MVP). */
const SCORING_CONCURRENCY = 3;

/** One expansion job at a time per worker (per-user singleton enforced by job key). */
const EXPANSION_CONCURRENCY = 1;

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

  // Load vendor concurrency from config (requires restart to change).
  // Coerce with Number() before clamping: getAppConfigValue performs an
  // unsafe `value as T` cast, so a non-numeric string stored in jsonb
  // would produce NaN from Math.floor, and Math.max(1, NaN) = NaN.
  const rawConcurrency = Number(
    await getAppConfigValue<number>(
      db,
      "polling.vendor_concurrency",
      DEFAULT_VENDOR_CONCURRENCY,
    ),
  );
  const vendorConcurrency = Number.isNaN(rawConcurrency)
    ? DEFAULT_VENDOR_CONCURRENCY
    : Math.max(1, Math.floor(rawConcurrency));

  // Register ATS polling handlers (one per vendor, same handler function)
  const pollHandler = createPollCompanyHandler(db);

  for (const queue of Object.values(VENDOR_QUEUES)) {
    await boss.work(queue, { localConcurrency: vendorConcurrency }, pollHandler);
    log.info({ queue, concurrency: vendorConcurrency }, "Handler registered");
  }

  // Register LLM scoring handler
  await boss.work(
    FUTURE_QUEUES.llmScoring,
    { localConcurrency: SCORING_CONCURRENCY },
    createLlmScoringHandler(db),
  );
  log.info(
    { queue: FUTURE_QUEUES.llmScoring, concurrency: SCORING_CONCURRENCY },
    "Handler registered",
  );

  // Register internet expansion handler
  await boss.work(
    FUTURE_QUEUES.internetExpansion,
    { localConcurrency: EXPANSION_CONCURRENCY },
    createInternetExpansionHandler(db, boss),
  );
  log.info(
    { queue: FUTURE_QUEUES.internetExpansion, concurrency: EXPANSION_CONCURRENCY },
    "Handler registered",
  );

  // Register stub handlers for remaining future queues
  await boss.work(FUTURE_QUEUES.descriptionFetch, handleDescriptionFetch);
  log.info(
    { queue: FUTURE_QUEUES.descriptionFetch, stub: true },
    "Handler registered",
  );

  await boss.work(FUTURE_QUEUES.roleTaxonomy, handleRoleTaxonomy);
  log.info(
    { queue: FUTURE_QUEUES.roleTaxonomy, stub: true },
    "Handler registered",
  );
}
