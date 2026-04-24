import { PgBoss } from "pg-boss";
import { createLogger } from "@gjs/logger";

const log = createLogger("queue");

let _bossPromise: Promise<PgBoss> | undefined;

/**
 * Returns a lazy-initialized pg-boss instance. Uses a promise-based
 * singleton to prevent race conditions when multiple callers invoke
 * getQueue() concurrently. If start fails, the promise is cleared
 * so subsequent calls can retry.
 */
export function getQueue(): Promise<PgBoss> {
  if (!_bossPromise) {
    _bossPromise = (async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error("DATABASE_URL is required for pg-boss");
      }
      const boss = new PgBoss(connectionString);
      await boss.start();
      return boss;
    })();
    // If start fails, log the error and clear the promise so subsequent
    // calls can retry. The error is still propagated to the original caller
    // via the shared promise; this handler ensures it is logged even in
    // fire-and-forget patterns.
    _bossPromise.catch((err) => {
      log.error({ err }, "pg-boss start failed, will retry on next getQueue() call");
      _bossPromise = undefined;
    });
  }
  return _bossPromise;
}
