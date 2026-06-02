import { describe, expect, test } from "vitest";
import { moveLeaves } from "./move-leaves";
import { LeafSchema, type PreferenceTree } from "./leaf-schema";
import {
  emptyTree,
  ID_A,
  ID_B,
  makeLeaf,
  mergeSourceTree,
  mixedIndustryTree,
  multiBranchTree,
} from "./__fixtures__";

/**
 * `moveLeaves` returns a NEW tree, rewriting `branchSlug` + `branchPath` for
 * leaves matching the predicate (optionally narrowed by `fromPathContains`),
 * applies an optional per-leaf `mutateLeaf` hook AFTER the rewrite, and throws
 * when the target slug is unknown or a container. Non-matching leaves are
 * untouched (reference-preserved). `toPath` is defensively copied.
 *
 * NOTE on the golden target slug: the design's fixture #8 names a hypothetical
 * "industry-renamed" slug, but `moveLeaves` validates `toSlug` against
 * ALL_CANONICAL_BRANCHES and throws on unknown slugs (MV-6). The golden path
 * therefore targets a REAL canonical non-container leaf slug (`other`); the
 * hypothetical-slug case is exercised as the throw scenario. We do NOT
 * monkey-patch the taxonomy to invent a slug.
 */

describe("moveLeaves — golden paths", () => {
  // MV-1 — locked fixture #8: move all industry leaves to `other`.
  test("moves all matching leaves and preserves every other field", () => {
    const tree = mixedIndustryTree();
    const result = moveLeaves(
      tree,
      { fromSlugs: ["industry"] },
      { toSlug: "other", toPath: ["other"] },
    );

    expect(result.schemaVersion).toBe(1);
    expect(result.leaves.length).toBe(3);
    expect(result).toEqual({
      schemaVersion: 1,
      leaves: tree.leaves.map((leaf) => ({
        ...leaf,
        branchSlug: "other",
        branchPath: ["other"],
      })),
    });

    // Ids are copied, never regenerated.
    expect(result.leaves[0].id).toBe(tree.leaves[0].id);
    expect(result.leaves[1].id).toBe(tree.leaves[1].id);
    expect(result.leaves[2].id).toBe(tree.leaves[2].id);
  });

  // MV-2 — locked fixture #9: merge `exclusions` into `deal-breakers` with a
  // per-leaf mutator that runs only on the moved leaves.
  test("merges with a per-leaf mutator applied only to moved leaves", () => {
    const tree = mergeSourceTree();
    const result = moveLeaves(
      tree,
      { fromSlugs: ["exclusions"] },
      {
        toSlug: "deal-breakers",
        toPath: ["deal-breakers"],
        mutateLeaf: (leaf) => ({ ...leaf, note: "scope:company" }),
      },
    );

    expect(result.leaves.length).toBe(3);

    // The two ex-exclusions leaves are rewritten AND carry the new note.
    for (const idx of [0, 1]) {
      expect(result.leaves[idx]).toEqual({
        ...tree.leaves[idx],
        branchSlug: "deal-breakers",
        branchPath: ["deal-breakers"],
        note: "scope:company",
      });
      // Merge result is still schema-valid (note is a real optional field,
      // deal-breakers is a depth-1 non-container leaf).
      expect(LeafSchema.safeParse(result.leaves[idx]).success).toBe(true);
    }

    // The pre-existing deal-breakers leaf is untouched (mutator ran only on the
    // moved leaves) and reference-preserved.
    expect(result.leaves[2]).toBe(tree.leaves[2]);
  });

  // MV-3 — fromPathContains narrows the match within a multi-slug predicate.
  test("fromPathContains narrows which matching-slug leaves are moved", () => {
    const tree: PreferenceTree = {
      schemaVersion: 1,
      leaves: [
        makeLeaf({
          id: ID_A,
          branchSlug: "skills/grow",
          branchPath: ["skills", "skills/grow"],
          claimText: "Kubernetes",
          polarity: "include",
          skillIntent: "grow",
        }),
        makeLeaf({
          id: ID_B,
          branchSlug: "skills/keep",
          branchPath: ["skills", "skills/keep"],
          claimText: "TypeScript",
          polarity: "include",
          skillIntent: "keep",
        }),
      ],
    };
    const result = moveLeaves(
      tree,
      {
        fromSlugs: ["skills/grow", "skills/keep"],
        fromPathContains: "skills/grow",
      },
      { toSlug: "other", toPath: ["other"] },
    );

    // Only the skills/grow leaf moved (its branchPath includes "skills/grow").
    expect(result.leaves[0]).toEqual({
      ...tree.leaves[0],
      branchSlug: "other",
      branchPath: ["other"],
    });
    // The skills/keep leaf is untouched even though its slug is in fromSlugs,
    // because its branchPath does not include "skills/grow".
    expect(result.leaves[1]).toBe(tree.leaves[1]);
  });

  // MV-9 — multiple distinct fromSlugs are all moved.
  test("moves leaves matching any of several fromSlugs", () => {
    const tree: PreferenceTree = {
      schemaVersion: 1,
      leaves: [
        makeLeaf({
          id: ID_A,
          branchSlug: "exclusions",
          branchPath: ["exclusions"],
          claimText: "Crypto",
          polarity: "exclude",
        }),
        makeLeaf({
          id: ID_B,
          branchSlug: "deal-breakers",
          branchPath: ["deal-breakers"],
          claimText: "No on-call",
          polarity: "exclude",
        }),
      ],
    };
    const result = moveLeaves(
      tree,
      { fromSlugs: ["exclusions", "deal-breakers"] },
      { toSlug: "other", toPath: ["other"] },
    );

    for (const leaf of result.leaves) {
      expect(leaf.branchSlug).toBe("other");
      expect(leaf.branchPath).toEqual(["other"]);
    }
  });
});

