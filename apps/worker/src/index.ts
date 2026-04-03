import { PgBoss } from "pg-boss";
import { db } from "@gjs/db";
import { registerHandlers } from "./handlers";
import { seedPollingConfig } from "./lib/seed-config";

// ─── Environment ────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[worker] DATABASE_URL environment variable is required");
  process.exit(1);
}

// ─── pg-boss instance ───────────────────────────────────────────────────────

const boss = new PgBoss(DATABASE_URL);

boss.on("error", (error: Error) => {
  console.error("[worker] pg-boss error:", error.message);
});

// ─── Lifecycle ──────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  await boss.start();
  console.info("[worker] pg-boss started");

  await seedPollingConfig(db);
  console.info("[worker] Polling config seeded");

  await registerHandlers(boss, db);
  console.info("[worker] All handlers registered -- ready for jobs");
}

async function shutdown(): Promise<void> {
  console.info("[worker] Shutting down...");
  await boss.stop({ graceful: true, timeout: 30_000 });
  console.info("[worker] pg-boss stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

start().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[worker] Failed to start:", message);
  process.exit(1);
});
