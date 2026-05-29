import { ALL_CANONICAL_BRANCHES } from "./canonical-branches";
import type { Leaf, PreferenceTree } from "./leaf-schema";

/** Exact string emitted for an empty (or null) tree. No trailing newline. */
const EMPTY_TREE_SUMMARY = "No preferences set yet.";

/** Per-section fallback when a section has no matching leaves. Mirrors the
 * `joinOrDefault` fallback in `scoring-prompt.ts`. */
const NONE_SPECIFIED = "None specified";

/** L3 section labels in the order the user-prompt body expects them
 * (`scoring-prompt.ts` order). Lock-list of five. */
const L3_SECTION_ORDER = [
  "Core Skills",
  "Growth Skills",
  "Avoid Skills",
  "Deal-Breakers",
  "Preferred Industries",
] as const;

type L3Section = (typeof L3_SECTION_ORDER)[number];

/** slug → l3Section lookup, derived from CANONICAL_BRANCHES (constraint
 * C2 — no hardcoded slug literals duplicated here). */
const SLUG_TO_SECTION = new Map<string, L3Section>(
  ALL_CANONICAL_BRANCHES.flatMap((b) =>
    b.l3Section ? [[b.slug, b.l3Section] as [string, L3Section]] : [],
  ),
);

/** Render the preference tree as the five-section L3 prompt block. Pure.
 *
 * - Empty/`null` tree → exactly "No preferences set yet." (no newline).
 * - Otherwise five lines (no blank lines, no trailing newline), one per
 *   section in `L3_SECTION_ORDER`, each `"<Label>: <comma-joined
 *   claimText, or 'None specified'>"`.
 * - Industries split by polarity: only include-polarity industry leaves
 *   feed Preferred Industries; exclude-polarity industry leaves are
 *   dropped from the L3 prompt in this PR. Skills sections include the
 *   verbatim claim regardless of polarity (polarity is implicit in the
 *   section label). */
export function summariseTreeForL3(tree: PreferenceTree | null): string {
  if (!tree || tree.leaves.length === 0) return EMPTY_TREE_SUMMARY;

  const buckets = new Map<L3Section, string[]>(
    L3_SECTION_ORDER.map((label) => [label, []]),
  );

  for (const leaf of tree.leaves) {
    const section = SLUG_TO_SECTION.get(leaf.branchSlug);
    if (!section) continue;
    // Preferred Industries: include-polarity only (exclude dropped here).
    if (section === "Preferred Industries" && leaf.polarity !== "include") {
      continue;
    }
    buckets.get(section)?.push(claimOf(leaf));
  }

  return L3_SECTION_ORDER.map((label) => {
    const claims = buckets.get(label) ?? [];
    const value = claims.length > 0 ? claims.join(", ") : NONE_SPECIFIED;
    return `${label}: ${value}`;
  }).join("\n");
}

function claimOf(leaf: Leaf): string {
  return leaf.claimText;
}
