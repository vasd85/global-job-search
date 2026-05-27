# Wipe legacy preference substrate & scaffold preference-tree foundation

Status: **Draft v1** | Date: 2026-05-27 | Owner: vasd85

> **Reader:** this PRD is written for a downstream agent (planner,
> architect, or implementer) — not a human. Sections are fixed in name
> and order; index by section number when needed. Decisions are
> declarative. "N/A" is a valid value for a section; empty is not.

> **Position in umbrella.** This is the first sub-feature seed of the
> umbrella architectural overhaul `2026-05-06-profile-driven-
> architecture`. Architectural choice is **already locked** by the
> umbrella PRD §11.2, design §4 / §11 (D8) / §16.5 (D15), ADR-0010,
> ADR-0011. This PRD locks **operational scope** for the first
> cutover PR — not architecture.

---

## 0. Inputs & pointers

- **Repo:** `/Users/vasd85/repo/personal-projects/global-job-search`
- **Research note:** `.claude/scratchpads/2026-05-26-wipe-and-foundation/research.md`
- **Umbrella PRD:** `docs/product/2026-05-06-profile-driven-architecture.md`
- **Umbrella design:** `docs/designs/2026-05-06-profile-driven-architecture.md`
- **Umbrella plan (sub-feature roadmap):** `docs/plans/2026-05-06-profile-driven-architecture.md`
- **ADRs:** `docs/adrs/0009-jsonb-preference-tree.md`, `docs/adrs/0010-wipe-and-foundation-cutover.md`, `docs/adrs/0011-canonical-branches-ts-source-of-truth.md`
- **Schema:** `packages/db/src/schema.ts` (re-exported via `apps/web/src/lib/db/schema.ts`). Tables in play: `user_profile`, `user_company_preference`, `job_match`, `app_config`, `preference_branch` (new), `conversation_state`, `conversation_message`.
- **Code paths the downstream agent must touch:**
  - `packages/db/src/schema.ts` — drop 5 cols on `user_profile`, drop `user_company_preference`, drop `conversation_state` + `conversation_message`, add `preferenceTree` JSONB, add `claimScores` JSONB on `job_match`, add `preference_branch` table.
  - `apps/web/drizzle/0010_*.sql` — generated migration.
  - `apps/web/src/lib/profile-tree/` (new) — `canonical-branches.ts`, leaf schema, `mutateLeaf`, `moveLeaves`, `deriveL2Inputs`, `summariseTreeForL3`, `migrate-leaves.ts`.
  - `apps/web/src/lib/search/filter-pipeline.ts` — rewire to tree-derived inputs.
  - `apps/web/src/app/api/chatbot/{message,state,save}/route.ts` — convert to 501 stubs (delete `save` or stub; see §11.2).
  - `apps/web/src/lib/chatbot/*` — delete entire module.
  - `apps/web/src/lib/llm/{preference-llm.ts,prompts.ts}` — delete (chatbot-only consumers).
  - `apps/web/src/components/chatbot/*` and `apps/web/src/app/onboarding/page.tsx` — delete.
  - `apps/worker/src/handlers/llm-scoring.ts` and `apps/worker/src/lib/scoring-prompt.ts` — swap flat-profile fields for `treeSummary: string`.
  - `apps/worker/src/handlers/internet-expansion.ts` — convert to warn-logged no-op.
  - `apps/worker/src/lib/seed-config.ts` — extend for new `app_config` keys and the `preference_branch` seed from `CANONICAL_BRANCHES`.
  - `packages/ats-core/src/geo/resolve-user-location.ts` — stale comment fix.
- **DB access:** `mcp__postgres__execute_sql` (read-only via dbhub).

---

## 1. Problem

### 1.1 User problem
The solo product owner cannot start any of the next three sub-features
(`conversation-runtime`, `profile-map-ui`, `l3-widening`) because the
substrate is half-old (flat-column profile + chatbot module + a legacy
preferences table) and half-imagined (no `preferenceTree`, no
`preference_branch` registry, no `CANONICAL_BRANCHES` constant). Every
downstream PR would otherwise need to coexist with — and unwind — the
legacy artefacts as it goes, multiplying the surface area of every
follow-on.

