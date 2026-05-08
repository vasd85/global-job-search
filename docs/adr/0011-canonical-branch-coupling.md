# ADR-0011 — Centralise canonical-branch semantic coupling in a TS constant

## Status

Proposed

## Context

The umbrella PRD (`docs/product/2026-05-06-profile-driven-architecture.md`)
fixes nine canonical top-level branches: Role, Skills, Compensation,
Location, Industry, Company Attributes, Exclusions, Deal-breakers,
Other. The branch registry storage (ADR-0004) places hierarchy and
display metadata in the `preference_branch` DB table. The user has
explicitly stated that the **composition** of the canonical set is
expected to evolve as the product's understanding of preferences
matures: future operations include adding new canonical branches,
moving leaves between branches, deleting canonical branches, and
merging two canonical branches into one.

Without an architectural seam for these operations, the codebase
develops hardcoded coupling to specific canonical slugs in at least
six places:

- `deriveL2Inputs(tree)` (design § 12) — reads leaves under slugs
  `role` (target titles), `industry` (canonical tokens), implicit
  scope hooks per branch.
- Conversation runtime prompt-builder (design § 8) — injects the
  canonical taxonomy with semantic descriptions into the system
  prompt.
- L3 prompt-builder and worker (design § 6) — distinguishes "soft"
  branches (industry, company-attributes, deal-breakers) from "hard"
  branches (role, skills, compensation, location).
- `skillIntent` validator (design § 8 step 4 + § 13) — attached
  specifically to the `skills` slug.
- Exclusions vs Deal-breakers semantic split (PRD § 6.3) — applies
  one at company level, the other at job level.
- Synonym-dimension binding (design § 17) — `synonym_group.dimension
  = 'industry'` is name-coupled to the Industry canonical branch.

If each composition-change operation has to chase down all six
locations and any tests that assert against literal slug strings,
the cost of a routine reshape is multi-day. For the solo-experimental
product (memory: "no prod users; schema/API can be broken freely"),
the cost is not catastrophic — but it scales linearly with the number
of reshapes the user expects to perform over the product's lifetime,
which is non-trivial.

The PRD's locked-list discipline (§ 11.2) is governance, not
infrastructure. Governance still requires that composition changes
be reflected in a PRD update; infrastructure has to absorb the
change without scattered refactors.

Three forms were considered:

- **A. Cosmetic-only editability.** Lock the slugs themselves;
  permit only `display_name` / `sort_order` / `description` /
  `active` edits at runtime. Rejected: forecloses real reshapes
  the user expects (move, merge, delete).
- **B. TS constant as single source of truth for canonical
  semantics**, with declarative behaviour hooks read by all
  hard-coupled call sites. Composition changes = edit the constant
  + run a JSONB rewrite migration + update PRD. **Selected.**
- **C. Full runtime configuration in DB.** Each `preference_branch`
  row carries a `config_json` with full behaviour (matcher tier,
  derivation function, applicability scope, synonym dimension,
  custom L3 hooks). Branches and behaviours both editable at
  runtime without code change. Rejected: introduces plugin-
  architecture complexity, versioning of config schema, and
  runtime-vs-compile-time error surfacing — disproportionate cost
  for a solo product whose composition changes are infrequent
  and always paired with a PRD update anyway.

## Decision

We will introduce a single TypeScript module
`apps/web/src/lib/profile-tree/canonical-branches.ts` exporting:

```ts
export type CanonicalBranchKind =
  | 'role' | 'skills' | 'compensation' | 'location'
  | 'industry' | 'attribute' | 'exclusion' | 'dealbreaker' | 'other';

export interface CanonicalBranchDef {
  slug: string;
  kind: CanonicalBranchKind;
  displayName: string;
  description: string;
  l2Derivation?: 'titles' | 'seniority' | 'industry-tokens'
               | 'remote-flag' | 'location-tier';
  synonymDimension?: string;
  acceptsSkillIntent?: boolean;
  matcherScope?: 'company' | 'job' | 'both';
  l3Soft?: boolean;
}

export const CANONICAL_BRANCHES: CanonicalBranchDef[] = [
  /* nine entries seeded from PRD § 6.3 */
];
```

`CANONICAL_BRANCHES` is the **single source of truth for canonical-
branch semantics**. All hard-coupled call sites — `deriveL2Inputs`,
conversation runtime prompt-builder, L3 prompt-builder, `skillIntent`
validator, exclusions/deal-breakers split, synonym-dimension binding
— iterate over `CANONICAL_BRANCHES` and read the relevant hooks
rather than hardcoding slug literals.

