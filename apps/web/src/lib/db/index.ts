import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | undefined;

function createDb(): Db {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return drizzle(postgres(connectionString), { schema });
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
