import { PgBoss } from "pg-boss";
import { db } from "@gjs/db";
import { createLogger } from "@gjs/logger";
import { registerHandlers } from "./handlers";
import { seedPollingConfig } from "./lib/seed-config";

const log = createLogger("worker");

/**
 * Flush the pino logger before process.exit to avoid losing the last
 * log line when a worker-thread transport (LOG_PRETTY=1) is active.
 * The default sync destination flushes on every write, so this is a
 * no-op there. Bounded by a short timeout so exit cannot hang if the
 * transport worker is wedged.
 */
async function exitWithFlush(code: number): Promise<never> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 500);
    log.flush(() => {
      clearTimeout(timer);
      resolve();
    });
  });
  process.exit(code);
}

// ─── Environment ────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  log.error("DATABASE_URL environment variable is required");
  await exitWithFlush(1);
  // Unreachable: exitWithFlush awaits the flush and then calls process.exit.
  // TypeScript does not propagate `never` through `await Promise<never>`,
  // so this throw exists purely to narrow DATABASE_URL below.
  throw new Error("unreachable");
}

// ─── pg-boss instance ───────────────────────────────────────────────────────

const boss = new PgBoss(DATABASE_URL);

boss.on("error", (error: Error) => {
  log.error({ err: error }, "pg-boss error");
});

// ─── Lifecycle ──────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  await boss.start();
  log.info("pg-boss started");
  log.info(
    { logLevel: process.env.LOG_LEVEL ?? "info (default)" },
    "Worker log level",
  );

  await seedPollingConfig(db);
  log.info("Polling config seeded");

  await registerHandlers(boss, db);
  log.info("All handlers registered, ready for jobs");
}

async function shutdown(): Promise<void> {
  log.info("Shutting down");
  await boss.stop({ graceful: true, timeout: 30_000 });
  log.info("pg-boss stopped");
  await exitWithFlush(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

start().catch(async (err: unknown) => {
  log.error({ err }, "Failed to start");
  await exitWithFlush(1);
});