### 1.2 Business problem
The umbrella overhaul (`2026-05-06-profile-driven-architecture`) is
too large to land in one PR cycle. Without a clean substrate cut,
each downstream sub-feature accumulates "migration shrapnel" that
compounds across the chunk list and pushes "matching users to their
dream jobs via leaf-level claims" further out.

### 1.3 Why now
- Umbrella PRD + design + ADR-0010 + ADR-0011 are signed off; the
  architectural choices this sub-feature implements are locked.
- Project memory invariant `project_no_prod_users`: no production
  cohort exists, so a cutover with no migration-of-data layer is
  cheap.
- Downstream sub-features are blocked on this substrate.

---

## 2. User & context

### 2.1 Target user
Solo product owner (vasd85) during the cutover and, immediately
after, the three downstream sub-feature authors (the same person,
wearing different agent-routed hats) who will read the substrate.
There are no end users in this picture.

### 2.2 Jobs-to-be-done
When I start any of the next three sub-features, I want to read from
a tree substrate and a canonical branch registry that already exist
in clean form, so I can avoid re-deriving them from the flat-column
legacy on every PR.

### 2.3 Scenarios

- **Scenario A — Cutover PR lands.** Operator runs `pg_dump`, merges
  the cutover PR, applies migration 0010. Worker reboots; seeder
  upserts the new `app_config` keys and the `preference_branch` rows
  derived from `CANONICAL_BRANCHES`. HEAD is green (typecheck + lint
  + test). Grep for legacy names returns zero matches outside the
  migration and tests. `/api/chatbot/{message,state,save}` returns
  501. `/onboarding` is intentionally broken. Search returns an
  "empty profile" result set for any user (no leaves yet, so no
  filters fire).
- **Scenario B — `conversation-runtime` opens.** Author imports
  `CANONICAL_BRANCHES`, writes a leaf to `user_profile.preferenceTree
  .leaves[]`, runs filter-pipeline locally; matches appear without
  touching any legacy column or table.
- **Scenario C — Composition change later.** Product decides to split
  `skills/grow` into `skills/grow-hard` + `skills/grow-soft`.
  `moveLeaves` + `mutateLeaf` are already in place and unit-tested;
  the migration is a TS one-liner against `CANONICAL_BRANCHES` plus a
  `preference_branch` upsert.

---

## 3. Goals & non-goals

### 3.1 Goals

- G1 — One transactional Drizzle migration drops the legacy
  preference surface (5 columns, 1 table, 2 conversation tables) and
  creates the new substrate (`preferenceTree` JSONB, `preference_
  branch` table, `claimScores` JSONB, 5 new `app_config` rows).
- G2 — `CANONICAL_BRANCHES` TS constant is the single source of
  truth for canonical-branch semantics; `preference_branch` rows are
  seeded from it; every hard-coupled call site (`deriveL2Inputs`,
  L3 prompt-builder, `skillIntent` validator) iterates the constant
  rather than hardcoding slug literals.
- G3 — `filter-pipeline.ts` and the L3 prompt-input layer read from
  the tree via `deriveL2Inputs` / `summariseTreeForL3` helpers; no
  widening of `ScoringOutputSchema` in this PR.
- G4 — HEAD is typecheck/lint/test green at the end of the cutover
  PR; grep returns zero matches for legacy names outside the
  migration, tests, and fixtures (ADR-0010 acceptance gate).

### 3.2 Non-goals

- NG1 — No conversational LLM runtime. Chatbot routes return 501.
- NG2 — No Profile Map renderer. `/onboarding` is intentionally
  broken.
- NG3 — No widening of `ScoringOutputSchema`. `claim_scores` column
  is added but stays NULL.
- NG4 — No tree-driven rewrite of `internet-expansion.ts`. Warn-
  logged no-op only.
- NG5 — No rebalancing of `weight_*` RSLCD weights. Deferred per
  umbrella PRD §11.1 / design §14 (D11).
