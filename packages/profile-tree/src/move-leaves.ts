import { ALL_CANONICAL_BRANCHES } from "./canonical-branches";
import type { Leaf, PreferenceTree } from "./leaf-schema";

export interface MovePredicate {
  /** Match leaves whose branchSlug is in this set. */
  fromSlugs: string[];
  /** Optional: only move leaves whose branchPath contains this
   * substring. Used to disambiguate when fromSlugs alone is too
   * broad (e.g., moving only a subset of skills/grow leaves). */
  fromPathContains?: string;
}

export interface MoveTarget {
  toSlug: string;
  toPath: string[];
  /** Optional per-leaf mutator applied after the slug + path
   * rewrite. For merges that introduce new leaf fields (e.g., a
   * `scope` field when merging Exclusions and Deal-breakers). */
  mutateLeaf?: (leaf: Leaf) => Leaf;
}

/** Move all leaves matching `predicate` to a new branch. Returns a
 * new tree; throws if target slug is unknown or container.
 *
 * Pure transformation — no DB awareness. The DB-level batched wrapper
 * that loads/saves trees and applies FOR UPDATE batching lives in
 * `migrate-leaves.ts`. */
export function moveLeaves(
  tree: PreferenceTree,
  predicate: MovePredicate,
  target: MoveTarget,
): PreferenceTree {
  const targetDef = ALL_CANONICAL_BRANCHES.find((b) => b.slug === target.toSlug);
  if (!targetDef) {
    throw new Error(`Unknown target slug: ${target.toSlug}`);
  }
  if (targetDef.isContainer) {
    throw new Error(
      `Target slug ${target.toSlug} is a container; leaves must use a sub-branch slug`,
    );
  }

  const fromSlugs = new Set(predicate.fromSlugs);
  const leaves = tree.leaves.map((leaf) => {
    if (!fromSlugs.has(leaf.branchSlug)) return leaf;
    if (
      predicate.fromPathContains !== undefined &&
      !leaf.branchPath.includes(predicate.fromPathContains)
    ) {
      return leaf;
    }
    const moved: Leaf = {
      ...leaf,
      branchSlug: target.toSlug,
      branchPath: [...target.toPath],
    };
    return target.mutateLeaf ? target.mutateLeaf(moved) : moved;
  });

  return {
    schemaVersion: tree.schemaVersion,
    leaves,
  };
}
