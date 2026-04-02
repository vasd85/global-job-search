import { eq } from "drizzle-orm";
import type { Database } from "@gjs/db";
import { appConfig } from "@gjs/db/schema";

/**
 * Load a value from the app_config table by key.
 * Returns defaultValue if the key is not found.
 */
export async function getAppConfigValue<T>(
  db: Database,
  key: string,
  defaultValue: T,
): Promise<T> {
  const rows = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, key))
    .limit(1);

  if (rows.length === 0) return defaultValue;

  return rows[0].value as T;
}
