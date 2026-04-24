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
  // Schedule flush callback and a belt-and-braces timeout; whichever fires
  // first will call process.exit. We avoid a synchronous process.exit here
  // so the pino-pretty worker thread (LOG_PRETTY=1) has a chance to drain
  // the final log line before the process terminates. A synchronous
  // `throw` is the only way to block further top-level execution while
  // the scheduled callbacks run on the next tick; Node's uncaught
  // exception handler will still exit with a non-zero code if for some
  // reason the callbacks never fire.
  log.flush(() => process.exit(1));
  setTimeout(() => process.exit(1), 500);
  throw new Error("DATABASE_URL environment variable is required");
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
