# Profile-driven architecture (overhaul) — Sub-feature roadmap

Status: **Draft v1** | Date: 2026-05-07 | Owner: vasd85
PRD: `docs/product/2026-05-06-profile-driven-architecture.md`
Design: `docs/designs/2026-05-06-profile-driven-architecture.md`

> **Reader.** This is an **umbrella sub-feature roadmap**, not a
> per-PR implementation plan. The architectural overhaul is too
> large to ship as one `/feature` cycle's set of Work Items. Each
> chunk in §5 is a **sub-feature seed**: it will become its own
> future `/feature` run (research / prd / design / plan / tasks /
> implement-task), and will produce multiple PRs of its own. The
> user explicitly chose this shape on 2026-05-06.
>
> **Do NOT run `/tasks` against this plan after the planning PR
> merges to `main`.** Chunks are not directly implementable Work
> Items. Instead, run `/feature <topic-for-chunk-N>` once per chunk
> in dependency order; each sub-feature's own `/tasks` runs against
> its own merged plan.
>
> The DAG and metadata blocks below are still machine-parseable in
> the standard plan shape, so a future operator may parse the plan
> if the workflow ever supports umbrella decomposition. For now the
> chunk metadata is documentation, not a Plane Work Item source.

---

## 0. Context

Architectural overhaul that replaces the flat-field, 16-step
profile capture and dead-at-L2 matching with a tree-shaped private
profile, conversational collection, and per-claim L3 LLM-judge.
PRD §1 documents the user problem (compound preferences mangled at
capture, 11 of 14 fields dead at L2); PRD §6 commits to the
tree-shaped profile + conversational agent + extended hybrid
matcher; PRD §11.2 locks 17 product decisions; PRD §11.3 locks 9
invariants. Design §2 gives the integrated picture; design §18
identifies five visible seams with a hard ordering constraint
(wipe + foundation first; conversation runtime, Profile-Map UI,
and L3 widening can parallelise after).

- **PRD:** `docs/product/2026-05-06-profile-driven-architecture.md`
  (key sections: §3 goals/non-goals, §6 proposed solution, §11.2
  locked decisions, §11.3 invariants).
- **Design:** `docs/designs/2026-05-06-profile-driven-architecture.md` —
  Format B (Architectural Decision); 14 decisions; 10 finalised in
  MVP scope, 4 deferred to sub-feature design. §18 enumerates the
  visible seams this plan inherits.
