import { PgBoss } from "pg-boss";

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
    // If start fails, allow retry on next call
    _bossPromise.catch(() => {
      _bossPromise = undefined;
    });
  }
  return _bossPromise;
}
