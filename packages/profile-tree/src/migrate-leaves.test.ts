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
 * `drizzle-orm`, so a hand-rolled fake lets us assert the orchestration logic,
 * the SQL-string SHAPE, and the write params with no DB connection.
 *
 * Contract (per the parse-transform-parse implementation). Per row:
 *   1. Parse the stored tree — a parse failure increments `parseErrors` and is
 *      never thrown (the row is logged-and-skipped, the run continues).
 *   2. Apply `moveLeaves(tree, predicate, target)`.
 *   3. Change-detection idempotency: if the transform is a NO-OP
 *      (`isDeepStrictEqual(next, tree)` — the predicate matched nothing, or
 *      every match was already migrated and so no longer matches) the row is
 *      `skipped` and not written. Re-running the same migration converges.
 *   4. Post-transform parse: a transform that produced a schema-invalid tree
 *      (e.g. a `MoveTarget.toPath` that does not terminate at `toSlug`, which
 *      `moveLeaves` deliberately does NOT validate) THROWS and is never
 *      written — fail-fast for BOTH real and dry runs, before `rewritten` is
 *      incremented. This is the persistence-boundary guard.
 *   5. Otherwise `rewritten += 1`; a real run issues the optimistic-locked
 *      `UPDATE user_profile SET ... WHERE id = ? AND updated_at = ?`; a dry run
 *      validates (step 4) but issues no UPDATE.
 *
 * The `schemaVersion > toSchemaVersion` downgrade-guard (skip rows already
 * ahead of the target) is genuinely unreachable through a parsed tree:
 * `PreferenceTreeSchema` pins `schemaVersion` to the literal 1 and
 * `toSchemaVersion` is pinned to 1, so a parsed tree never satisfies the
 * strict `>`. It is therefore not covered here; idempotency is provided by the
 * change-detection of step 3, not by that field.
 */

/** A valid `schemaVersion: 1` tree blob with a single `industry` leaf. */
function validV1Tree(): unknown {
  return { schemaVersion: 1, leaves: [makeLeaf({ id: ID_A })] };
}

/**
 * A valid tree whose only leaf is already at `branchSlug: "other"` — i.e. the
 * post-migration shape of the `industry → other` move. Re-running that move
 * against this row is a no-op (the `industry` predicate matches nothing).
 */
