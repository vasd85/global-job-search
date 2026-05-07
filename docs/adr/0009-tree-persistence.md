# ADR-0009 — Persist the user preference tree as JSONB on `user_profile`

## Status

Proposed

## Context

The profile-driven architecture overhaul (umbrella PRD
`docs/product/2026-05-06-profile-driven-architecture.md`) replaces
the current flat-field profile (`user_profile.{coreSkills, growthSkills,
avoidSkills, dealBreakers, preferredIndustries}` plus the
`user_company_preference` table) with a tree-shaped profile: nine
fixed top-level branches and free-form leaves, each leaf preserving
the user's verbatim phrasing with an explicit direction polarity. The
PRD locks the tree shape and developer-editable hierarchy; the
persistence form is left to the architect (PRD §10, §11.1).

Three forms were considered:

- A single JSONB column on `user_profile` mirroring the existing
  `locationPreferences` ranked-tier pattern.
- A normalized `claim` table with one row per leaf and `parent_leaf_id`
  self-references for sub-branches.
- A log-plus-digest hybrid where every assertion is appended to a
  `claim_event` table and a materialised digest is recomputed on each
  event.

Constraints in play:

- Solo product, no production users; all existing rows wiped at ship
  per PRD §11.2 — migration cost is zero.
- The Profile-Map UI reads the whole tree on every render; a single
  row read is structurally simpler than a tree-walking JOIN.
- Leaves need stable identity so `job_match.claim_scores` (per-claim
  L3 scoring) can reference them; the relational handle does not have
  to be a Postgres FK.
- The codebase already commits to a JSONB-as-leaf-collection pattern
  via `user_profile.locationPreferences`. PRD §11.3 keeps that column
  untouched in MVP and notes alignment as fast-follow if divergent.
- Concurrency is irrelevant — solo user; last-write-wins is fine.
- Conflict surfacing and audit trails are explicit fast-follow scope
  (PRD §7.2), not MVP.

## Decision

We will persist the user preference tree as a single JSONB column
`preference_tree` on `user_profile`. The column holds an object
`{ schemaVersion: 1, leaves: Leaf[] }` where each `Leaf` carries its
verbatim `claim`, a `direction` polarity, the `branchSlug` and
`branchPath` it belongs to, optional canonical tokens for synonym
expansion, an optional `note` for qualifiers, an optional
`flaggedUncertain` marker, an optional `confidence` rating, an
optional `skillIntent` marker on Skills branch leaves only, and a
`leafId` UUID assigned at append time. Hierarchy is reconstructed
at render via `branchPath`; the JSONB stores a flat array of leaves
to keep mutation logic simple.

The branch hierarchy itself lives in a separate `preference_branch`
table (see ADR for branch-registry-storage); the JSONB stores leaves
that reference branch slugs and is validated server-side at write
time. No Postgres-level FK between leaves and the registry — the JSONB
boundary makes that impractical and a server-side validator covers
the case.

The existing `user_profile.locationPreferences` column stays as-is for
MVP. The Profile Map adapter projects its tier shape into the leaf
shape read-only at render time so the UI is consistent across
branches; a future fast-follow sub-feature aligns the tier shape with
the leaf shape if divergence persists.

## Consequences

- **Positive — minimum new surface area.** One column added to one
  existing table; mirrors the existing `locationPreferences` precedent
  and the codebase's "user_profile is the user" mental model.
- **Positive — single-row reads.** Profile rendering, conversation-turn
  application, and L2 derivation each load one row; no tree-walking
  JOIN.
- **Positive — flat array of leaves with `branchPath` is easy to
  mutate.** Insertions, edits, and deletions are array operations on
  a single field; no nested-object recursion.
- **Positive — `leafId` UUIDs give us a soft relational handle** that
  `job_match.claim_scores` can reference for per-claim L3 scoring
  without promoting leaves to rows.
- **Negative — no FK enforcement on `branchSlug` or `leafId`.** A
  leaf that references a deleted branch or a `claim_scores` entry that
  references a deleted leaf is detectable only by server-side
  validation. Mitigated: branches use soft-delete (`active = false`),
  validators flag inconsistencies, solo product accepts the trade.
- **Negative — every leaf edit rewrites the whole tree.** Acceptable
  for the solo user (sub-second writes, no contention); would need
  reconsideration if we ever multi-user.
- **Negative — ad-hoc cross-user queries are awkward** (e.g., "all
  users excluding fintech"). No such use case in MVP scope; the
  manifesto forbids public-profile / aggregate analytics.
- **Neutral — diverges from `claim_event` log-plus-digest.** Audit
  history is recoverable from `conversation_message` (verbatim turn
  log retained; each Leaf carries a `source.turnId`). Conflict
  surfacing and audit-driven fast-follow features can layer on
  without changing the persistence form.
- **Follow-on work.** A tree-aware deriver
  (`apps/web/src/lib/profile-tree/derive-l2.ts`) replaces the current
  filter-pipeline reads of flat columns. The L3 worker reads
  tree-derived facts via the same deriver. Old fields removed in the
  same migration as the column add (per PRD wipe-at-ship invariant).
