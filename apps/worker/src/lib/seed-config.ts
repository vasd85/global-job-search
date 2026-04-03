import type { Database } from "@gjs/db";
import { appConfig } from "@gjs/db/schema";

/**
 * Seed default polling config rows into app_config.
 *
 * Uses onConflictDoNothing() so manually-edited values are preserved.
 * Safe to call on every worker startup.
 */
export async function seedPollingConfig(db: Database): Promise<void> {
  await db
    .insert(appConfig)
    .values([
      {
        key: "polling.vendor_concurrency",
        value: 5,
        description:
          "Max simultaneous polls per ATS vendor. Requires worker restart to take effect.",
      },
      {
        key: "polling.jitter_max_ms",
        value: 5000,
        description:
          "Random delay ceiling (ms) before each poll. Takes effect on next poll cycle.",
      },
      {
        key: "polling.stale_threshold_days",
        value: 7,
        description:
          "Days a missing job is kept open before marking stale. Takes effect on next poll cycle.",
      },
      {
        key: "polling.closed_threshold_days",
        value: 30,
        description:
          "Days before a stale job is marked closed. Takes effect on next poll cycle.",
      },
    ])
    .onConflictDoNothing();
}