function alreadyMigratedTree(): unknown {
  return {
    schemaVersion: 1,
    leaves: [makeLeaf({ id: ID_A, branchSlug: "other", branchPath: ["other"] })],
  };
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

/**
 * The single captured `UPDATE user_profile SET ...` RawSql, or undefined if no
 * write was issued. Used to assert the write payload (serialized tree) and the
 * optimistic-lock WHERE params.
 */
function updateCall(execute: ExecuteMock): RawSql | undefined {
  return execute.mock.calls
    .map((c) => c[0])
    .find((q) => /UPDATE user_profile\s+SET/.test(q.text));
}

// Shared NON-MATCHING migration: the fixture leaf's branchSlug is `industry`,
// which is NOT in `fromSlugs: ["exclusions"]`, so `moveLeaves` is a no-op for
// `validV1Tree()`. Rows are therefore SKIPPED by change-detection (step 3), not
// by any version guard. Used by the orchestration/pagination tests that only
// need a parseable, non-rewritten row.
const PREDICATE = { fromSlugs: ["exclusions"] };
const TARGET = { toSlug: "deal-breakers", toPath: ["deal-breakers"] };

describe("migrateLeaves — orchestration (fake Database)", () => {
  // MG-1 — a parseable row whose leaf does not match the predicate is a no-op
  // (change-detection) and is SKIPPED; dryRun issues no UPDATE.
  test("dryRun skips a non-matching row (no-op) and issues no UPDATE", async () => {
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
  // SELECT. The single row is non-matching, so it is skipped (no-op), not
  // rewritten — the focus here is the pagination break.
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
  // The row is non-matching (skipped, no-op); the focus here is cursor advance.
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

// A MATCHING migration: the fixture leaf's branchSlug is `industry`, which IS
// in `fromSlugs`, and `other` is a real depth-1 non-container slug, so the
// transform produces a CHANGED, schema-valid tree -> a rewrite.
const MATCH_PREDICATE = { fromSlugs: ["industry"] };
const MATCH_TARGET = { toSlug: "other", toPath: ["other"] };

describe("migrateLeaves — rewrite, validation & idempotency", () => {
  // MG-8 — the core write path: a matching row produces a changed, valid tree
  // and is rewritten with exactly one optimistic-locked UPDATE. The serialized
  // payload deep-equals the moved tree; the WHERE carries the row id + original
  // updated_at. (Would FAIL against the old `>=` skip / no-revalidation code,
  // which never reached the write path through a parsed tree.)
  test("rewrites a matching row with one optimistic-locked UPDATE carrying the moved tree", async () => {
    const row: UserProfileRow = {
      id: "id-1",
      preference_tree: validV1Tree(),
      updated_at: "t-original",
    };
    const { db, execute } = makeFakeDb([[row]]);

    const result = await migrateLeaves(db, {
      toSchemaVersion: 1,
      predicate: MATCH_PREDICATE,
      target: MATCH_TARGET,
    });

    expect(result).toEqual<MigrationResult>({
      scanned: 1,
      rewritten: 1,
      skipped: 0,
      parseErrors: 0,
    });

    // Exactly one write was issued.
    const writes = execute.mock.calls.filter((c) =>
      /UPDATE user_profile\s+SET/.test(c[0].text),
    );
    expect(writes).toHaveLength(1);

    const update = updateCall(execute);
    expect(update).toBeDefined();
    if (!update) return; // type-narrow for TS

    // SET preference_tree = ?, ... WHERE id = ? AND updated_at = ?
    expect(update.text).toMatch(
      /UPDATE user_profile\s+SET preference_tree =[\s\S]*updated_at = now\(\)[\s\S]*WHERE id =[\s\S]*AND updated_at =/,
    );

    const [serializedTree, whereId, whereUpdatedAt] = update.params;
    // The payload is the moved tree: industry leaf rewritten to `other`,
    // every other field preserved. Parse it back and deep-equal (never
    // string-compare serialized JSON).
    expect(JSON.parse(serializedTree as string)).toEqual({
      schemaVersion: 1,
      leaves: [
        { ...makeLeaf({ id: ID_A }), branchSlug: "other", branchPath: ["other"] },
      ],
    });
    // Optimistic-lock guard targets this row at its original updated_at.
    expect(whereId).toBe(row.id);
    expect(whereUpdatedAt).toBe(row.updated_at);
  });

  // MG-9 — dryRun on a MATCHING row counts the rewrite (proving the
  // post-transform validation ran and PASSED) but issues NO write. This is the
  // pre-flight check: validate every row without committing. (Would FAIL
  // against the old code, which never counted a parsed row as rewritten.)
  test("dryRun counts a matching row as rewritten, validates it, but issues no UPDATE", async () => {
    const row: UserProfileRow = {
      id: "id-1",
      preference_tree: validV1Tree(),
      updated_at: "t0",
    };
    const { db, execute } = makeFakeDb([[row]]);

    const result = await migrateLeaves(db, {
      toSchemaVersion: 1,
      predicate: MATCH_PREDICATE,
      target: MATCH_TARGET,
      dryRun: true,
    });

    expect(result).toEqual<MigrationResult>({
      scanned: 1,
      rewritten: 1,
      skipped: 0,
      parseErrors: 0,
    });
    // No write committed, and it did not throw -> validation passed.
    expect(issuedUpdate(execute)).toBe(false);
  });

  // MG-10 — persistence-boundary guard: a target whose `toPath` does not
  // terminate at `toSlug` makes `moveLeaves` emit a schema-invalid leaf (path
  // ["role"] but slug "industry"). The post-transform re-parse must THROW
  // before any write, closing the corruption path. (Would FAIL against the old
  // code, which had no post-transform re-parse and would have written the
  // corrupt tree.)
  test("throws on a transform that yields a schema-invalid tree and issues no UPDATE", async () => {
    const row: UserProfileRow = {
      id: "row-bad",
      // mergeSourceTree has matching `exclusions` leaves so the move fires.
      preference_tree: { schemaVersion: 1, leaves: [makeLeaf({ id: ID_A, branchSlug: "exclusions", branchPath: ["exclusions"], polarity: "exclude" })] },
      updated_at: "t0",
    };
    const { db, execute } = makeFakeDb([[row]]);

    await expect(
      migrateLeaves(db, {
        toSchemaVersion: 1,
        // Matches the `exclusions` leaf; `industry` is a valid non-container
        // slug so moveLeaves does NOT throw, but ["role"] does not terminate at
        // "industry" -> the produced leaf fails LeafSchema.
        predicate: { fromSlugs: ["exclusions"] },
        target: { toSlug: "industry", toPath: ["role"] },
      }),
    ).rejects.toThrow(/transformed tree for row .* is invalid/);

    expect(issuedUpdate(execute)).toBe(false);
  });

  // MG-11 — idempotency / convergence: a row already in the post-migration
  // shape (leaf at `other`) run with the same `industry -> other` migration is
  // a no-op (the predicate now matches nothing) -> skipped, not rewritten, no
  // UPDATE. Re-running the migration therefore converges. (Would FAIL against
  // the old code only in that the old skip reason was the version guard, not
  // change-detection; here we prove the change-detection path.)
  test("treats an already-migrated row as a no-op (skipped, no UPDATE)", async () => {
    const row: UserProfileRow = {
      id: "id-1",
      preference_tree: alreadyMigratedTree(),
      updated_at: "t0",
    };
    const { db, execute } = makeFakeDb([[row]]);

    const result = await migrateLeaves(db, {
      toSchemaVersion: 1,
      predicate: MATCH_PREDICATE,
      target: MATCH_TARGET,
    });

    expect(result).toEqual<MigrationResult>({
      scanned: 1,
      rewritten: 0,
      skipped: 1,
      parseErrors: 0,
    });
    expect(issuedUpdate(execute)).toBe(false);
  });
});
