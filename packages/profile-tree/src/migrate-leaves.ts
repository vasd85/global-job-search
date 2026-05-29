import { PreferenceTreeSchema, type PreferenceTree } from "./leaf-schema";
import { moveLeaves, type MovePredicate, type MoveTarget } from "./move-leaves";

/**
 * Minimal structural row shape returned by the cursor query. The DB driver
 * (`@gjs/db`'s drizzle instance, wired by `substrate-cutover`) returns rows
 * with at least these columns; extra columns are ignored.
 */
export interface UserProfileRow {
  id: string;
  preference_tree: unknown;
  updated_at: unknown;
}

/**
 * Minimal structural surface this module needs from the DB. We deliberately
 * avoid importing `@gjs/db` or `drizzle-orm` so the module stays a pure,
 * zod-only package that typechecks before the `preference_tree` column
 * exists. `substrate-cutover` adapts the real drizzle `Database` to this
 * interface (raw SQL execution) when it wires `migrateLeaves` in.
 */
export interface Database {
  execute(query: RawSql): Promise<{ rows: UserProfileRow[] }>;
}

/**
 * Opaque raw-SQL query produced by the {@link sql} tag. Carries the SQL text
 * plus positional params so the adapter can forward them to the driver
 * without this module depending on `drizzle-orm`'s `sql` helper.
 */
export interface RawSql {
  readonly text: string;
  readonly params: readonly unknown[];
}

/** Tiny tagged-template builder for parameterised raw SQL. */
function sql(strings: TemplateStringsArray, ...params: unknown[]): RawSql {
  return { text: strings.join("?"), params };
}

export interface MigrationOptions {
  /** Schema version this migration writes. Rows already at >= this
   * version are skipped (idempotency). */
  toSchemaVersion: 1;

  /** Move predicate / target. Pure transformation applied per row. */
  predicate: MovePredicate;
  target: MoveTarget;

  /** When true, parse-transform-parse every row but skip the UPDATE
   * write. Returns the would-write count. Useful for pre-flight
   * checks before a composition-change migration. */
  dryRun?: boolean;

  /** Row batch size for the cursor pagination. Default 1000 per
   * research §External findings. */
  batchSize?: number;
}

export interface MigrationResult {
  /** Rows examined. */
  scanned: number;
  /** Rows that were rewritten (or would be, in dry-run). */
  rewritten: number;
  /** Rows skipped because already at toSchemaVersion. */
  skipped: number;
  /** Rows that failed parse-old (logged, not thrown). */
  parseErrors: number;
}

const DEFAULT_BATCH_SIZE = 1000;

/**
 * DB-level wrapper around {@link moveLeaves} + the JSONB read/write
 * round-trip. Iterates `user_profile` rows with cursor pagination and a
 * `FOR UPDATE SKIP LOCKED` lock, applies the pure transform, and writes
 * back with an optimistic-lock guard (`WHERE updated_at = $original`).
 *
 * Idempotency contract: keyed off `tree.schemaVersion`. A row whose tree
 * already has `schemaVersion >= opts.toSchemaVersion` is skipped. When a
 * composition-change is structurally invisible at the schemaVersion level,
 * the caller is responsible for an explicit "already migrated?" check
 * inside the move predicate.
 *
 * SHIPPED FOR FUTURE USE — not exercised by this PR. `substrate-cutover`
 * (and the first composition-change migration) wire the real DB in.
 */
export async function migrateLeaves(
  db: Database,
  opts: MigrationOptions,
): Promise<MigrationResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const result: MigrationResult = {
    scanned: 0,
    rewritten: 0,
    skipped: 0,
    parseErrors: 0,
  };

  let cursor = "";
  for (;;) {
    const { rows } = await db.execute(
      sql`SELECT id, preference_tree, updated_at
          FROM user_profile
          WHERE id > ${cursor}
          ORDER BY id
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED`,
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      result.scanned += 1;
      cursor = row.id;

      const parsed = PreferenceTreeSchema.safeParse(row.preference_tree);
      if (!parsed.success) {
        result.parseErrors += 1;
        continue;
      }

      const tree: PreferenceTree = parsed.data;
      if (tree.schemaVersion >= opts.toSchemaVersion) {
        result.skipped += 1;
        continue;
      }

      const next = moveLeaves(tree, opts.predicate, opts.target);
      result.rewritten += 1;

      if (opts.dryRun) continue;

      await db.execute(
        sql`UPDATE user_profile
            SET preference_tree = ${JSON.stringify(next)}, updated_at = now()
            WHERE id = ${row.id} AND updated_at = ${row.updated_at}`,
      );
    }

    if (rows.length < batchSize) break;
  }

  return result;
}