The DB seed migration in `wipe-and-foundation` (D8 / ADR-0010) reads
`CANONICAL_BRANCHES` to populate `preference_branch` rows: canonical
semantics are not duplicated between code and DB. The
`preference_branch` table (D2 / ADR-0004) continues to hold the
editable sub-branch hierarchy under canonical roots, runtime display
adjustments (`display_name`, `sort_order`, `active`), and per-branch
`config_json` for sub-branch-specific tunables.

We will also introduce a JSONB rewrite utility
`apps/web/src/lib/profile-tree/migrate-leaves.ts`:

```ts
export async function moveLeaves(
  db: Database,
  opts: {
    fromSlugs: string[];
    fromPathContains?: string;
    toSlug: string;
    toPath: string[];
    mutateLeaf?: (leaf: Leaf) => Leaf;
  },
): Promise<void>;
```

Implementation: one transaction with `jsonb_agg` + `jsonb_set` over
`user_profile.preferenceTree.leaves[]`, replacing `branchSlug` and
the matching entry in `branchPath[]`. Optionally applies
`mutateLeaf` for merges that introduce new leaf fields (e.g.,
per-leaf `scope` when merging Exclusions and Deal-breakers).
Composition-change Drizzle migrations call `moveLeaves` directly.

Both files land in the `wipe-and-foundation` sub-feature
(ADR-0010 § Decision is updated to include them) so every
subsequent sub-feature inherits the centralisation.

## Consequences

- **Positive — composition changes are localised.** Adding,
  removing, moving, or merging a canonical branch touches the TS
  constant, a single Drizzle migration, and the PRD. Six scattered
  call sites no longer have to be hunted down.
- **Positive — single source of truth.** `CANONICAL_BRANCHES` is
  the only place that records "what does the `industry` branch
  actually feed into the matcher". Drift between code, prompts,
  and DB seed becomes impossible.
- **Positive — declarative behaviour hooks document the contract.**
  Reading the constant tells a future contributor everything about
  a branch's role in the system; no reverse-engineering across six
  files.
- **Positive — testable.** Each hook (`l2Derivation`,
  `synonymDimension`, etc.) has a unit-testable shape. The
  composition-change playbook can be exercised with fixtures.
- **Negative — modest upfront cost in `wipe-and-foundation`.**
  Roughly one extra day in that sub-feature: write the constant,
  write the utility, refactor the six hard-coupled places to read
  from the constant, write the seed migration to consume the
  constant. The cost is paid once.
- **Negative — adding a new behaviour hook still requires code
  change.** If the system grows a new dispatcher (e.g., "L4
  re-ranker" with its own per-branch toggles), the
  `CanonicalBranchDef` interface gains a field and existing entries
  may need updates. Acceptable: this is the kind of change that
  warrants code review anyway.
- **Negative — runtime-editable canonical composition is not
  available.** A developer cannot reshape canonical branches
  through a DB UI; the change requires a code edit + a migration.
  The user has explicitly stated this is acceptable: composition
  changes are infrequent and always paired with a PRD update.
- **Composition-change playbook (canonical operations).** Each is
  one Drizzle migration plus a TS edit. `moveLeaves` does the
  heavy lifting on JSONB.

  1. **Add canonical branch.** Edit `CANONICAL_BRANCHES` (append
     entry); `INSERT` row into `preference_branch`; update PRD
     § 6.3 + § 11.2. No leaf migration. ~30 min – 1 h.
  2. **Move leaves between branches.** `moveLeaves` migration with
     `fromSlugs` + optional `fromPathContains` + `toSlug` +
     `toPath`. Code unchanged unless behaviour also moves. ~30 min
     – 1 h.
  3. **Delete canonical branch.** First migrate orphans via
     `moveLeaves` (or DELETE-where-slug for solo product); set
     `active=false` on the `preference_branch` row; remove the TS
     constant entry; update PRD. Code review for any references
     in tests. ~1–2 h.
  4. **Merge two canonical branches.** Decide unified semantics. If
     `matcherScope` differs across the two branches, extend `Leaf`
     schema with a `scope` field and apply `mutateLeaf` during the
     `moveLeaves` migration. Update the matcher to read
     `leaf.scope` instead of inferring from `branchSlug`. Update
     PRD § 6.3 + § 11.2. ~3–5 h depending on whether the merge
     adds new leaf fields.

- **Follow-on work.** The first sub-feature plan (`/feature
  wipe-and-foundation` later) must (1) write
  `canonical-branches.ts` with all nine entries fully populated,
  (2) write `migrate-leaves.ts` with full unit-test coverage on
  representative tree fixtures, (3) refactor the six call sites
  listed in § Context to read from `CANONICAL_BRANCHES`, (4) make
  the seed migration consume the constant rather than embed slug
  literals. The acceptance gate is a `grep` returning zero matches
  for canonical slug literals outside `canonical-branches.ts` and
  test fixtures.
