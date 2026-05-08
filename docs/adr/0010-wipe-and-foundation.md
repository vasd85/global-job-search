# ADR-0010 — Wipe legacy profile artefacts and scaffold the new substrate in one foundation PR

## Status

Proposed

## Context

The umbrella PRD (`docs/product/2026-05-06-profile-driven-architecture.md`)
mandates a complete wipe of legacy profile data and conversation
state at ship (§11.2: "All existing user preference data and
conversation state is wiped at ship. No migration path."). The
project memory invariant — "no prod users; schema/API can be broken
freely" — makes hard cuts safe.

The CLAUDE.md process invariant — hooks gate `pnpm typecheck`,
`pnpm lint` per commit, `pnpm test` per PR; old code removed in the
same PR that replaces it; no feature flags — means the overhaul
must decompose into self-consistent PRs that each leave the codebase
green at HEAD. The first PR is structurally important: it removes
the legacy chatbot module and the legacy schema, scaffolds the new
schema, and adapts existing consumers (filter pipeline, L3 worker)
to read from the new substrate. Subsequent sub-features can then
assume the substrate exists.

The PRD §11.4 hint identifies the candidate diff for this PR:

> The first sub-feature in the roadmap is the natural carrier for:
> dropping `user_company_preference`, dropping flat fields on
> `user_profile`, removing `apps/web/src/lib/chatbot/*` and
> `apps/web/src/app/api/chatbot/save/route.ts`, scaffolding the tree
> schema and branch registry, leaving L2 / L3 reading the remaining
> fields (or stubbed) so `pnpm test` remains green at PR boundary.

This ADR locks the diff shape so the first sub-feature plan
inherits a deterministic seam.

## Decision

We will land the wipe and foundation as the first sub-feature in
the overhaul roadmap. The PR diff has the following shape (binding
for the first sub-feature plan; sub-feature can refine but not
contradict):

**Database (one Drizzle migration, single transaction):**

- `DROP TABLE user_company_preference`.
- `ALTER TABLE user_profile DROP COLUMN core_skills, growth_skills,
  avoid_skills, deal_breakers, preferred_industries`.
- `ALTER TABLE user_profile ADD COLUMN preference_tree jsonb`.
- `CREATE TABLE preference_branch` (per the branch-registry-storage
  ADR).
- Seed `preference_branch` with the nine top-level slugs from PRD
  §6.3 plus the first cut of sub-branches.
- `ALTER TABLE job_match ADD COLUMN claim_scores jsonb`.
- Insert defaults into `app_config`:
  `scoring.l3_candidate_cap = 100`,
  `scoring.extend_batch_size = 100`,
  `ui.profile_map_max_depth = 3`,
  `chatbot.clarification_budget = 2`,
  `scoring.l3_claims_per_call = 15`.
- `DELETE FROM conversation_message`; `DELETE FROM conversation_state`.
  Schemas of these tables remain unchanged.

**Code removals:**

- `apps/web/src/lib/chatbot/{engine,steps,schemas,state,location-utils}.ts`
  and their `*.test.ts` siblings.
- `apps/web/src/app/api/chatbot/save/route.ts` (the save endpoint
  is meaningless after the wipe).
- `apps/web/src/lib/llm/preference-llm.ts` and
  `apps/web/src/lib/llm/prompts.ts`.

**Code stubs introduced:**

- `apps/web/src/lib/profile-tree/` — Zod leaf schema, tree CRUD
  pure functions (`appendLeaf`, `updateLeaf`, `deleteLeaf`,
  `getLeavesByBranch`, `serialize`/`deserialize`), branch-registry
  reader, `deriveL2Inputs(tree)` helper, `canonical-branches.ts`
  (the `CANONICAL_BRANCHES` constant and `CanonicalBranchDef`
  type per ADR-0011), `migrate-leaves.ts` (JSONB rewrite utility
  per ADR-0011 — `moveLeaves(db, opts)` for branch-composition
  migrations). All pure, all unit-tested. The seed migration
  reads `CANONICAL_BRANCHES` to populate `preference_branch` rows
  rather than embedding slug literals.
- `apps/web/src/lib/profile-conversation/` — exports a no-op
  `processTurn` that returns "not yet implemented" plus empty
  mutations. Replaced by the conversation runtime sub-feature.
- `apps/web/src/app/api/chatbot/*` route shells preserved (auth,
  echo a 501 / stub message) so the existing UI does not crash.
  Replaced by the conversation API in the conversation sub-feature.

**Filter pipeline (`filter-pipeline.ts`):**

- Removes the `userCompanyPreferences` JOIN (table is dropped).
- Replaces flat-column reads with `deriveL2Inputs(profile.preferenceTree)`.
- Behaviour: empty tree → empty derived inputs → empty results.
  Acceptable because the wipe leaves every user with an empty tree;
  search returns no results until the conversation sub-feature
  ships.

**L3 worker (`apps/worker/src/handlers/llm-scoring.ts`,
`scoring-prompt.ts`):**

- Updates input wiring to read tree-derived facts via the same
  deriver (or a dedicated tree-to-prompt-summary helper).
- **Does not yet widen `ScoringOutputSchema`.** Per-claim scoring
  lands in the L3 sub-feature. The RSLCD path stays unchanged in
  this PR; only the input source changes.
- The handler can no-op gracefully when the tree is empty (no
  claims to score).

**Acceptance gates (locked):**

- `pnpm typecheck`, `pnpm lint`, `pnpm test` green.
- Search page renders with empty results for all users.
- Trigger scoring returns 0 candidates / 0 enqueued.
- No reference remains to `user_company_preference`,
  `coreSkills`, `growthSkills`, `avoidSkills`, `dealBreakers`,
  or `preferredIndustries` in the codebase outside the migration
  itself.

## Consequences

- **Positive — clean substrate.** Subsequent sub-features assume
  the new schema and stubbed runtime exist; no coordination
  overhead between sub-feature plans.
- **Positive — single-PR scope.** All destructive changes happen
  once; the codebase is never in a half-deleted state across
  separate PRs.
- **Positive — typecheck/lint/test green at PR boundary.** Stubs
  cover the runtime gap; tests update fixtures from flat-field
  shape to tree-shape; nothing is dangling.
- **Positive — empty-tree default is acceptable** because PRD
  §11.2 wipes user data; users will rebuild their profile via the
  conversation sub-feature. Search returning empty in the interim
  is correct, not broken.
- **Negative — large, irreversible diff.** Reverting after this PR
  requires a manual restore from a `pg_dump`. Mitigation: snapshot
  the DB before applying the migration. Solo product; the cost of
  caution is one `pg_dump` invocation.
- **Negative — interim user-facing UX is broken.** Between this PR
  and the conversation sub-feature, users have no way to populate a
  profile. Acceptable per PRD §9.1 ("intermediate broken-UX is
  acceptable, broken-codebase is not"), and acceptable per project
  memory ("no prod users").
- **Negative — `apps/web/src/app/api/chatbot/*` routes remain as
  shells.** They could be deleted in this PR but the UI would
  crash; we keep them as 501 stubs. The conversation sub-feature
  replaces them with the new endpoint surface.
- **Neutral — L3 worker schema not yet widened.** Per-claim
  scoring is layered later, keeping this PR small. The widening
  is independently blocked on the conversation sub-feature
  populating `preferenceTree`.
- **Follow-on work.** First sub-feature plan must (1) write the
  Drizzle migration as a single transaction with idempotent seed
  inserts, (2) write the `profile-tree/` module with full unit
  test coverage, (3) update existing filter-pipeline and L3 tests
  to feed tree fixtures rather than flat profiles, (4) keep the
  chatbot API route shells alive to preserve auth flow until the
  conversation sub-feature replaces them.