- NG6 — No changes to the location-preference tier shape. Inherited
  from umbrella PRD NG1.
- NG7 — No data migration of existing `user_profile` flat-column
  values into seeded leaves. Existing rows get an empty tree.

---

## 4. Success metrics

| Metric | Type | Target | Measured how |
|---|---|---|---|
| Migration applies in one transaction | leading | exit 0 | `pnpm drizzle-kit migrate` against a snapshot copy of the dev DB |
| HEAD green post-cutover | leading | 0 failing | `pnpm typecheck && pnpm lint && pnpm test` |
| Zero legacy-name grep matches outside allowlisted paths | leading | 0 | `rg -n 'userCompanyPreferences\|coreSkills\|growthSkills\|avoidSkills\|dealBreakers\|preferredIndustries\|chatbot/(engine\|schemas\|steps\|state)'` excluding `apps/web/drizzle/0010_*.sql`, `tests/`, `**/fixtures/**` |
| `/api/chatbot/*` 501 response | leading | 3/3 routes | `curl localhost:3000/api/chatbot/{message,state,save}` returns HTTP 501 with `{"error":"chatbot endpoints retired"}` |
| `preference_branch` row count matches `CANONICAL_BRANCHES` | leading | exact | `SELECT count(*) FROM preference_branch` equals `Object.keys(CANONICAL_BRANCHES).length` post-seed |
| Downstream sub-features open without "fix substrate" PRs | lagging | 3/3 sub-features (`conversation-runtime`, `profile-map-ui`, `l3-widening`) | absence of fix-up commits to the substrate during their PR cycles |
| `CANONICAL_BRANCHES` shape survives first composition change | lagging | no interface break | next composition-change PR opens without modifying the constant's TS schema |

**Kill criteria:** if (a) the migration aborts mid-transaction and
leaves the DB in mixed state requiring a `pg_dump` rollback, or (b)
within the first 30 days post-cutover a downstream sub-feature needs
a substrate fix-up PR, treat this as substrate failure and re-open
the design with the operator before continuing the chunk list. Do
not iterate by patching; reconsider the lock set in §11.2.

---

## 5. Current state