- **ADRs (read in full by each sub-feature's `/implement-task`):**
  - `docs/adr/0004-branch-registry-storage.md`
  - `docs/adr/0005-conversation-runtime.md`
  - `docs/adr/0006-l3-schema-extension.md`
  - `docs/adr/0007-per-claim-scores-on-job-match.md`
  - `docs/adr/0008-transient-overlay-storage.md`
  - `docs/adr/0009-tree-persistence.md`
  - `docs/adr/0010-wipe-and-foundation.md`

---

## 1. Goals

PRD §3.1 G1–G8 mapped to the sub-feature seeds delivering each.

- **G1 — verbatim leaf phrasing + direction polarity** → delivered
  by `wipe-and-foundation` (data model + leaf schema) and
  `conversation-runtime` (LLM commits claims verbatim).
- **G2 — agent-initiated clarification before commit** → delivered
  by `conversation-runtime`.
- **G3 — soft claims matchable at L3 with substring-verifiable
  evidence** → delivered by `l3-widening`.
- **G4 — Profile Map at configured max depth, edits via Chat
  only** → delivered by `profile-map-ui`.
- **G5 — no finished state; refinement via the same Chat surface**
  → delivered by `conversation-runtime` (no `complete` flag, tree
  mutates in place).
- **G6 — hard filters at L1/L2 stay structured and cheap** →
  delivered by `wipe-and-foundation` (`deriveL2Inputs(tree)` keeps
  L2 SQL shape).
- **G7 — L3 in bounded batches with explicit user extension** →
  delivered by `l3-widening` (cap from `app_config`) and
  `results-affordances` ("Score more" affordance).
- **G8 — three results-page affordances** → delivered by
  `results-affordances`.

---

## 2. Non-goals

PRD §3.2 NG1–NG11 carry through verbatim. Plan-specific exclusions:

- **NG12 — direct Plane Work Items from this plan.** Chunks here
  are sub-feature seeds, not implementable Work Items. The standard
  `/tasks` → Plane Epic → Work Items flow does not apply to this
  umbrella plan; each sub-feature's own `/tasks` runs against its
  own merged plan after its planning PR merges.
- **NG13 — application projection (CV / cover letter) and
  evidence-as-content (links, project references, numbers).**
  Locked out of this overhaul per PRD §11.2 + user 2026-05-06;
  belongs to a separate "from profile to application" cycle.
- **NG14 — feature flags or backwards-compat shims.** Memory:
  "no prod users → schema/API can be broken freely". Each
  sub-feature's PRs are hard cuts.

---

## 3. Constraints

- **C1 — umbrella plan reframe.** Chunks below are sub-feature
  seeds. Each chunk spawns its own `/feature` cycle and produces
  multiple PRs. Do not interpret chunks as single PRs.
  Source: user 2026-05-06; phase-state notes for this slug.
- **C2 — tree-shaped data model with verbatim leaves and direction
  polarity is locked.** No flat arrays, no transcript, no
  symmetric-with-companies. Source: PRD §11.2.
- **C3 — nine canonical top-level branches** (Role, Skills,
  Compensation, Location, Industry, Company Attributes, Exclusions,
  Deal-breakers, Other), with **semantics centralised in a TS
  constant `CANONICAL_BRANCHES`** at
  `apps/web/src/lib/profile-tree/canonical-branches.ts` (single
  source of truth). Sub-branches and full hierarchy under canonical
  roots are developer-editable at runtime via `preference_branch`.
  **Composition changes to the canonical set itself** (add /
  remove / rename / move / merge) **are supported** via TS-constant
  edits + the `migrate-leaves.ts` utility + a Drizzle migration +
  PRD update. Source: PRD §11.2; design §16.5 (D15); ADR-0011.
- **C4 — collection is conversational and adaptive.** No 16-step
  linear wizard. Ambiguous input triggers agent-initiated
  clarification with best-guess phrasing before commit. Source:
  PRD §11.2.
- **C5 — editing is always via Chat.** No inline edit on the
  Profile Map. Chat ↔ Profile is a UI control, never an LLM
  command. Source: PRD §11.2.
- **C6 — L3 worker stays per-job consolidated structured output.**
  One LLM call per scored job, widened to emit per-claim scores +
  substring-verifiable evidence phrases. No per-claim-per-job
  scoring. Source: PRD §11.2; design §6 (D3); ADR-0006.
- **C7 — substring-verify every L3 evidencePhrase.** Hallucinated
  phrases must not reach `job_match`. Source: PRD §11.3; design §6.
- **C8 — three results-page affordances are locked.** Re-shaping,
  consolidating, or hiding any of (Score more / Change profile
  preferences / Change filters) requires reopening the PRD.
  Source: PRD §11.2.
- **C9 — transient L2 overlay never mutates persistent state.**
  No write path from query-string params to the profile tree,
  `conversation_message`, or `conversation_state`. Source: PRD
  §11.3; design §10 (D7); ADR-0008.
- **C10 — naming is locked.** UI sections `Chat` and `Profile`;
  artefact `Profile Map`. No user-facing brand name for the
  conversational process. Forbidden labels: `Onboarding`,
  `Interview`, any job-interview-adjacent phrasing. Source: PRD
  §11.2.
- **C11 — wipe at ship; no migration.** All existing
  `user_profile.{coreSkills,growthSkills,avoidSkills,
  dealBreakers,preferredIndustries}`, the entire
  `user_company_preference` table, and all `conversation_state` /
  `conversation_message` rows are dropped. Source: PRD §11.2;
  design §11 (D8); ADR-0010.
- **C12 — every PR keeps the codebase compiling and tests green
  at HEAD.** Hooks gate typecheck + lint per commit, `pnpm test`
  per PR. Old code is removed in the same PR that replaces it.
  Source: CLAUDE.md; memory.
- **C13 — profile data scope.** Capture is sized for matching
  only, not for application projection. No first-class
  evidence-as-content fields on leaves. Source: user 2026-05-06.

---

## 4. Dependency DAG

ASCII layout:

```
                  ┌─ conversation-runtime ─┐
wipe-and-fnd ─────┤                        │
                  ├─ profile-map-ui ───────┼─→ (manual end-to-end validation)
                  └─ l3-widening ──────────┴─→ results-affordances
                          (optional, fast-follow)
                                    location-alignment
```

**Critical path:** `wipe-and-foundation` → `l3-widening` →
`results-affordances`.

**Parallelisable after `wipe-and-foundation`:** `conversation-
runtime`, `profile-map-ui`, `l3-widening` — three independent
layers. `conversation-runtime` writes the tree; `profile-map-ui`
reads it; `l3-widening` reads it for scoring. End-to-end
validation needs all three populated, but their sub-feature work
can proceed concurrently.

**Diamond:** results-page validation requires `l3-widening` (for
per-claim scores to display) and at least one of `conversation-
runtime` / `profile-map-ui` to populate the tree manually.

**Isolated leaf:** `location-alignment` — fast-follow if the
location tier shape diverges structurally from the new leaf shape
(per PRD §7.2 + §11.3). Blocks nothing; safe to defer.

---

## 5. Chunks (sub-feature seeds)

> **Reminder.** Each chunk below seeds a future `/feature` run.
> The sub-feature's own PRD / design / plan / tasks /
> implement-task cycle decides PR boundaries within it. The
> "Files" section here lists the sub-feature's overall surface,
> not a single PR's diff. The "Acceptance criteria" reflect
> *sub-feature done*, verified after all of the sub-feature's own
> PRs have merged.

### Chunk wipe-and-foundation — Drop legacy profile artefacts and scaffold the new substrate

```yaml
id: wipe-and-foundation
depends_on: []
labels:
  - feature:profile-driven-architecture
  - type:feat
  - scope:sub-feature-seed
  - priority:critical-path
```

**Goal.** Land the substrate every other sub-feature reads from:
new tree column on `user_profile`, `preference_branch` table with
seed rows, `claim_scores` JSONB on `job_match`, `app_config`
defaults — paired with the deletion of the 16-step chatbot module,
`user_company_preference` table, and the flat user-profile fields.
Anchors G1, G6; closes ADR-0010.

**Files (sub-feature surface, all phases combined).**

- `packages/db/src/schema.ts` — modify (add `preferenceBranch`,
  `user_profile.preferenceTree`, `job_match.claimScores`; drop
  flat columns and the `user_company_preference` table).
- `apps/web/src/lib/db/schema.ts` — modify re-exports.
- New Drizzle migration (path per existing convention) — single
  transaction per design §11.
- `apps/web/src/lib/chatbot/{engine,steps,schemas,state,location-utils}.ts`
  — delete + delete sibling tests.
- `apps/web/src/app/api/chatbot/save/route.ts` — delete.
- `apps/web/src/lib/llm/{preference-llm,prompts}.ts` — delete.
- `apps/web/src/lib/profile-tree/` — create (Zod leaf schema, pure
  CRUD, branch-registry reader, `derive-l2.ts`); unit-tested.
- `apps/web/src/lib/profile-tree/canonical-branches.ts` — create
  (`CANONICAL_BRANCHES` constant + `CanonicalBranchDef` type per
  D15 / ADR-0011; single source of truth for canonical-branch
  semantics; declarative behaviour hooks `l2Derivation`,
  `synonymDimension`, `acceptsSkillIntent`, `matcherScope`,
  `l3Soft`).
- `apps/web/src/lib/profile-tree/migrate-leaves.ts` — create
  (`moveLeaves(db, opts)` JSONB rewrite utility per ADR-0011;
  callable from any future Drizzle migration that reshapes
  canonical-branch composition).
- `apps/web/src/lib/profile-conversation/` — create no-op
  `processTurn` stub.
- `apps/web/src/app/api/chatbot/*` — modify to auth-preserving 501
  stubs (replaced by `conversation-runtime` sub-feature).
- `apps/web/src/lib/search/filter-pipeline.ts` — modify (drop
  `userCompanyPreferences` JOIN; consume `deriveL2Inputs(tree)`).
- `apps/worker/src/handlers/llm-scoring.ts` — modify (rewire input
  source from flat columns to tree-derived facts; **no schema
  widening yet** — that lands in `l3-widening`).

**Acceptance criteria.**

- [ ] Sub-feature planning PR (PRD + design + plan) merged to
  `main`.
- [ ] Implementation PR(s) merged to `main`; HEAD `pnpm typecheck`,
  `pnpm lint`, `pnpm test` exit 0.
- [ ] DB after migration: `user_company_preference` and the listed
  flat columns no longer exist; `user_profile.preference_tree`
  JSONB column exists; `preference_branch` table exists with the
  nine top-level rows seeded; `job_match.claim_scores` JSONB
  column exists; `app_config` rows for
  `scoring.l3_candidate_cap`, `scoring.extend_batch_size`,
  `ui.profile_map_max_depth`, `chatbot.clarification_budget`,
  `scoring.l3_claims_per_call` are present with default values.
- [ ] `apps/web/src/lib/chatbot/`, the chatbot save route, and
  the deleted LLM helpers are absent from `git ls-files`.
- [ ] `apps/web/src/app/api/chatbot/*` routes return 501 with auth
  preserved (manual smoke).
- [ ] `searchJobs` returns empty for the test user (correct
  post-wipe behaviour).
- [ ] `grep -r 'user_company_preference\|coreSkills\|growthSkills\|avoidSkills\|dealBreakers\|preferredIndustries' apps packages` returns zero non-migration matches.
- [ ] `CANONICAL_BRANCHES` constant exists with nine entries; each
  entry has the declarative behaviour hooks per ADR-0011 (`slug`,
  `kind`, `displayName`, `description`, optional `l2Derivation`,
  `synonymDimension`, `acceptsSkillIntent`, `matcherScope`,
  `l3Soft`).
- [ ] `migrate-leaves.ts` exposes a `moveLeaves` function callable
  from a Drizzle migration; one transaction; rewrites
  `branchSlug` and the matching `branchPath[]` entry on every
  affected `user_profile.preferenceTree.leaves[]`. Unit-tested
  against representative tree fixtures.
- [ ] Hard-coupled call sites (`deriveL2Inputs`, conversation
  prompt-builder stub, L3 prompt-builder, `skillIntent` validator,
  exclusions/deal-breakers split, synonym-dimension binding) read
  from `CANONICAL_BRANCHES` rather than slug literals.
- [ ] DB seed migration reads `CANONICAL_BRANCHES` to populate
  `preference_branch` rows (no duplicate source of truth between
  TS and DB).
- [ ] `grep -rn "'role'\|'skills'\|'compensation'\|'location'\|'industry'\|'company-attributes'\|'exclusions'\|'deal-breakers'\|'other'" apps packages --include='*.ts'`
  returns matches only inside `canonical-branches.ts`, the seed
  migration, and tests / fixtures — no scattered slug literals
  in handler code.

**Test strategy.** Unit-test `apps/web/src/lib/profile-tree/`
exhaustively, including `canonical-branches.ts` (snapshot of the
nine entries) and `migrate-leaves.ts` (golden-path move + merge
with `mutateLeaf` + edge cases like empty tree and missing slug)
(`pnpm test apps/web` with new test files). Update
`filter-pipeline.test.ts` to reflect tree-derived inputs and the
constant-driven derivation. Delete chatbot tests in the same PR
as the module deletion. Schema test
`apps/web/src/lib/db/schema.test.ts` updated to assert new shape.
Manual: hit `/api/chatbot/*` and confirm 501s.

**Effort.** 2–5 days (full `/feature` cycle: research note +
PRD + design + plan; then 2–4 implementation PRs — adds ~1 day
versus the pre-amendment estimate to land the canonical
centralisation per ADR-0011).

**Risks.**

- Wipe migration drops two tables and rewrites `user_profile` in
  one transaction — mitigation: `pg_dump` snapshot pre-apply
  (cheap insurance).
- Filter pipeline reads stop returning results until
  `conversation-runtime` populates the tree — mitigation:
  documented expected behaviour; not a regression at HEAD.

**Hints.**

- Hint: leaf schema sketch fixed in design §4; Zod schema goes in
  `apps/web/src/lib/profile-tree/leaf-schema.ts`.
- Hint: `preference_branch` mirrors `role_family` (design §5).
- Hint: branch-slug write-time validation; no Postgres FK across
  the JSONB boundary (ADR-0009 § Decision).
- Hint: `CanonicalBranchDef` schema and the composition-change
  playbook are in ADR-0011. Seed `preference_branch` from
  `CANONICAL_BRANCHES` rather than re-listing slug literals in the
  migration.
- Hint: `moveLeaves` signature and JSONB-rewrite implementation
  pattern are in ADR-0011 § Decision. The utility is unused in
  this sub-feature itself (the wipe deletes flat fields, not
  leaves) but lands here so future composition-change migrations
  can call it without further infrastructure work.

---

### Chunk conversation-runtime — Replace step engine with tree-mutating LLM agent

```yaml
id: conversation-runtime
depends_on: [wipe-and-foundation]
labels:
  - feature:profile-driven-architecture
  - type:feat
  - scope:sub-feature-seed
```

**Goal.** Make the Chat surface usable: the user types compound
preferences, the agent decomposes claims, routes them to canonical
branches (or `Other`), asks agent-initiated clarifications with
best-guess phrasing, and commits with verbatim user text. Anchors
G1, G2, G5; closes ADR-0005.

**Files (sub-feature surface).**

- `apps/web/src/lib/profile-conversation/` — replace stub from
  wipe-and-foundation with full runtime: `process-turn.ts`,
  `prompt-builder.ts`, `turn-output-schema.ts`, `branch-router.ts`,
  conversation-state V2 helpers, decisive concurrency handling.
- `apps/web/src/app/api/chatbot/{turn,messages,reset,save}/route.ts`
  — replace 501 stubs with full handlers (turn endpoint, message
  history, reset, no-op save returning 410 Gone since there is no
  finalize state).
- `apps/web/src/lib/db/schema.ts` (or `packages/db/src/schema.ts`)
  — add `conversation_state.state` V2 type usage (no column
  rename; JSONB shape change only).
- `app_config` row(s) for clarification budget if revisited from
  default.
- New tests: prompt-builder, turn-output schema, branch-router
  (canonical vs Other), uncertainty-marker on budget exhaust.

**Acceptance criteria.**

- [ ] Sub-feature planning PR merged to `main`.
- [ ] Implementation PR(s) merged; HEAD typecheck / lint / test
  green.
- [ ] User can type a compound message and see leaves committed to
  `user_profile.preference_tree` with verbatim claim text and
  `direction` set, validated by SELECT.
- [ ] Ambiguous claims trigger an `assistant` turn whose content
  contains a clarification question; on user reply the leaf
  commits to a branch.
- [ ] After two clarifications on the same claim, the leaf
  commits with `flaggedUncertain: true`.
- [ ] A claim that fits no canonical branch lands in `other` with
  an explicit acknowledgement assistant turn — verified by SELECT
  + transcript inspection.
- [ ] No `Onboarding` / `Interview` / job-interview-adjacent
  string in any prompt or assistant copy (content-lint test).
- [ ] Optimistic-concurrency replay works under simulated
  concurrent turns (test).

**Test strategy.** Unit tests for prompt-builder, branch-router,
turn-output validation. Integration test that mocks Anthropic and
exercises the full process-turn path. Manual: full conversation
session + transcript inspection per PRD §4 leading metrics.

**Effort.** 2–4 days (full `/feature` cycle; conversation runtime
is the heaviest single sub-feature).

**Risks.**

- Prompt drift / clarification-rate over kill threshold (>30% per
  PRD §4) — mitigation: log clarification rate; iterate prompt
  before /feature exits.
- Hallucinated `branchSlug` not in the registry — mitigation:
  server-side validation rejects + retries one turn with the slug
  list re-injected.

**Hints.**

- Hint: `TurnOutputSchema` and `ConversationStateV2` in design §8.
- Hint: model = Claude Haiku 4.5 (parity with L3 worker).
- Hint: forbidden-label content-lint pattern in design §17.

---

### Chunk profile-map-ui — Render the tree as the Profile Map view

```yaml
id: profile-map-ui
depends_on: [wipe-and-foundation]
labels:
  - feature:profile-driven-architecture
  - type:feat
  - scope:sub-feature-seed
```

**Goal.** Add the second UI view (Profile + Profile Map) and the
UI-control toggle between Chat and Profile. Tree visualised at
the configured max depth (default 3); leaves labeled with verbatim
user phrasing; direction-differentiated; uncertainty-flagged
distinct; `Other` distinct. View-only (edits go via Chat).
Anchors G4; narrows but does not finalise design §9 (D6).

**Files (sub-feature surface).**

- `apps/web/src/app/profile/` — new route group (Profile view).
- `apps/web/src/components/profile-map/` — Profile Map renderer
  + adapters for tree layout, location-tier projection (read-only
  per PRD §11.3 + design §4).
- `apps/web/src/components/chat-profile-toggle.tsx` — UI toggle
  (tab / button — sub-feature decides shape).
- `apps/web/src/lib/profile-tree/` — reuse (read-only consumer).
- Renderer dependency added to `package.json` (markmap-lib or
  react-flow per sub-feature pick — design §9 narrows to those two
  with react-flow recommended).
- Empty-tree UX (design §16, D13 deferred — sub-feature decides).

**Acceptance criteria.**

- [ ] Sub-feature planning PR merged.
- [ ] Implementation PR(s) merged; HEAD typecheck / lint / test
  green.
- [ ] Profile route exists; visiting it renders the user's tree
  at depth `app_config.ui.profile_map_max_depth`.
- [ ] Each leaf renders the user's verbatim claim; direction is
  visually differentiated (include vs exclude); uncertainty-flagged
  leaves are distinguishable; `other` branch is distinguishable.
- [ ] UI control switches between Chat and Profile without an LLM
  in the loop (verified by network-tab inspection / unit test).
- [ ] No inline-edit affordance on the map (no clickable
  edit-in-place control) — manual UI smoke + a snapshot test
  asserting absence.
- [ ] No forbidden labels in copy (content-lint).

**Test strategy.** Component tests (Vitest + React Testing Library)
for Profile-Map renderer and toggle. Visual snapshot for
direction differentiation. Manual: full UI smoke in the dev server
including empty / partial / fully populated trees.

**Effort.** 2–3 days (UI sub-feature; renderer choice + layout).

**Risks.**

- Renderer choice locks layout flexibility — mitigation: design §9
  narrows to two; sub-feature prototypes both before pick if
  uncertain.
- Bundle size — mitigation: dynamic-import the renderer route.

**Hints.**

- Hint: react-flow recommended in design §9 for per-node React
  control.
- Hint: location-tier adapter is read-only per PRD §11.3.
- Hint: empty-tree state is open (design §16, D13).

---

### Chunk l3-widening — Widen L3 schema with per-claim scores + verified evidence

```yaml
id: l3-widening
depends_on: [wipe-and-foundation]
labels:
  - feature:profile-driven-architecture
  - type:feat
  - scope:sub-feature-seed
  - priority:critical-path
```

**Goal.** Extend the existing per-job consolidated L3 worker to
emit a `claims` array alongside RSLCD, each entry carrying
`{leafId, score, evidencePhrase, mentioned}`. Substring-verify
every non-null `evidencePhrase` against the source description
text. Persist on `job_match.claim_scores`. Cap enforcement from
`app_config`. Anchors G3, G6, G7; closes ADR-0006, ADR-0007.

**Files (sub-feature surface).**

- `apps/worker/src/lib/scoring-schema.ts` — modify (extend with
  `ClaimScoreSchema[]`; preserve RSLCD).
- `apps/worker/src/lib/scoring-prompt.ts` — modify (claim list,
  randomised order, mentioned-then-score-then-evidence ordering;
  per-call claim chunk size from `app_config`).
- `apps/worker/src/handlers/llm-scoring.ts` — modify (read tree,
  compute claims-to-score input set, persist `claim_scores`,
  invoke verifier; chunk into ≤N per call when applicable).
- `apps/worker/src/lib/verify-evidence-phrase.ts` — create
  (case-insensitive, whitespace-normalised substring check;
  shared utility per design §6).
- `apps/web/src/app/api/scoring/trigger/route.ts` — modify (pass
  cap from `app_config.scoring.l3_candidate_cap`; slice candidate
  list at cap before enqueue; no background continuation).
- `apps/worker/src/lib/compute-match-percent.ts` — possibly modify
  (RSLCD untouched but per-claim feed-through deferred — sub-feature
  decides whether to include in initial scope).
- New tests: schema validation, verifier (positive + negative),
  cap enforcement at the trigger endpoint, prompt construction
  with chunked claims, end-to-end scoring against fixtures.

**Acceptance criteria.**

- [ ] Sub-feature planning PR merged.
- [ ] Implementation PR(s) merged; HEAD typecheck / lint / test
  green.
- [ ] After search trigger on a profile with ≥1 soft claim, every
  scored `job_match` row has `claim_scores` populated; every
  non-null `evidencePhrase` is provably substring-present in the
  job's `description_text` (test asserts).
- [ ] Verifier rejects fabricated `evidencePhrase` in a unit test;
  worker either retries once or nulls the phrase per documented
  behaviour.
- [ ] Trigger endpoint caps enqueue at
  `app_config.scoring.l3_candidate_cap` (verified by log + queue
  count).
- [ ] No silent background continuation past the cap — observable
  from worker logs and queue depth.
- [ ] Existing RSLCD scores and `matchPercent` unchanged for
  identical inputs (regression test against fixture).

**Test strategy.** Unit tests for the verifier (golden-path +
adversarial fakes). Worker integration test using a real
description fixture and a mocked Anthropic response. Cap test on
the trigger route. Manual: run trigger on the test user post-tree-
populated and inspect `claim_scores` in DB.

**Effort.** 2–3 days.

**Risks.**

- Long-list laziness for users with many active claims —
  mitigation: chunked claims per call (design §6); audit subset on
  per-claim retry pass (fast-follow).
- Verifier false-negatives (whitespace / unicode quirks) —
  mitigation: normalisation function tested against representative
  description text variants.
- L3 cost regression if claim count grows — mitigation: log
  `tokens_in / tokens_out / claims_per_call` per scoring run.

**Hints.**

- Hint: `mentioned: false`, `score: 5`, `evidencePhrase: null`
  for L3 silence (design §6, D14).
- Hint: prompt mitigations enumerated in design §6.
- Hint: `claim_scores` JSONB column already added by
  wipe-and-foundation; this sub-feature only writes / reads.

---

### Chunk results-affordances — Three results-page affordances + transient L2 overlay

```yaml
id: results-affordances
depends_on: [l3-widening]
labels:
  - feature:profile-driven-architecture
  - type:feat
  - scope:sub-feature-seed
```

**Goal.** Land the bottom-of-results UI surface: "Score more"
extends the scored batch repeatably; "Change profile preferences"
returns the user to Profile + Chat; "Change filters" opens a
transient L2-filter overlay scoped to the current search only,
disjoint from the profile tree. Anchors G7, G8; closes ADR-0008.

**Files (sub-feature surface).**

- `apps/web/src/app/search/` — modify results-page surface; add
  the three affordances at the scored-batch boundary.
- `apps/web/src/components/results-affordances/` — create
  (Score-more button, Change-profile link, Change-filters drawer).
- `apps/web/src/lib/search/filter-pipeline.ts` — modify
  (`searchJobs` accepts optional `overlay` arg; overlay overrides
  profile-derived L2 inputs at request scope only).
- `apps/web/src/app/api/scoring/trigger/route.ts` — modify
  (forward overlay arg; respect `extend_batch_size` for "Score
  more" subsequent invocations).
- URL query-string param locking (`rf`, `sn`, `loc`, `ind`, `rmt`)
  per design §10 (D7).
- New tests: overlay storage (no DB writes), affordance rendering,
  score-more pagination semantics.

**Acceptance criteria.**

- [ ] Sub-feature planning PR merged.
- [ ] Implementation PR(s) merged; HEAD typecheck / lint / test
  green.
- [ ] Bottom of scored-batch shows three affordances with the
  locked labels (per PRD §11.4 hint).
- [ ] "Score more" enqueues an additional batch of size
  `app_config.scoring.extend_batch_size`; the new candidates
  append to the rendered list.
- [ ] "Change profile preferences" navigates to the Profile +
  Chat surface.
- [ ] "Change filters" opens a panel exposing the locked overlay
  param set; submitting updates the URL query string and re-runs
  the search; the overlay is reflected in returned candidates.
- [ ] Overlay use does not write to `user_profile.preference_tree`,
  `conversation_message`, or `conversation_state` (asserted by a
  test that snapshots persistent state pre/post overlay use).
- [ ] Leaving the page or clearing query-string drops the overlay
  (manual smoke + unit test).
- [ ] No overlay-derived data persisted in cookies, server
  session, or DB (overlay storage test).

**Test strategy.** Component tests for affordance rendering and
the filter drawer. Integration test for the overlay → search round
trip. Persistent-state snapshot tests (no writes from overlay
path). Manual: full results-page UX cycle.

**Effort.** 1–2 days.

**Risks.**

- Overlay leaking into persistent state via a future code change
  — mitigation: dedicated test asserting persistent-state delta
  is zero across overlay use; ADR-0008 §Consequences.
- Three affordances UX over-complicates results — mitigation:
  affordances live below the fold of the scored batch, never in a
  modal.

**Hints.**

- Hint: query-string params locked in design §10; URL-shareable
  by design.
- Hint: `searchJobs` overlay arg seam in design §10 (D7) and §11
  (D8 — but the seam is only used by this sub-feature).

---

### Chunk location-alignment — Optional fast-follow: align location-tier shape with leaf shape

```yaml
id: location-alignment
depends_on: [profile-map-ui]
labels:
  - feature:profile-driven-architecture
  - type:refactor
  - scope:sub-feature-seed
  - priority:fast-follow
```

**Goal.** If the location tier structure ends up structurally
inconsistent with the leaf shape (different leaf shape, different
direction handling, different Profile-Map rendering), reshape the
location subsystem so both branches feel uniform in the Profile
Map. PRD §7.2 + §11.3 require this if divergence is structural;
the seam is identified as a fast-follow leaf in design §18.

**Files (sub-feature surface).**

- `packages/ats-core/src/geo/*` — possibly modify (tier shape
  alignment with leaf shape).
- `apps/web/src/lib/profile-tree/derive-l2.ts` — modify (treat
  Location as a tree branch instead of a separate JSONB).
- `apps/web/src/components/profile-map/` — simplify (drop
  read-only adapter for location tiers).
- Drizzle migration if persistence changes shape.

**Acceptance criteria.**

- [ ] Decision documented: align (proceed) vs leave divergent
  (close as won't-fix with rationale in §10 of the PRD).
- [ ] If aligned: sub-feature planning PR merged; implementation
  PR(s) merged; HEAD green; Profile-Map renders Location with the
  same leaf shape as other branches; no read-only adapter
  remaining.

**Test strategy.** Snapshot tests on Profile-Map rendering for
Location vs other branches. Integration test for L2 location
filter post-alignment.

**Effort.** 1–2 days when undertaken (optional).

**Risks.**

- Touching a working subsystem (`packages/ats-core/src/geo/*`) for
  cosmetic alignment can regress search quality — mitigation:
  retain manual top-N benchmark from PRD §4 as gate.

**Hints.**

- Hint: only undertake if `profile-map-ui` sub-feature surfaces
  the divergence as user-facing inconsistency. Otherwise close
  with rationale.

---

## 6. Cross-cutting risks

- **Sub-feature scope creep across cycles** — touches all chunks.
  Mitigation: each sub-feature's `/prd` re-locks scope before
  implementation; this umbrella PRD §11.2 is the parent contract
  every child PRD inherits.
- **Tree write conflicts.** Two browser tabs commit concurrently
  → last-write-wins overwrites. Touches `conversation-runtime`.
  Mitigation: optimistic-concurrency replay via
  `user_profile.updatedAt` (design §17).
- **Hallucinated L3 evidence.** Locked invariant (PRD §11.3,
  design §6). Touches `l3-widening`. Mitigation: shared
  substring-verifier; rejection or retry; hallucination rate is a
  kill-switch signal (PRD §4 + §9.1).
- **Forbidden-label leakage in UI copy.** Touches
  `conversation-runtime`, `profile-map-ui`,
  `results-affordances`. Mitigation: shared content-lint test
  per design §17 — every UI sub-feature includes it.
- **Branch-slug drift.** Touches `wipe-and-foundation`,
  `conversation-runtime`. Mitigation: soft-delete on branches;
  server-side validation; periodic audit. ADR-0009 §Consequences.
- **End-to-end validation requires multiple sub-features
  populated.** PRD §4 manual top-N benchmark cannot fire until
  `wipe-and-foundation` + `conversation-runtime` + `l3-widening`
  have all merged. Mitigation: sequence the validation pass after
  the third sub-feature merges; do not block individual sub-feature
  acceptance on end-to-end metric.
- **Location alignment may stay divergent indefinitely.** If
  `location-alignment` is closed without action, the Profile Map
  has a permanent inconsistency. Mitigation: explicit decision
  (align or close) at the end of `profile-map-ui`; do not let it
  drift undecided.
- **Branch composition change cost (post-MVP).** Adding,
  removing, moving, or merging canonical branches as the product
  evolves spans the TS constant + a `moveLeaves` Drizzle migration
  + matcher logic + PRD update. Touches all chunks transitively
  via shared canonical semantics. Mitigation: centralisation in
  `wipe-and-foundation` (D15 / ADR-0011) localises the change to
  a documented playbook (~30 min – 5 h per operation depending on
  type) instead of scattered refactors. Acceptable given memory
  ("schema/API can be broken freely") and the user's explicit
  expectation that the canonical set will evolve.

---

## 7. Validation strategy

End-to-end "the overhaul is shipped" is the manual cycle in PRD
§4, run after all critical-path chunks have merged.

1. Wipe local DB; sign in as the test user; visit Chat and have a
   compound-statement conversation populating the tree across
   multiple branches.
2. Inspect `user_profile.preference_tree` JSONB and the
   transcript: every user statement is represented as a leaf with
   verbatim phrasing; direction set; ambiguous statements show a
   clarification turn before commit; non-canonical claims land in
   `other`.
3. Switch to the Profile view; confirm the Profile Map renders the
   tree at depth ≈ 3; direction-differentiated leaves;
   uncertainty-flagged leaves distinct; `other` branch distinct.
4. Run a search; observe the L1/L2 funnel narrows by tree-derived
   inputs (target titles, seniority, canonical industry tokens,
   remote, location); L3 scores up to
   `app_config.scoring.l3_candidate_cap` jobs; each scored job has
   `claim_scores` populated with substring-verifiable evidence
   phrases.
5. At the bottom of the scored batch, exercise each affordance:
   "Score more" extends; "Change profile preferences" returns to
   Profile + Chat; "Change filters" applies a transient overlay,
   observable in URL, not persisted to the tree on page exit.
6. Hand-pick relevant jobs from direct `job` table SQL browsing;
   compare with the system top-20; record overlap.

**Definition of done:** the test user runs the full cycle on
their own profile, PRD §4 leading targets fire (100% verbatim
preservation, 0 unmatchable values, ambiguous-clarification on
all ambiguous turns, 0 L3 over-cap incidents, 100% substring-
verified evidence on contributing soft claims), and the lagging
top-N benchmark overlap is ≥ 80%. Kill criteria (PRD §4) are
checked; if any fires, decompose root cause and reopen the
relevant sub-feature(s).

---

## 8. Open questions

Most PRD §10 items are resolved by the design's 14 decisions or
deferred to specific sub-feature designs. The remainder, deferred
to implementation time:

- [ ] L3 cap default value calibration — to be tuned against
  observed BYOK token spend after the first manual end-to-end
  cycle. Decided by `l3-widening` sub-feature post-MVP.
- [ ] Profile-Map renderer final pick (markmap-lib vs react-flow)
  — to be decided by `profile-map-ui` sub-feature after a
  prototype.
- [ ] Empty-tree Profile-Map UX (illustration / redirect to Chat
  / placeholder branch outline) — decided by `profile-map-ui`
  sub-feature.
- [ ] Per-branch synonym dimension assignments — which
  `synonym_group` dimensions feed which canonical-token
  expansions for which branches. Decided by `conversation-runtime`
  sub-feature when populating leaf `canonical[]` at commit.
- [ ] RSLCD vs per-branch / per-claim weight rebalancing —
  deferred to a fast-follow cycle after the first manual top-N
  benchmark establishes whether RSLCD-with-derivation suffices.
- [ ] Whether to undertake `location-alignment` at all — decided
  at end of `profile-map-ui` based on observed divergence.
