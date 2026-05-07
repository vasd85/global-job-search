# ADR-0004 — Store the developer-editable branch hierarchy in a `preference_branch` table

## Status

Proposed

## Context

The umbrella overhaul PRD (`docs/product/2026-05-06-profile-driven-architecture.md`)
locks two related decisions in §11.2: the canonical top-level branch
set is the nine slugs in §6.3 (`role`, `skills`, `compensation`,
`location`, `industry`, `company-attributes`, `exclusions`,
`deal-breakers`, `other`); the **hierarchy** (sub-branches and deeper
nesting) and the **UI max render depth** are developer-editable at
runtime — not hardcoded.

PRD §11.4 hints at a `preference_branch` table mirroring the existing
`role_family` / `synonym_group` pattern. PRD §10 leaves the storage
form open: DB table, `app_config` JSONB blob, or a TS constant. The
TS constant is rejected by the lock ("developer-editable without
redeploy"), narrowing to DB table vs `app_config` blob.

The branch registry differs from per-user state: it's a small global
taxonomy edited by engineering occasionally, read on every Profile
Map render and every conversation turn (to validate that a leaf's
`branchSlug` refers to an active branch). It is not user data.

The codebase has two precedents for developer-editable taxonomy:

- `role_family` — DB table, one row per family, with array columns
  for match patterns, consumed by the role classifier.
- `synonym_group` — DB table, one row per canonical concept, with
  array columns for synonyms, consumed by `expandTerms`.

The codebase has one precedent for a runtime-tunable scalar config
blob:

- `app_config` — generic key/value (jsonb) table for tunables like
  `scoring.l3_candidate_cap` and `ui.profile_map_max_depth`.

## Decision

We will introduce a dedicated `preference_branch` table in the
database, modelled on the `role_family` precedent. Each row is one
branch (top-level or sub-branch). The schema sketch:

```ts
preferenceBranch = pgTable("preference_branch", {
  slug: text("slug").primaryKey(),
  parentSlug: text("parent_slug").references(() => preferenceBranch.slug),
  displayName: text("display_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  config: jsonb("config"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

Top-level branches have `parentSlug = NULL`. Sub-branches reference
their parent by slug. The seed migration installs the nine top-level
slugs from PRD §6.3 plus the first cut of sub-branches (Skills →
`keep` / `grow` / `avoid`; Company Attributes →
`size`/`stage`/`funding`/`hq`/`product-or-services`/`brand`/`culture`).
Branches are never hard-deleted in production — `active = false`
handles deprecation, leaving leaves that reference the slug
recoverable.

UI max render depth lives separately as
`app_config.ui.profile_map_max_depth` (default 3). It is a single
scalar, not part of the hierarchy, and `app_config` is the
established home for such tunables.

## Consequences

- **Positive — mirrors `role_family`.** Engineering already knows the
  pattern; new mental load is near zero.
- **Positive — per-row editing is operationally simpler** than
  rewriting a tree blob in `app_config`. Adding a branch is one
  INSERT; renaming is one UPDATE; deactivating is one UPDATE.
- **Positive — `parentSlug` self-FK enforces referential integrity**
  on the branch tree itself; the registry cannot reference a
  non-existent parent.
- **Positive — `config` JSONB column absorbs future per-branch
  tunables** (per-branch synonym dimension, per-branch L3 weight,
  per-branch render hint) without further schema migrations.
- **Positive — branch reads are cacheable.** A small in-process cache
  (refresh on TTL or invalidate on UPDATE) keeps the per-turn
  validation cost negligible.
- **Negative — leaves' `branchSlug` cannot be FK-enforced** because
  the leaf lives in JSONB on `user_profile.preferenceTree`. A
  server-side validator runs at write time and a periodic audit job
  (sub-feature concern) flags inconsistencies. Acceptable for solo
  product.
- **Negative — slight write-overhead** vs a single-key `app_config`
  blob: one round-trip per branch edit instead of one for the whole
  tree. Negligible at the operational frequency we expect.
- **Neutral — diverges from `app_config` for hierarchy data.** UI
  max-depth stays in `app_config` because it is a scalar and shares
  no shape with the hierarchy. The split keeps `app_config` lean and
  the registry typed.
- **Follow-on work.** Sub-feature plans must (1) write the seed
  migration (idempotent, re-runnable), (2) wire branch reads through
  a small cache, and (3) add the validator that rejects new leaves
  whose `branchSlug` does not resolve to an active row.
