import { ALL_CANONICAL_BRANCHES } from "./canonical-branches";
import type { PreferenceTree } from "./leaf-schema";

export interface L2Inputs {
  /** Industry canonical tokens (positive polarity only). Excludes
   * are NOT handed to L2 (per design §12 / D9 invariant — positive
   * overlap only at L2). Fed into the SQL industry overlap
   * condition in filter-pipeline.ts. */
  industries: string[];
}

/** Derive the narrow L2 input surface from the preference tree. For MVP
 * only `industries` changes source (the other L2 inputs continue to read
 * the retained `user_profile` columns directly). Iterates
 * CANONICAL_BRANCHES (constraint C2) — no hardcoded slug literals.
 *
 * Empty/`null` tree → `{ industries: [] }`. */
export function deriveL2Inputs(tree: PreferenceTree | null): L2Inputs {
  if (!tree) return { industries: [] };
  const industries: string[] = [];
  for (const leaf of tree.leaves) {
    const def = ALL_CANONICAL_BRANCHES.find((b) => b.slug === leaf.branchSlug);
    if (def?.l2Derivation !== "industry-tokens") continue;
    if (leaf.polarity !== "include") continue; // positive overlap only
    industries.push(leaf.claimText);
    for (const tok of leaf.canonical ?? []) industries.push(tok);
  }
  return { industries };
}
