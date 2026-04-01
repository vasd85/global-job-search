import { PgBoss } from "pg-boss";

let _boss: PgBoss | undefined;

/**
 * Returns a lazy-initialized pg-boss instance. Used by the web app
 * to enqueue jobs (e.g. from the dispatch-polling route). The instance
 * is started once and reused across requests.
 */
export async function getQueue(): Promise<PgBoss> {
  if (!_boss) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for pg-boss");
    }
    _boss = new PgBoss(connectionString);
    await _boss.start();
  }
  return _boss;
}
