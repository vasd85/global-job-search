import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createLogger } from "@gjs/logger";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | undefined;

// Redact params for queries touching auth or secret tables. Each table
// below stores credential material that must never reach logs:
// `session.token`, `verification.value`, `account` OAuth-token columns,
// and `user_api_key` ciphertext/IV/authTag/fingerprint_hmac. Add any new
// table that stores secrets to this alternation.
const SENSITIVE_TABLE_RE = /"(session|verification|account|user_api_key)"/i;

const sqlLog = createLogger("sql");

function buildLogger() {
  if (process.env.LOG_SQL !== "1") return undefined;

  // Synchronous require via createRequire keeps sql-formatter off the
  // import graph of every @gjs/db consumer when LOG_SQL is unset.
  const require = createRequire(import.meta.url);
  const { format: formatSqlLib } = require("sql-formatter") as typeof import("sql-formatter");

  const formatSql = (query: string): string => {
    try {
      return formatSqlLib(query, {
        language: "postgresql",
        keywordCase: "upper",
        tabWidth: 2,
      });
    } catch {
      // sql-formatter can throw on unusual syntax; fall back to raw query.
      return query;
    }
  };

  return {
    logQuery(query: string, params: unknown[]): void {
      const pretty = formatSql(query);
      if (SENSITIVE_TABLE_RE.test(query)) {
        sqlLog.info(
          { query: pretty, params: "<redacted: auth or secret table>" },
          "query",
        );
      } else if (params.length > 0) {
        sqlLog.info({ query: pretty, params }, "query");
      } else {
        sqlLog.info({ query: pretty }, "query");
      }
    },
  };
}

function createDb(): Db {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return drizzle(postgres(connectionString), {
    schema,
    logger: buildLogger(),
  });
}

/** Lazy-initialized DB — safe to import at build time. */
export const db: Db = new Proxy({} as Db, {
  get(_, prop) {
    _db ??= createDb();
    const val: unknown = Reflect.get(_db, prop, _db);
    if (typeof val === "function") {
      return (val as (...args: unknown[]) => unknown).bind(_db);
    }
    return val;
  },
});

export type Database = Db;