### 5.1 Existing behavior
The chatbot module is the only way a user expresses preferences. It
writes flat columns to `user_profile` and a row to
`user_company_preference`; `filter-pipeline.ts` JOINs both to build
the search filter set; the L3 worker hands five flat fields to
`buildScoringPrompt` whose system prompt names them by label
("Core Skills / Growth Skills / Deal-Breakers / Preferred
Industries"). `/onboarding` renders the chatbot UI;
`internet-expansion.ts` queries `user_company_preference` to widen
the company pool; `conversation_state` + `conversation_message`
hold the chatbot transcript. (Concrete file / column references:
§0, §11.5.)

### 5.2 Baseline data
No production cohort exists (`project_no_prod_users` invariant), so
there is no row-count or distribution baseline that constrains the
migration. The relevant baseline is structural and was captured in
research §Baseline context:

- 5 flat columns + 1 table + 2 conversation tables to drop.
- 1 JSONB column + 1 table + 1 JSONB column to add.
- 5 `app_config` rows to seed.
- `apps/web/drizzle/` contains migrations 0000–0009 — new migration
  is `0010_*.sql`.

`job_match` row count is not load-bearing because the migration
wipes it (see §11.2).

---

## 6. Proposed solution

### 6.1 Conceptual approach
Make the cutover atomic and reversible by snapshot. A single Drizzle
migration drops the legacy surface and creates the new substrate in
one transaction. The TypeScript layer (schema, filter pipeline, L3
prompt input, `app_config` seeding, internet-expansion handler) is
updated in the same PR so HEAD is green at every commit boundary.
Chatbot UI, lib, and onboarding page are deleted outright. The three
documented chatbot routes survive as 501 stubs so the Next.js auth
middleware path is preserved. Rollback is by `pg_dump` snapshot,
taken manually by the operator before applying the migration.

### 6.2 User flow
There is no end-user flow. The "user" of this PR is the next-PR
author.

1. Operator runs `pg_dump` snapshot manually (documented).
2. Operator merges the cutover PR.
3. Operator runs `pnpm drizzle-kit migrate`; migration 0010 applies.
4. Worker reboots; extended seeder (`apps/worker/src/lib/seed-config
   .ts`) upserts the 5 new `app_config` keys and the
   `preference_branch` rows derived from `CANONICAL_BRANCHES`.
5. Downstream sub-feature author opens their branch against the
   substrate.

**Unhappy branch.** If step 3 fails partway, the migration's single
transaction rolls back; HEAD stays on the new TS code (which compiles
against the new schema), so the operator restores from the `pg_dump`
snapshot and reverts the PR. Mixed state is not a possibility — the
migration's parse-old → transform → parse-new pattern aborts
in-transaction on mismatch.

### 6.3 Entities & state changes

- `user_profile` loses 5 flat columns; gains `preferenceTree` JSONB
  with default `{"schemaVersion":1,"leaves":[]}` for all existing
  rows. Location triplet and RSLCD weights are retained per §11.3.
- `user_company_preference` table drops.
- `conversation_state` and `conversation_message` tables drop.
- `preference_branch` table is created and seeded with the canonical
  top-level slugs and first-cut sub-branches from `CANONICAL_BRANCHES`.
- `job_match` gains a nullable `claimScores` JSONB column; existing
  rows are wiped (`DELETE FROM job_match`) so cached RSLCD scores
  don't reference an obsolete profile shape.
- `app_config` gains five rows: `scoring.l3_candidate_cap=100`,
  `scoring.extend_batch_size=100`, `ui.profile_map_max_depth=3`,
  `chatbot.clarification_budget=2`, `scoring.l3_claims_per_call=15`.

### 6.4 Interactions with existing features

- **Search / filter**: `filter-pipeline.ts` reads `deriveL2Inputs
  (tree)` instead of the `user_company_preference` JOIN. Empty tree
  → no industry / title filtering.
- **L3 worker**: consumes `treeSummary: string` instead of five flat
  fields. Output schema unchanged (see §11.2).
- **Chatbot UI / routes**: deleted / 501. Auth middleware survives
  because the three route files still export handlers.
- **`internet-expansion`**: warn-logged no-op; queue subscription
  stays mounted (§11.2 carries the exact shape).
- Surfaces NOT touched by this PR are listed in §11.3.

---

## 7. MVP scope

### 7.1 In the first ship

- Drizzle migration `0010_*.sql` (DDL only; one transaction;
  includes `DELETE FROM job_match`).
- Schema TS update in `packages/db/src/schema.ts`.
- `apps/web/src/lib/profile-tree/` module:
  `canonical-branches.ts` (with `CANONICAL_BRANCHES`), leaf Zod
  schema, `mutateLeaf`, `moveLeaves`, `deriveL2Inputs`,
  `summariseTreeForL3`, `migrate-leaves.ts` (shipped for future use;
  not exercised by this sub-feature).
- Extended TS-driven seeder in `apps/worker/src/lib/seed-config.ts`
  for the 5 new `app_config` keys AND the `preference_branch` seed
  from `CANONICAL_BRANCHES`.
- Filter-pipeline rewire to tree-derived inputs.
- L3 worker prompt-input swap (`treeSummary`).
- Chatbot lib + UI + onboarding-page deletion; three routes → 501
  stubs.
- `internet-expansion.ts` → warn-logged no-op.
- Stale-comment fix in `packages/ats-core/src/geo/resolve-user-
  location.ts`.
- Unit tests for `profile-tree/*` covering at minimum the eight
  fixture cases enumerated in §11.5.

### 7.2 Fast follow (after validation)

- Tree-driven rewrite of `internet-expansion.ts` (or fold into
  `conversation-runtime`).
- `weight_*` RSLCD rebalancing (deferred per umbrella).
- `l3-widening` adds `claim_scores` writes + computes
  `hasGrowthSkillMatch` server-side from `claim_scores`.
- `profile-map-ui` renderer.
- `conversation-runtime` LLM conversation engine.

### 7.3 Maybe-never

- Preserving chatbot UI as a deprecated path.
- Keeping `user_company_preference` as a read-only legacy table.
- Soft-deleting flat columns instead of dropping (no value with no
  prod users).
- Coexistence layer that reads from both old and new profile shapes
  during a transition window.

---

## 8. Alternatives considered

### Alternative A — Multiple smaller migrations
Why considered: smaller migrations roll back individually; downstream
sub-features could land incrementally without one big cutover. Why
rejected: each migration leaves HEAD in a half-old / half-new state
that downstream PRs would have to defend against. Intermediate states
multiply the surface area of `conversation-runtime` and `l3-widening`
because they'd need shims for whichever columns still existed.

### Alternative B — Coexistence layer (keep legacy columns alongside the tree)
Why considered: zero-downtime industry practice; reduces blast
radius. Why rejected: no prod users (`project_no_prod_users`), so
zero-downtime is unearned overhead. The coexistence layer becomes
permanent technical debt and slows every downstream sub-feature.
ADR-0010 explicitly rejects this path.

### Alternative C — Soft-delete columns (keep but ignore)
Why considered: cheapest migration; column drops are sometimes
painful. Why rejected: invites accidental reads from stale data; the
grep acceptance gate (ADR-0010 / §11.2 / §4) wouldn't be achievable;
postgres column drops on a tiny dev DB are trivial.

---

## 9. Risks & trade-offs

### 9.1 Product risks
- Intermediate broken UX at `/onboarding` and "empty profile" search
  results for any user until `conversation-runtime` writes a leaf.
  Accepted because solo product with no users; the umbrella plan
  schedules `conversation-runtime` immediately after this sub-feature.

### 9.2 Business risks
N/A — no users, no competitive comparison, no compliance dimension.

### 9.3 Dependencies & assumptions
- Postgres + Drizzle migration runner are healthy on the dev DB.
- `pg_dump` snapshot is taken before applying (operator-manual step;
  see §11.5).
- No production cohort exists to migrate forward (verified —
  `project_no_prod_users`).
- `ats-core` does not import any chatbot or legacy-LLM symbols
  (verified during research: only a stale comment in
  `resolve-user-location.ts:9-17`).
- Drizzle SQL migrations cannot import TS — so the `preference_
  branch` seed runs at worker startup via the extended TS seeder, not
  inside the SQL migration. SQL handles DDL + `DELETE FROM job_match`
  only.
- `seedPollingConfig`'s `.onConflictDoNothing()` pattern preserves
  operator-edited values on re-seed (`feedback_check_existing_
  libraries` / project precedent).

---

## 10. Open questions

- [ ] PR boundaries inside the chunk — single PR vs 2-4 small PRs.
  Either can satisfy HEAD-green at every commit; `/plan` decides
  based on diff size and reviewer-load.
- [ ] Exact set of canonical sub-branches under `company-attributes/
  *` to seed at MVP. Design §5 lists a first cut (`size`, `stage`,
  `funding`, `hq`, `product-or-services`, `brand`, `culture`); the
  final list is confirmed in `/plan`.
- [ ] Whether `migrate-leaves.ts` ships with a dry-run mode for
  future operator use, or is invoked only programmatically from
  future migrations. `/design` decides.
- [ ] Whether the cutover PR adds a `make snapshot-pre-wipe` script
  or leaves `pg_dump` as a documented README step. `/plan` decides.

---

## 11. Contract with the downstream agent

### 11.1 Decisions the agent owns

- Shape of the seed function — rename `seedPollingConfig`, add a
  sibling `seedAppConfigDefaults`, or fold both into one combined
  function. Pick by minimum-diff and minimum coupling.
- Textual form of `summariseTreeForL3(tree)` output beyond the
  invariants in §11.2 (bullet list vs comma list vs one-line section,
  punctuation, line breaks).
- Whether the `preference_branch` seed runs on every worker boot
  (idempotent upsert) or gates behind a one-shot migration-state row.
- Final unit-test fixture set for `profile-tree/*` — must cover the
  eight cases in §11.5 at minimum; the agent may add more.
- Whether the repo gains a `make snapshot-pre-wipe` script or
  `pg_dump` stays as a README step.
- PR boundaries inside the chunk (single PR vs 2-4 PRs).
- File layout inside `apps/web/src/lib/profile-tree/` (single
  `index.ts` re-export vs flat module).
- Drizzle generation strategy — one generated SQL file vs SQL +
  follow-on idempotent DML file. Both satisfy the one-transaction
  lock as long as DDL stays inside a single TX.
- Choice of HTTP error JSON shape format details (e.g. whether to
  include a `code` field alongside `error`) — only the literal body
  in §11.2 is locked.

### 11.2 Decisions that are locked

- **One transactional migration** drops the legacy surface and
  creates the new substrate. Partial state is never committed.
- **`CANONICAL_BRANCHES` TS constant is the single source of truth**
  for canonical-branch semantics. `preference_branch` rows are
  derived from it; they are not hand-written in SQL or duplicated.
- **`job_match` is wiped** in the same migration
  (`DELETE FROM job_match`) so cached RSLCD scores do not reference
  the obsolete flat profile shape.
- **Chatbot UI components + `/onboarding/page.tsx` delete with the
  lib.** No stub page. Intermediate broken UX is acceptable.
- **The three documented chatbot routes survive as 501 stubs:**
  `/api/chatbot/message`, `/api/chatbot/state`, `/api/chatbot/save`.
  Response: HTTP **501** with JSON body `{"error":"chatbot endpoints
  retired"}`. Auth middleware path is preserved (the route handler
  files exist and export handlers).
- **`internet-expansion.ts` becomes a warn-logged no-op** with this
  exact shape: skip the DB read entirely, log
  `"internet-expansion disabled pending tree-driven rewrite"` once
  per invocation, return 0 new companies. Queue subscription stays
  mounted.
- **`buildScoringPrompt` signature changes** from flat profile fields
  to a single `treeSummary: string` produced by a new helper
  `summariseTreeForL3(tree)`. The L3 system-prompt body's natural-
  language interface to user preferences is preserved — the prompt
  body is not rewritten in this sub-feature. Empty tree produces a
  non-empty placeholder summary so the prompt does not degenerate.
- **L3 `ScoringOutputSchema` is untouched.** `hasGrowthSkillMatch`
  continues to be emitted by the LLM; the growth-bonus computation
  path is unchanged. Widening is `l3-widening`'s responsibility.
- **`claim_scores` column is added but stays NULL.** No write path
  is implemented in this sub-feature.
- **`app_config` seed keys land via the existing TS seeder**, not
  via SQL `INSERT` statements in the Drizzle migration. The five
  keys are exactly: `scoring.l3_candidate_cap`,
  `scoring.extend_batch_size`, `ui.profile_map_max_depth`,
  `chatbot.clarification_budget`, `scoring.l3_claims_per_call`.
- **No data migration of existing flat-column values into seeded
  leaves.** Existing rows get an empty tree; preferences are
  re-collected by `conversation-runtime` when it lands.

### 11.3 Invariants to preserve

- `apps/web/src/lib/db/schema.ts` stays a one-line re-export of
  `packages/db/src/schema.ts` (project convention).
- snake_case columns / camelCase TS fields (project rule
  `db-schema.md`).
- `updatedAt` is not auto-managed by Drizzle (project rule).
- `packages/ats-core/src/geo/resolve-user-location.ts` keeps its
  locally-defined `LocationPreferenceTierInput` interface; only the
  stale comment referencing chatbot schemas is updated.
- Retained `user_profile` columns: `targetTitles`, `targetSeniority`,
  `yearsExperience`, `locationPreferences`, `preferredLocations`,
  `remotePreference`, `minSalary`, `targetSalary`, `salaryCurrency`,
  and the RSLCD `weight_*` set (lines 212–216 of `packages/db/src/
  schema.ts`). The location triplet covers umbrella PRD NG1.
- The L3 RSLCD scoring path computes via the existing
  `compute-match-percent.ts` flow; no behavioural change to scoring
  math.
- Synonym expansion at search time (`expandTerms` via
  `synonym_group`) is unchanged.
- `app_config` value-edits made by the operator on existing keys are
  preserved across seeder runs (`onConflictDoNothing` pattern, per
  `seedPollingConfig`).
- Drizzle migration numbering is sequential — new migration is
  `0010_*.sql`; the migration history under `apps/web/drizzle/` is
  append-only.

### 11.4 Technical hints (optional, non-binding)

- Hint: set the new `preferenceTree` column default to
  `{"schemaVersion":1,"leaves":[]}` so existing rows are non-NULL —
  research flagged `jsonb_set` collapses to NULL on missing paths.
  Subsequent leaf mutations happen in TS, not SQL.
- Hint: `mutateLeaf` and `migrate-leaves.ts` should be idempotent —
  recognise both pre- and post-schema shapes, key off the
  `schemaVersion` field already in design §4.
- Hint: `summariseTreeForL3` should emit section labels that mirror
  the existing prompt's "Core Skills / Growth Skills / Deal-Breakers
  / Preferred Industries" terminology, so the system-prompt body is
  not rewritten. Empty tree → `"No preferences set yet."`.
- Hint: wire `FOR UPDATE` + 500–2000-row batching into the
  `moveLeaves` signature so future callers don't reinvent it (not
  exercised here).
