import { describe, expect, test, vi } from "vitest";
import {
  migrateLeaves,
  type Database,
  type MigrationResult,
  type RawSql,
  type UserProfileRow,
} from "./migrate-leaves";
import { ID_A, makeLeaf } from "./__fixtures__";

/**
 * `migrateLeaves` is SHIPPED FOR FUTURE USE and is NOT exercised against a real
 * database in this PR (plan §12). It depends only on a tiny STRUCTURAL
 * `Database` interface (`{ execute(query): Promise<{ rows }> }`), not on
 * `drizzle-orm`, so a hand-rolled fake lets us assert the orchestration logic
 * and the SQL-string SHAPE with no DB connection.
 *
 * Scope (Issue I6): `PreferenceTreeSchema` pins `schemaVersion` to the literal
 * 1, so any row that PARSES has `schemaVersion === 1`, which is `>=
 * toSchemaVersion (1)` and is therefore always SKIPPED; a row that does NOT
 * parse is a parseError. With the only legal `toSchemaVersion` (1) it is
 * structurally impossible to drive a `rewritten` row through a parsed tree, so
 * the UPDATE write path is unreachable here. These tests assert the reachable
 * branches (scanned / skipped / parseErrors, SQL shape, no UPDATE).
 *
 * TODO(future migration PR): exercising the UPDATE / optimistic-lock branch
 * (MG-X1) requires a future `toSchemaVersion: 2` (not in this schema) or a
 * structurally-invisible composition-change migration; OUT OF SCOPE here. A
 * live-Postgres test (MG-X2) is likewise out of scope.
 */

/** A valid `schemaVersion: 1` preference tree blob (parses, so it is skipped). */
function validV1Tree(): unknown {
  return { schemaVersion: 1, leaves: [makeLeaf({ id: ID_A })] };
}

type ExecuteMock = ReturnType<typeof vi.fn<Database["execute"]>>;

/**
 * Build a fake `Database` that serves the queued `rows` responses in order and
 * returns an empty batch once the queue is exhausted (so a follow-up SELECT
 * always terminates the loop). The `vi.fn()` captures every `execute` call for
 * SQL-shape assertions.
 */
function makeFakeDb(batches: UserProfileRow[][]): {
  db: Database;
  execute: ExecuteMock;
} {
  let call = 0;
  const execute = vi.fn<Database["execute"]>(() => {
    const rows = batches[call] ?? [];
    call += 1;
    return Promise.resolve({ rows });
  });
  return { db: { execute }, execute };
}

/** Extract the captured RawSql from the nth execute call. */
function callSql(execute: ExecuteMock, index: number): RawSql {
  return execute.mock.calls[index][0];
}

/**
 * True if any captured execute call is an UPDATE *write* statement. Matches
 * the `UPDATE user_profile SET` write specifically — NOT the bare substring
 * "UPDATE", because the SELECT carries a `FOR UPDATE SKIP LOCKED` clause that
 * also contains the word.
 */
function issuedUpdate(execute: ExecuteMock): boolean {
  return execute.mock.calls.some((c) => /UPDATE user_profile\s+SET/.test(c[0].text));
}

const PREDICATE = { fromSlugs: ["exclusions"] };
const TARGET = { toSlug: "deal-breakers", toPath: ["deal-breakers"] };