describe("moveLeaves — no-op / empty cases", () => {
  // MV-4 — no-match returns an equivalent but fresh tree; leaves are
  // reference-preserved while the tree and its leaves array are new.
  test("a no-match predicate returns a new but equivalent tree", () => {
    const tree = multiBranchTree();
    const result = moveLeaves(
      tree,
      { fromSlugs: ["compensation"] },
      { toSlug: "other", toPath: ["other"] },
    );

    expect(result).toEqual(tree);
    expect(result).not.toBe(tree);
    expect(result.leaves).not.toBe(tree.leaves);
    tree.leaves.forEach((leaf, i) => {
      expect(result.leaves[i]).toBe(leaf);
    });
  });

  // MV-5 — empty tree move is a no-op equivalent.
  test("an empty tree returns an equivalent new empty tree", () => {
    const tree = emptyTree();
    const result = moveLeaves(
      tree,
      { fromSlugs: ["industry"] },
      { toSlug: "other", toPath: ["other"] },
    );
    expect(result).toEqual({ schemaVersion: 1, leaves: [] });
    expect(result).not.toBe(tree);
  });

  // MV-8 — fromPathContains that matches nothing moves nothing.
  test("a fromPathContains that excludes all candidates moves nothing", () => {
    const tree = mixedIndustryTree();
    const result = moveLeaves(
      tree,
      { fromSlugs: ["industry"], fromPathContains: "skills" },
      { toSlug: "other", toPath: ["other"] },
    );
    expect(result).toEqual(tree);
    tree.leaves.forEach((leaf, i) => {
      expect(result.leaves[i]).toBe(leaf);
    });
  });
});

describe("moveLeaves — target validation", () => {
  // MV-6 — unknown target slug throws (this is why MV-1 cannot use a
  // hypothetical slug).
  test("throws on an unknown target slug", () => {
    const tree = mixedIndustryTree();
    expect(() =>
      moveLeaves(
        tree,
        { fromSlugs: ["industry"] },
        { toSlug: "industry-renamed", toPath: ["industry-renamed"] },
      ),
    ).toThrow(/Unknown target slug/);
  });

  // MV-7 — container target slug throws (mirrors superRefine rule 4 at the
  // move layer).
  test("throws when the target slug is a container", () => {
    const tree = mixedIndustryTree();
    expect(() =>
      moveLeaves(
        tree,
        { fromSlugs: ["industry"] },
        { toSlug: "skills", toPath: ["skills"] },
      ),
    ).toThrow(/is a container/);
  });

  // MV-12 — caller-responsibility contract (finding 2): `moveLeaves` validates
  // only `toSlug` (known, non-container), NOT `toPath`. A `toPath` that does
  // not terminate at `toSlug` therefore produces a leaf that LeafSchema
  // REJECTS, and `moveLeaves` does NOT throw. This is intentional — moveLeaves
  // is a pure/dumb transform (design §6.2); the persistence boundary
  // (`migrateLeaves`' post-transform re-parse) is what prevents such a leaf
  // from ever being written.
  test("does not validate toPath: returns a schema-invalid leaf without throwing", () => {
    const tree = mixedIndustryTree();
    let result: PreferenceTree;
    expect(() => {
      result = moveLeaves(
        tree,
        { fromSlugs: ["industry"] },
        // `industry` is a real non-container slug so moveLeaves accepts it,
        // but ["role"] does not end at "industry" -> LeafSchema rule 2 fails.
        { toSlug: "industry", toPath: ["role"] },
      );
    }).not.toThrow();

    // The produced (moved) leaf carries the mismatched path and is rejected by
    // LeafSchema — proving moveLeaves emitted an unvalidated, invalid leaf.
    result!.leaves.forEach((leaf) => {
      expect(leaf.branchSlug).toBe("industry");
      expect(leaf.branchPath).toEqual(["role"]);
      expect(LeafSchema.safeParse(leaf).success).toBe(false);
    });
  });
});

describe("moveLeaves — defensive copying", () => {
  // MV-10 — even with a mutating per-leaf hook, the ORIGINAL leaves are
  // unchanged (the SUT spreads {...leaf} before the hook runs).
  test("a mutating per-leaf hook does not leak into the input tree", () => {
    const tree = mergeSourceTree();
    const snapshot = structuredClone(tree);
    moveLeaves(
      tree,
      { fromSlugs: ["exclusions"] },
      {
        toSlug: "deal-breakers",
        toPath: ["deal-breakers"],
        mutateLeaf: (leaf) => ({ ...leaf, note: "scope:company" }),
      },
    );
    expect(tree).toEqual(snapshot);
  });

  // MV-11 — toPath is copied, not aliased: mutating the caller's array after
  // the call must not change any moved leaf's branchPath.
  test("copies toPath rather than aliasing the caller's array", () => {
    const tree = mixedIndustryTree();
    const toPath = ["other"];
    const result = moveLeaves(
      tree,
      { fromSlugs: ["industry"] },
      { toSlug: "other", toPath },
    );

    toPath.push("mutated-after-call");

    for (const leaf of result.leaves) {
      expect(leaf.branchPath).toEqual(["other"]);
    }
  });
});