- Hint: post-rewrite JSONB equality with `=` is unsafe (key-order
  dependent); use `@>` both ways or a normalised hash in tests.

### 11.5 Verified during research

- `internet-expansion.ts` is the only worker handler importing
  `userCompanyPreferences` outside the chatbot path; conversion to
  no-op does not break other handlers (`apps/worker/src/handlers/
  internet-expansion.ts:8` + `:189-193`).
- `preference-llm.ts` and `prompts.ts` under `apps/web/src/lib/llm/`
  are only consumed by the chatbot module; full delete is safe.
- `filter-pipeline.ts` flat-column reads at lines 95–116 use only
  retained columns (`targetTitles`, `targetSeniority`,
  `remotePreference`, `preferredLocations`); only the
  `user_company_preference` JOIN at lines 71–83 needs replacement.
- `llm-scoring.ts:6` imports `userProfiles` only (not
  `userCompanyPreferences`); the prompt-input handoff at lines
  160–174 is the single touch point.
- `scoring-prompt.ts` system-prompt body references "Core Skills /
  Growth Skills / Deal-Breakers / Preferred Industries" verbatim at
  lines 75–95 — `summariseTreeForL3` must produce text that maps
  onto these section labels so the body is not rewritten.
- `ats-core/src/geo/resolve-user-location.ts:9-17` has a stale
  comment referencing the to-be-deleted `apps/web/src/lib/chatbot/
  schemas.ts`; the structural type `LocationPreferenceTierInput` is
  locally defined — only the comment needs updating.
- `seedPollingConfig` in `apps/worker/src/lib/seed-config.ts` uses
  `.insert(...).values([...]).onConflictDoNothing()` and is the
  documented pattern to extend for new `app_config` keys.
- Drizzle migration numbering: `apps/web/drizzle/` contains
  migrations 0000–0009 today; the new migration is `0010_*.sql`.
- Minimum unit-test fixture set for `profile-tree/*`: (1) empty
  tree; (2) single-leaf tree; (3) multi-leaf single-branch tree;
  (4) multi-branch tree; (5) leaf with deep `branchPath`; (6) leaf
  with `skillIntent`; (7) invalid leaf missing `branchSlug` (assert
  throw or skip); (8) golden `moveLeaves` path — move all
  `industry`-slug leaves to a new slug + path.
- `pg_dump` snapshot before applying is an operator-manual step; not
  automated by this sub-feature.