describe("migrateLeaves — orchestration (fake Database)", () => {
  // MG-1 / I6 — a valid v1 row parses but is SKIPPED (1 >= toSchemaVersion 1);
  // dryRun issues no UPDATE.
  test("dryRun skips an already-current v1 row and issues no UPDATE", async () => {
    const { db, execute } = makeFakeDb([
      [{ id: "id-1", preference_tree: validV1Tree(), updated_at: "t0" }],
    ]);

    const result = await migrateLeaves(db, {
      toSchemaVersion: 1,
      predicate: PREDICATE,
      target: TARGET,
      dryRun: true,
    });

    expect(result).toEqual<MigrationResult>({
      scanned: 1,
      rewritten: 0,
      skipped: 1,
      parseErrors: 0,
    });
    expect(issuedUpdate(execute)).toBe(false);
  });

  // MG-2 — an invalid stored tree is counted as a parseError, not thrown.
  test("counts an unparseable stored tree as a parseError without throwing", async () => {
    const { db, execute } = makeFakeDb([
      [{ id: "id-1", preference_tree: { foo: 1 }, updated_at: "t0" }],
    ]);

    const result = await migrateLeaves(db, {
      toSchemaVersion: 1,
      predicate: PREDICATE,
      target: TARGET,
    });

    expect(result).toEqual<MigrationResult>({
      scanned: 1,
      rewritten: 0,
      skipped: 0,
      parseErrors: 1,
    });
    expect(issuedUpdate(execute)).toBe(false);
  });

  // MG-3 — SELECT statement shape: cursor pagination + FOR UPDATE SKIP LOCKED.
  test("issues a single SELECT with the cursor/lock shape and default params", async () => {
    const { db, execute } = makeFakeDb([[]]);

    await migrateLeaves(db, {
      toSchemaVersion: 1,
      predicate: PREDICATE,
      target: TARGET,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const { text, params } = callSql(execute, 0);

    // Clauses appear in order.
    expect(text).toMatch(
      /SELECT id, preference_tree, updated_at[\s\S]*FROM user_profile[\s\S]*WHERE id >[\s\S]*ORDER BY id[\s\S]*LIMIT[\s\S]*FOR UPDATE SKIP LOCKED/,
    );
    // Default cursor "" and default batchSize 1000.
    expect(params).toEqual(["", 1000]);
    // One `?` placeholder per interpolation; count matches params length.
    expect((text.match(/\?/g) ?? []).length).toBe(params.length);
    expect(issuedUpdate(execute)).toBe(false);
  });

  // MG-4 — empty first batch terminates immediately.
  test("returns all-zero counts and one SELECT for an empty table", async () => {
    const { db, execute } = makeFakeDb([[]]);

    const result = await migrateLeaves(db, {
      toSchemaVersion: 1,
      predicate: PREDICATE,
      target: TARGET,
    });

    expect(result).toEqual<MigrationResult>({
      scanned: 0,
      rewritten: 0,
      skipped: 0,
      parseErrors: 0,
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(issuedUpdate(execute)).toBe(false);
  });

  // MG-5 — a partial batch (rows < batchSize) breaks the loop with no second
  // SELECT.
  test("terminates after a partial batch without a follow-up SELECT", async () => {
    const { db, execute } = makeFakeDb([
      [{ id: "id-1", preference_tree: validV1Tree(), updated_at: "t0" }],
    ]);

    const result = await migrateLeaves(db, {
      toSchemaVersion: 1,
      predicate: PREDICATE,
      target: TARGET,
      batchSize: 2,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual<MigrationResult>({
      scanned: 1,
      rewritten: 0,
      skipped: 1,
      parseErrors: 0,
    });
  });

  // MG-6 — a full batch (rows === batchSize) triggers a follow-up SELECT, with
  // the cursor advanced to the last row's id, until a short/empty batch breaks.
  test("issues a follow-up SELECT advancing the cursor after a full batch", async () => {
    const { db, execute } = makeFakeDb([
      [{ id: "id-1", preference_tree: validV1Tree(), updated_at: "t0" }],
      [], // follow-up SELECT returns empty -> break
    ]);

    const result = await migrateLeaves(db, {
      toSchemaVersion: 1,
      predicate: PREDICATE,
      target: TARGET,
      batchSize: 1,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    // First SELECT uses the default cursor "".
    expect(callSql(execute, 0).params).toEqual(["", 1]);
    // Second SELECT's cursor advanced to the first row's id.
    expect(callSql(execute, 1).params).toEqual(["id-1", 1]);
    expect(result.scanned).toBe(1);
    expect(result.skipped).toBe(1);
    expect(issuedUpdate(execute)).toBe(false);
  });

  // MG-7 — a custom batchSize flows into the LIMIT param.
  test("flows a custom batchSize into the LIMIT param", async () => {
    const { db, execute } = makeFakeDb([[]]);

    await migrateLeaves(db, {
      toSchemaVersion: 1,
      predicate: PREDICATE,
      target: TARGET,
      batchSize: 37,
    });

    expect(callSql(execute, 0).params).toEqual(["", 37]);
  });
});
