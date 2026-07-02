import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { mutateLeaf } from "./mutate-leaf";
import type { Leaf, PreferenceTree } from "./leaf-schema";
import {
  ID_A,
  makeLeaf,
  multiBranchTree,
  singleLeafTree,
  TS,
} from "./__fixtures__";

/**
 * `mutateLeaf` returns a NEW tree with the matched leaf replaced by
 * `mutator(leaf)` and `updatedAt` re-stamped from the wall clock; it throws
 * when `leafId` is not found, leaves the input tree untouched, and does NOT
 * re-validate the mutator's output.
 *
 * `updatedAt = new Date().toISOString()` is stamped with the real clock, so
 * any test that asserts on the stamped value pins time with fake timers.
 */

// A second, distinct instant used to prove the stamp overwrites the fixture
// TS. `mutateLeaf` stamps via `new Date().toISOString()`, which ALWAYS emits
// millisecond precision (`...:00.000Z`), so the expected stamped value is the
// canonical toISOString() form of this instant — not the bare `Z` literal.
const TS2_INSTANT = "2026-05-29T13:30:00Z";
const STAMPED = new Date(TS2_INSTANT).toISOString();
const identity = (leaf: Leaf): Leaf => leaf;

describe("mutateLeaf", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TS2_INSTANT));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ML-1 — golden path: only the matched leaf changes; others are preserved by
  // reference (the `.map` returns the same object for non-matched indices).
  test("applies the mutator only to the matched leaf", () => {
    const tree = multiBranchTree();
    const result = mutateLeaf(tree, ID_A, (leaf) => ({
      ...leaf,
      claimText: "Principal Engineer",
    }));

    expect(result.schemaVersion).toBe(1);
    expect(result.leaves.length).toBe(4);

    const changed = result.leaves[0];
    expect(changed).toEqual({
      ...tree.leaves[0],
      claimText: "Principal Engineer",
      updatedAt: STAMPED,
    });

    // Unchanged leaves are reference-equal to the originals.
    expect(result.leaves[1]).toBe(tree.leaves[1]);
    expect(result.leaves[2]).toBe(tree.leaves[2]);
    expect(result.leaves[3]).toBe(tree.leaves[3]);
  });

  // ML-2 — updatedAt is unconditionally re-stamped, even by an identity mutator.
  test("re-stamps updatedAt even when the mutator is identity", () => {
    const tree = singleLeafTree();
    const result = mutateLeaf(tree, ID_A, identity);
    const leaf = result.leaves[0];

    expect(leaf.updatedAt).toBe(STAMPED);
    expect(leaf.updatedAt).not.toBe(TS);
    // The stamp is a valid ISO `Z` datetime (toISOString re-parses against
    // z.string().datetime()).
    expect(leaf.updatedAt.endsWith("Z")).toBe(true);
    expect(z.string().datetime().safeParse(leaf.updatedAt).success).toBe(true);
    expect(leaf.createdAt).toBe(TS);
    expect(leaf.id).toBe(ID_A);
    expect(leaf.claimText).toBe("fintech");
  });

  // ML-3 — idempotency via identity mutator under a FIXED clock (locked
  // fixture #10). Pinning time makes the re-stamp identical across both calls.
  // TODO: this proves SHAPE idempotency under a fixed clock only. Because
  // mutateLeaf ALWAYS re-stamps updatedAt from the wall clock, it is NOT
  // idempotent across differing clocks — the design explicitly states it "does
  // NOT enforce idempotency". Do not read ML-3 as a real-time guarantee.
  test("a repeated identity mutation under a fixed clock is shape-idempotent", () => {
    const tree = singleLeafTree();
    const t1 = mutateLeaf(tree, ID_A, identity);
    const t2 = mutateLeaf(t1, ID_A, identity);
    expect(t2).toEqual(t1);
  });

  // ML-4 — throws when leafId is not present.
  test("throws when the leafId is not found", () => {
    const tree = singleLeafTree();
    const missing = "deadbeef-dead-4dea-8dea-deaddeaddead";
    expect(() => mutateLeaf(tree, missing, identity)).toThrow(/Leaf not found/);
  });

  // ML-5 — input immutability.
  test("does not mutate the input tree", () => {
    const tree = multiBranchTree();
    const snapshot = structuredClone(tree);
    const result = mutateLeaf(tree, ID_A, (leaf) => ({
      ...leaf,
      claimText: "changed",
    }));
    expect(tree).toEqual(snapshot);
    expect(result).not.toBe(tree);
  });

  // ML-6 — empty tree has no leaf to match.
  test("throws on an empty tree (no leaves to match)", () => {
    const empty: PreferenceTree = { schemaVersion: 1, leaves: [] };
    expect(() => mutateLeaf(empty, ID_A, identity)).toThrow(/Leaf not found/);
  });

  // ML-7 — a mutator adding previously-absent optional fields is honored.
  // TODO(I4): mutateLeaf does NOT re-run LeafSchema, so a mutator could produce
  // a structurally-invalid leaf and it would still be stamped and returned. The
  // contract delegates validation to the caller.
  test("honors a mutator that adds previously-absent optional fields", () => {
    const tree = singleLeafTree();
    const result = mutateLeaf(tree, ID_A, (leaf) => ({
      ...leaf,
      note: "added",
      flaggedUncertain: true,
    }));
    const leaf = result.leaves[0];
    expect(leaf.note).toBe("added");
    expect(leaf.flaggedUncertain).toBe(true);
    expect(leaf.updatedAt).toBe(STAMPED);
  });

  // ML-8 — first matching id wins when ids are duplicated.
  // TODO: duplicate ids are out-of-contract (ids are meant to be unique within
  // a tree); the observable behavior is "first match" via findIndex. Locked so
  // a refactor can't silently change which duplicate is mutated.
  test("mutates only the first leaf when ids are duplicated", () => {
    const dupTree: PreferenceTree = {
      schemaVersion: 1,
      leaves: [
        makeLeaf({ id: ID_A, claimText: "first" }),
        makeLeaf({ id: ID_A, claimText: "second" }),
      ],
    };
    const result = mutateLeaf(dupTree, ID_A, (leaf) => ({
      ...leaf,
      claimText: "mutated",
    }));
    expect(result.leaves[0].claimText).toBe("mutated");
    // The second duplicate is untouched and reference-preserved.
    expect(result.leaves[1]).toBe(dupTree.leaves[1]);
    expect(result.leaves[1].claimText).toBe("second");
  });
});
