import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { format as formatSqlLib } from "sql-formatter";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | undefined;

// Redact params for queries touching auth tables — `session.token`,
// `verification.value`, and `account` OAuth-token columns arrive as WHERE
// or SET binds and must never be logged.
const SENSITIVE_TABLE_RE = /"(session|verification|account)"/i;

function formatSql(query: string): string {
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
}

function buildLogger() {
  if (process.env.LOG_SQL !== "1") return undefined;
  return {
    logQuery(query: string, params: unknown[]): void {
      const pretty = formatSql(query);
      if (SENSITIVE_TABLE_RE.test(query)) {
        console.log(`[sql]\n${pretty}\n-- params redacted (auth table)`);
      } else if (params.length > 0) {
        console.log(`[sql]\n${pretty}\n-- params:`, params);
      } else {
        console.log(`[sql]\n${pretty}`);
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
