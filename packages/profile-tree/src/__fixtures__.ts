/**
 * Shared fixtures for the `@gjs/profile-tree` test suite (GJS-28).
 *
 * Conventions enforced here (see test-scenarios.md "Environment & ground
 * truth"):
 *  - Every timestamp ends in `Z` — Zod v4's `z.string().datetime()` rejects
 *    timezone offsets and tz-less strings, so a valid fixture MUST be `Z`.
 *  - Every leaf carries `weight: 1` explicitly. `weight` has `.default(1)`,
 *    so a leaf omitting it parses to an object WITH `weight: 1`; including it
 *    keeps raw-fixture/parsed round-trip deep-equality honest.
 *  - Ids are fixed valid UUIDs for fixture stability only. No SUT inspects an
 *    id value — it only matches/copies ids — so tests assert UUID shape and/or
 *    id-preservation, never a specific generated value.
 */
import type { Leaf, PreferenceTree } from "./leaf-schema";

// Reusable, distinct, valid UUIDs.
export const ID_A = "11111111-1111-4111-8111-111111111111";
export const ID_B = "22222222-2222-4222-8222-222222222222";
export const ID_C = "33333333-3333-4333-8333-333333333333";
export const ID_D = "44444444-4444-4444-8444-444444444444";
export const TURN = "99999999-9999-4999-8999-999999999999";

/** Canonical fixture timestamp — midday, `Z` suffix. */
export const TS = "2026-05-29T12:00:00Z";

/**
 * Build a valid `industry`/`include` leaf. Override any field; the default is
 * the simplest leaf that passes `LeafSchema` (depth-1, non-container,
 * include-polarity, `weight: 1`).
 */
export function makeLeaf(overrides: Partial<Leaf> = {}): Leaf {
  return {
    id: ID_A,
    branchSlug: "industry",
    branchPath: ["industry"],
    claimText: "fintech",
    polarity: "include",
    weight: 1,
    createdAt: TS,
    updatedAt: TS,
    ...overrides,
  };
}

/** F1 — Empty tree. */
export function emptyTree(): PreferenceTree {
  return { schemaVersion: 1, leaves: [] };
}

/** F2 — Single `industry`/`include` leaf. */
export function singleLeafTree(): PreferenceTree {
  return {
    schemaVersion: 1,
    leaves: [makeLeaf({ id: ID_A, claimText: "fintech" })],
  };
}

/** F3 — Three `industry` leaves, mixed polarity (include, exclude, include). */
export function mixedIndustryTree(): PreferenceTree {
  return {
    schemaVersion: 1,
    leaves: [
      makeLeaf({ id: ID_A, claimText: "fintech", polarity: "include" }),
      makeLeaf({ id: ID_B, claimText: "tobacco", polarity: "exclude" }),
      makeLeaf({ id: ID_C, claimText: "healthtech", polarity: "include" }),
    ],
  };
}

/** F3b — Three `industry` leaves, all exclude. */
export function allExcludeIndustryTree(): PreferenceTree {
  return {
    schemaVersion: 1,
    leaves: [
      makeLeaf({ id: ID_A, claimText: "fintech", polarity: "exclude" }),
      makeLeaf({ id: ID_B, claimText: "tobacco", polarity: "exclude" }),
      makeLeaf({ id: ID_C, claimText: "healthtech", polarity: "exclude" }),
    ],
  };
}

/** F4 — Multi-branch tree across role / skills/keep / industry / deal-breakers. */
export function multiBranchTree(): PreferenceTree {
  return {
    schemaVersion: 1,
    leaves: [
      makeLeaf({
        id: ID_A,
        branchSlug: "role",
        branchPath: ["role"],
        claimText: "Staff Engineer",
        polarity: "include",
      }),
      makeLeaf({
        id: ID_B,
        branchSlug: "skills/keep",
        branchPath: ["skills", "skills/keep"],
        claimText: "TypeScript",
        polarity: "include",
        skillIntent: "keep",
      }),
      makeLeaf({
        id: ID_C,
        branchSlug: "industry",
        branchPath: ["industry"],
        claimText: "fintech",
        polarity: "include",
      }),
      makeLeaf({
        id: ID_D,
        branchSlug: "deal-breakers",
        branchPath: ["deal-breakers"],
        claimText: "No on-call",
        polarity: "exclude",
      }),
    ],
  };
}

/** F4b — `industry`/`include` "fintech" with canonical tokens. */
export function industryWithCanonicalTree(): PreferenceTree {
  return {
    schemaVersion: 1,
    leaves: [
      makeLeaf({
        id: ID_A,
        claimText: "fintech",
        polarity: "include",
        canonical: ["financial services", "banking"],
      }),
    ],
  };
}

/** F5 — Deep branchPath `skills/keep` leaf. */
export function deepPathTree(): PreferenceTree {
  return {
    schemaVersion: 1,
    leaves: [
      makeLeaf({
        id: ID_A,
        branchSlug: "skills/keep",
        branchPath: ["skills", "skills/keep"],
        claimText: "Rust",
        polarity: "include",
        skillIntent: "keep",
      }),
    ],
  };
}

/** F6 — `skills/grow` leaf with `skillIntent: "grow"`. */
export function skillIntentGrowTree(): PreferenceTree {
  return {
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
    ],
  };
}

/**
 * F9 — Merge source: two `exclusions` leaves + one pre-existing
 * `deal-breakers` leaf.
 */
export function mergeSourceTree(): PreferenceTree {
  return {
    schemaVersion: 1,
    leaves: [
      makeLeaf({
        id: ID_A,
        branchSlug: "exclusions",
        branchPath: ["exclusions"],
        claimText: "Crypto-only shops",
        polarity: "exclude",
      }),
      makeLeaf({
        id: ID_B,
        branchSlug: "exclusions",
        branchPath: ["exclusions"],
        claimText: "Defense contractors",
        polarity: "exclude",
      }),
      makeLeaf({
        id: ID_C,
        branchSlug: "deal-breakers",
        branchPath: ["deal-breakers"],
        claimText: "No on-call",
        polarity: "exclude",
      }),
    ],
  };
}

/** F11 — Partial-sections tree: only skills/keep + industry/include. */
export function partialSectionsTree(): PreferenceTree {
  return {
    schemaVersion: 1,
    leaves: [
      makeLeaf({
        id: ID_A,
        branchSlug: "skills/keep",
        branchPath: ["skills", "skills/keep"],
        claimText: "TS",
        polarity: "include",
        skillIntent: "keep",
      }),
      makeLeaf({
        id: ID_B,
        branchSlug: "industry",
        branchPath: ["industry"],
        claimText: "fintech",
        polarity: "include",
      }),
    ],
  };
}

/**
 * F12 — Skills across all three sections, the avoid one with
 * `polarity: "exclude"` (proves skills sections ignore polarity).
 */
export function skillsAllPolaritiesTree(): PreferenceTree {
  return {
    schemaVersion: 1,
    leaves: [
      makeLeaf({
        id: ID_A,
        branchSlug: "skills/keep",
        branchPath: ["skills", "skills/keep"],
        claimText: "K",
        polarity: "include",
        skillIntent: "keep",
      }),
      makeLeaf({
        id: ID_B,
        branchSlug: "skills/grow",
        branchPath: ["skills", "skills/grow"],
        claimText: "G",
        polarity: "include",
        skillIntent: "grow",
      }),
      makeLeaf({
        id: ID_C,
        branchSlug: "skills/avoid",
        branchPath: ["skills", "skills/avoid"],
        claimText: "A",
        polarity: "exclude",
        skillIntent: "avoid",
      }),
    ],
  };
}
