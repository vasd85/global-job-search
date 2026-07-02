import { isDeepStrictEqual } from "node:util";
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
  /** Target schema version. Rows whose tree is already *ahead* of this
   * version (`schemaVersion > toSchemaVersion`) are skipped so a
   * migration never downgrades a row. Idempotency for same-version
   * composition migrations comes from change-detection, not this field
   * (see {@link migrateLeaves}). Pinned to `1` — the only schema version
   * today; bumping `schemaVersion` is out of scope until a v2 exists. */
  toSchemaVersion: 1;

  /** Move predicate / target. Pure transformation applied per row. */
  predicate: MovePredicate;
  target: MoveTarget;

  /** When true, parse-transform-parse every row (including the
   * post-transform re-parse that throws on an invalid result) but skip
   * the UPDATE write. Returns the would-write count. This is the
   * pre-flight check: it asserts every row parses post-transform before
   * any write is committed. */
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
  /** Rows skipped: either already ahead of `toSchemaVersion`, or the
   * transform was a no-op (the move predicate matched nothing / the row
   * is already migrated). The no-op case is the idempotency mechanism. */
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
 * Per row this is parse-transform-parse:
 *   1. Parse the stored tree (a parse failure is counted, never thrown).
 *   2. Skip rows already *ahead* of `opts.toSchemaVersion`
 *      (`schemaVersion > toSchemaVersion`) so a migration never
 *      downgrades a row. Never fires today — there is one schema version.
 *   3. Apply {@link moveLeaves}.
 *   4. Re-parse the result with {@link PreferenceTreeSchema}. An invalid
 *      transform (e.g. a {@link MoveTarget.toPath} that does not
 *      terminate at `toSlug`, which `moveLeaves` does not validate)
 *      THROWS and is never written — fail-fast for both real and dry runs.
 *
 * Idempotency is change-detection: if the transform is a no-op (the move
 * predicate matched nothing, or every match was already migrated and so
 * no longer matches) the row is counted as `skipped` and not rewritten.
 * Re-running the same migration therefore converges. This subsumes the
 * design's "predicate handles same-version idempotency" note — same-version
 * composition migrations (e.g. moving `skills/avoid` leaves to
 * `skills/grow` without bumping the version) are first-class.
 *
 * Note: `moveLeaves` preserves `schemaVersion`, so this never bumps it.
 * Actual schema-version bumping (writing `schemaVersion := toSchemaVersion`)
 * is out of scope until a v2 schema exists.
 *
 * SHIPPED FOR FUTURE USE — not exercised against a real DB in this PR
 * (`substrate-cutover` and the first composition-change migration wire the
 * real DB in), but unit-testable via a fake {@link Database}.
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
      // Never downgrade: skip rows already ahead of the target version.
      // With a single schema version today this never fires.
      if (tree.schemaVersion > opts.toSchemaVersion) {
        result.skipped += 1;
        continue;
      }

      const next = moveLeaves(tree, opts.predicate, opts.target);

      // Change-detection idempotency: a no-op move (predicate matched
      // nothing / already migrated) is not written.
      if (isDeepStrictEqual(next, tree)) {
        result.skipped += 1;
        continue;
      }

      // Post-transform parse: a transform that produced a schema-invalid
      // tree (e.g. a bad MoveTarget.toPath) must never reach the DB.
      const revalidated = PreferenceTreeSchema.safeParse(next);
      if (!revalidated.success) {
        throw new Error(
          `migrateLeaves: transformed tree for row ${row.id} is invalid: ${revalidated.error.issues.map((i) => i.message).join("; ")}`,
        );
      }

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
