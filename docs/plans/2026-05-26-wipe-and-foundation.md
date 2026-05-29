# Wipe legacy preference substrate & scaffold preference-tree foundation — Implementation plan

Status: **Draft v1** | Date: 2026-05-29 | Owner: vasd85
PRD: `docs/product/2026-05-26-wipe-and-foundation.md` | Design: `docs/designs/2026-05-26-wipe-and-foundation.md`

> **Reader:** this plan is written for downstream agents (`/tasks`,
> `/implement-task`) — not a human reviewer. The DAG of chunks in §5
> is **machine-parseable**: each chunk has a YAML metadata block with
> `id`, `depends_on`, and `labels`. `/tasks` greps these to create
> Plane Epic + Work Items + `blocked_by` relations. Sections are
> fixed in name and order; index by section number when needed.
> Decisions are declarative. Each chunk is one logical change → one
> Work Item → one PR.

---

## 0. Context

This sub-feature cuts the codebase from the half-old / half-imagined
preference substrate (flat-column profile + chatbot module + a legacy
`user_company_preference` table; no `preferenceTree`, no
`preference_branch`, no `CANONICAL_BRANCHES`) to a clean tree-shaped
substrate, so the three downstream sub-features (`conversation-runtime`,
`profile-map-ui`, `l3-widening`) start from a substrate that already
exists in clean form (PRD §1). The approach is an atomic, snapshot-
reversible cutover (PRD §6.1): one transactional Drizzle migration drops
the legacy surface and creates the new substrate, with all TypeScript
consumers rewired in lockstep so HEAD stays green.

The architecture is already locked upstream (ADR-0009 JSONB tree,
ADR-0010 wipe-no-coexistence, ADR-0011 TS-canonical branch registry,
ADR-0007 `claim_scores` JSONB). This plan only **sequences** the
design's concretised decisions into atomic, individually-green chunks;
it does not re-decide them. Code-level specifics (Zod field names,
function signatures, JSONB shapes, migration step order) are pinned by
the design and referenced here, not restated.

- **PRD:** `docs/product/2026-05-26-wipe-and-foundation.md` (key
  sections: §3 goals/non-goals, §6 proposed solution, §11.2 locked
  decisions, §11.3 invariants, §11.5 research-verified facts).
- **Design:** `docs/designs/2026-05-26-wipe-and-foundation.md` —
  **Format A (Feature Plan)**. This plan grounds itself in design
  §Affected Files, §1 (`CANONICAL_BRANCHES`), §2 (leaf schema), §4
  (`preference_branch`), §6 (function signatures), §7 (migration
  ordering), §8 (seeder), §9 (501 stubs), §10 (internet-expansion
  no-op), §11 (`buildScoringPrompt`), §12 (unit-test plan), and §Risks.
- **ADRs (cited by the design, read in full):**
  `docs/adr/0007-per-claim-scores-on-job-match.md`,
  `docs/adr/0009-tree-persistence.md`,
  `docs/adr/0010-wipe-and-foundation.md`,
  `docs/adr/0011-canonical-branch-coupling.md`. (PRD §0 cites these
  under a `docs/adrs/` path with different filenames — a citation
  typo; the real files live under `docs/adr/`.)

**PR-boundary decision (PRD §10 / §11.1 delegated this to `/plan`).**
The operator chose **decomposition into 3 chunks / up to 3 PRs**
(within PRD §10's "2-4 small PRs"), overriding design §13's *single-PR
recommendation*. Rationale: the destructive core is genuinely
irreducible (the one locked transactional migration drops columns that
`filter-pipeline` + the L3 worker read, and feature flags are banned —
so schema-drop + consumer-rewire must land together), but two pieces
are **not** coupled to the schema drop and land first as independent,
individually-green PRs: the pure `profile-tree` module and the chatbot
wipe. This de-risks the destructive migration (the pure module is
proven and the dead code is gone before the cutover) and shrinks the
cutover diff. The locked one-transactional-migration constraint (C1)
and HEAD-green gate (C13) are unaffected by PR count.

---

## 1. Goals

Mapped 1:1 to PRD §3.1.

- **G1 — One transactional migration drops the legacy surface (5
  columns, `user_company_preference`, 2 conversation tables) and
  creates the new substrate (`preferenceTree` JSONB, `preference_branch`
  table, `claimScores` JSONB, 5 new `app_config` rows)** → delivered by
  `substrate-cutover`.
- **G2 — `CANONICAL_BRANCHES` is the single source of truth;
  `preference_branch` is seeded from it; every hard-coupled call site
  iterates the constant rather than hardcoding slug literals** →
  delivered by `profile-tree-module` (defines the constant; derivers
  iterate it) and `substrate-cutover` (seeds `preference_branch` from
  it; wires call sites).
- **G3 — `filter-pipeline.ts` and the L3 prompt-input layer read from
  the tree via `deriveL2Inputs` / `summariseTreeForL3`; no widening of
  `ScoringOutputSchema`** → delivered by `profile-tree-module` (the two
  helpers) and `substrate-cutover` (the rewire + the unchanged-schema
  guarantee).
- **G4 — HEAD is typecheck/lint/test green at the end of the cutover;
  grep returns zero matches for legacy names outside the migration,
  tests, and fixtures (ADR-0010 acceptance gate)** → delivered jointly
  by `chatbot-wipe` (clears the `chatbot/*` matches) and
  `substrate-cutover` (clears the column/table matches and is the last
  chunk where the full gate is verifiable).

---

## 2. Non-goals

Restated from PRD §3.2, plus plan-specific exclusions.

- **NG1 — No conversational LLM runtime.** Chatbot routes return 501
  (PRD §3.2 NG1).
- **NG2 — No Profile Map renderer.** `/onboarding` is deleted /
  intentionally broken (PRD §3.2 NG2).
- **NG3 — No widening of `ScoringOutputSchema`.** `claim_scores` column
  is added but stays NULL with no write path (PRD §3.2 NG3).
- **NG4 — No tree-driven rewrite of `internet-expansion.ts`.** Warn-
  logged no-op only (PRD §3.2 NG4).
- **NG5 — No rebalancing of `weight_*` RSLCD weights** (PRD §3.2 NG5).
- **NG6 — No changes to the location-preference tier shape** (PRD §3.2
  NG6).
- **NG7 — No data migration of existing flat-column values into seeded
  leaves.** Existing rows get an empty tree (PRD §3.2 NG7).
- **NG8 — No `make snapshot-pre-wipe` script (plan-specific).** Reason:
  design §Risks decided `pg_dump` stays a documented operator-manual
  README step; no Makefile exists in the repo and one snapshot does not
  justify a new pattern.
- **NG9 — No JSONB GIN index on `preference_tree` (plan-specific).**
  Reason: premature for a solo product (one row); design §Risks defers
  it to a fast-follow only if contention ever appears.

---

## 3. Constraints

Hard constraints the plan and downstream agents must respect.

- **C1 — One transactional migration.** A single Drizzle migration
  (`0010_wipe_and_foundation.sql`) drops the legacy surface and creates
  the new substrate; partial state is never committed. Source: PRD
  §11.2, ADR-0010 §Decision.
- **C2 — `CANONICAL_BRANCHES` is the single source of truth.**
  `preference_branch` rows are derived from it (not hand-written SQL or
  duplicated); all hard-coupled call sites iterate it. Source: PRD
  §11.2, ADR-0011 §Decision.
- **C3 — `job_match` is wiped in the same migration**
  (`DELETE FROM job_match`) so cached RSLCD scores don't reference the
  obsolete flat profile shape. Source: PRD §11.2, design §7 step 11.
- **C4 — Chatbot UI components + `/onboarding/page.tsx` are deleted with
  the lib; the three documented routes survive as 501 stubs.** Exact
  body `{"error":"chatbot endpoints retired"}`, HTTP 501, `GET` and
  `POST` exports, no auth/log/shared-helper. Source: PRD §11.2, design
  §9.
- **C5 — `internet-expansion.ts` becomes a warn-logged no-op** with the
  exact message `"internet-expansion disabled pending tree-driven
  rewrite"`, one log per batch item, queue subscription stays mounted,
  no DB read. Source: PRD §11.2, design §10.
- **C6 — `buildScoringPrompt` swaps the 5 deleted flat fields for a
  single `treeSummary: string`** produced by `summariseTreeForL3`,
  called from the handler (not the prompt builder); the L3 system-prompt
  body is **not** rewritten (section labels preserved). Source: PRD
  §11.2, design §11.
- **C7 — `ScoringOutputSchema` is untouched and `claim_scores` stays
  NULL** (column added, no write path). Source: PRD §11.2, ADR-0010.
- **C8 — The 5 `app_config` keys land via the existing TS seeder, not
  via SQL `INSERT`.** Exact keys: `scoring.l3_candidate_cap`,
  `scoring.extend_batch_size`, `ui.profile_map_max_depth`,
  `chatbot.clarification_budget`, `scoring.l3_claims_per_call`. Source:
  PRD §11.2, design §8.
- **C9 — No data migration of flat-column values into leaves**; existing
  rows get the default empty tree. Source: PRD §11.2.
- **C10 — `preference_branch` row count after seed equals
  `ALL_CANONICAL_BRANCHES.length` = 19** (9 top-level + 3 `skills/*` + 7
  `company-attributes/*`). Source: PRD §4 metric, design §1.
- **C11 — Invariants preserved:** `apps/web/src/lib/db/schema.ts` stays
  a one-line wildcard re-export of `@gjs/db/schema`; snake_case columns /
  camelCase TS fields; `updatedAt` not auto-managed by Drizzle;
  `resolve-user-location.ts` keeps its locally-defined
  `LocationPreferenceTierInput` (comment-only fix); the retained
  `user_profile` columns (`targetTitles`, `targetSeniority`,
  `yearsExperience`, `locationPreferences`, `preferredLocations`,
  `remotePreference`, `minSalary`, `targetSalary`, `salaryCurrency`,
  `weight_*`) are untouched; RSLCD scoring math
  (`compute-match-percent.ts`) and synonym expansion (`expandTerms`)
  unchanged; `onConflictDoNothing()` preserves operator-edited
  `app_config` / `preference_branch` values across re-seeds; migration
  numbering is sequential append-only (`0010`). Source: PRD §11.3.
- **C12 — No feature flags, no coexistence layer.** Old code is removed
  in the same PR that replaces it. Source: ADR-0010 §Context/§Decision,
  PRD §8 Alt B/C, `CLAUDE.md`.
- **C13 — HEAD-green gate.** Hooks enforce `pnpm typecheck` + `pnpm lint`
  before each commit and `pnpm test` before PR creation. Every chunk's
  PR must pass all three (the root `vitest.config.ts` runs web + worker
  + ats-core + ingestion + scripts projects). Source: `CLAUDE.md`,
  verified root `vitest.config.ts`.

---

## 4. Dependency DAG

The two roots are genuinely independent (no shared files, no shared
deps) and parallelisable; both are prerequisites of the single
irreducible cutover.

**Critical path:** `profile-tree-module` → `substrate-cutover` (the
cutover imports `deriveL2Inputs` / `summariseTreeForL3` /
`PreferenceTreeSchema` / `ALL_CANONICAL_BRANCHES`, so it cannot
typecheck until the module is merged). `chatbot-wipe` →
`substrate-cutover` is an equal-length second branch.

**Parallelisable:** `profile-tree-module` and `chatbot-wipe` — no shared
files, no shared deps. Run concurrently.

**Diamond:** `profile-tree-module` and `chatbot-wipe` both unblock
`substrate-cutover` (a 2-branch converge).

**Isolated leaves:** none. The ats-core stale-comment fix is folded into
`chatbot-wipe` (it references the chatbot module being deleted, so the
two are semantically one change and a standalone PR for a one-line
comment is not worth a Work Item). `substrate-cutover` is the terminal
node; it blocks nothing *inside this plan* — the downstream sub-features
(`conversation-runtime`, `profile-map-ui`, `l3-widening`) are separate
features sequenced by the umbrella plan.

```
profile-tree-module ─┐
                     ├──→ substrate-cutover
chatbot-wipe ────────┘
```

---

## 5. Chunks

### Chunk profile-tree-module — Build the pure `profile-tree` module + `CANONICAL_BRANCHES`

```yaml
id: profile-tree-module
depends_on: []
labels:
  - feature:2026-05-26-wipe-and-foundation
  - type:feat
  - priority:high
  - risk:low
```

**Goal.** Deliver the additive, fully-unit-tested pure module that is
the substrate's backbone — `CANONICAL_BRANCHES` (the single source of
truth, G2), the leaf/tree Zod schemas, and the pure functions
(`mutateLeaf`, `moveLeaves`, `deriveL2Inputs`, `summariseTreeForL3`) the
cutover wires in (G3). Nothing imports it yet, so it lands green on its
own and proves the pure logic before the destructive migration depends
on it.

**Files.** All file contents (Zod field names, function signatures,
`CANONICAL_BRANCHES` rows) are **locked by design §1, §2, §3, §6, §12**
— implement to those specs, do not re-decide. Nominal location is the
design's `apps/web/src/lib/profile-tree/`; **but see Risk R1 and Open
Question OQ1** — because the worker (in `substrate-cutover`) must import
`ALL_CANONICAL_BRANCHES` / `summariseTreeForL3` / `PreferenceTreeSchema`
and the repo has no apps→apps import precedent, the **whole module** (or
at minimum the worker-imported subset) may need to live in a shared
`@gjs/*` package instead; OQ1 weighs whole-module relocation as the
cleaner shape (single-rooted `index.ts`). Resolve the module home
**before** placing files (it sets paths for this chunk and the cutover).

- `apps/web/src/lib/profile-tree/canonical-branches.ts` — create
  (`CANONICAL_BRANCHES`, `SKILLS_SUB_BRANCHES`,
  `COMPANY_ATTRIBUTE_SUB_BRANCHES`, `ALL_CANONICAL_BRANCHES`,
  `CanonicalBranchDef`/`CanonicalBranchKind`/`L2DerivationKind` types) —
  *may relocate to a `@gjs/*` package per OQ1*
- `apps/web/src/lib/profile-tree/leaf-schema.ts` — create (`LeafSchema`
  + `superRefine`, `PreferenceTreeSchema`, enums, inferred types) —
  *may relocate per OQ1*
- `apps/web/src/lib/profile-tree/mutate-leaf.ts` — create
- `apps/web/src/lib/profile-tree/move-leaves.ts` — create (pure tree
  transform; `MovePredicate`/`MoveTarget`)
- `apps/web/src/lib/profile-tree/derive-l2.ts` — create (`deriveL2Inputs`
  → narrow `{ industries }` surface per design §6.3)
- `apps/web/src/lib/profile-tree/summarise-l3.ts` — create
  (`summariseTreeForL3` → exact 5-section format / empty-tree string per
  design §6.4) — *may relocate per OQ1*
- `apps/web/src/lib/profile-tree/migrate-leaves.ts` — create
  (`migrateLeaves(db, opts)` DB wrapper, `dryRun` shipped, raw SQL so it
  typechecks before the column exists; not exercised this PR)
- `apps/web/src/lib/profile-tree/index.ts` — create (re-export public
  surface)
- `apps/web/src/lib/profile-tree/*.test.ts` — create (6 files covering
  the 10 fixtures per design §12)

**Acceptance criteria.**

- [ ] `pnpm test` exits 0 with the new `profile-tree` `*.test.ts` files
  present, covering at least the 10 fixtures enumerated in design §12 /
  PRD §11.5 (empty tree; single-leaf; multi-leaf single-branch; multi-
  branch; deep `branchPath`; `skillIntent` leaf; invalid leaf missing
  `branchSlug` asserts a `safeParse` failure; `moveLeaves` golden path;
  merge path with per-leaf mutator; `mutateLeaf` idempotency).
- [ ] A `canonical-branches` test asserts `ALL_CANONICAL_BRANCHES.length
  === 19`, every slug is unique, container slugs (`skills`,
  `company-attributes`) are marked `isContainer: true`, and every
  `l3Section` value is one of the five locked labels.
- [ ] `summariseTreeForL3(emptyTree)` returns exactly
  `"No preferences set yet."` (no trailing newline); a populated fixture
  returns the exact five-line block in the design §6.4 order.
- [ ] `deriveL2Inputs` returns `{ industries: [] }` for an empty/`null`
  tree and includes only `include`-polarity industry leaves' tokens
  otherwise.
- [ ] Tests that assert JSONB/tree equality use deep-equality or `@>`
  containment, never key-order-sensitive `=` (PRD §11.4 hint).
- [ ] `pnpm typecheck` and `pnpm lint` exit 0.

**Test strategy.** Vitest unit tests next to source (the
`src/**/*.{test,spec}.{ts,tsx}` glob). Each pure function is tested
against fixtures; `LeafSchema.superRefine` is tested for each of its 5
rejection paths. `migrate-leaves.ts` ships **without** a DB test (not
exercised this PR; the first composition-change PR adds the integration
test). Runs in the `apps/web` vitest project (or the new package's
project if relocated per OQ1).

**Effort.** 4–6 h.

**Risks.**

- Module home / cross-package import (R1, §6) — resolve before placing
  files; mitigation: decide OQ1 at chunk kickoff.
- `crypto.randomUUID()` vs UUID v7 for leaf `id` (OQ2, §8) —
  mitigation: grep for an existing v7 helper; default to
  `crypto.randomUUID()`.

**Hints (optional).**

- Design §2: lock leaf field names `id` / `claimText` / `polarity` /
  `provenance: { turnId }` (PRD-precedence over the umbrella §4 sketch).
- Design §6.2/§6.5: `moveLeaves` is the **pure** tree transform;
  `FOR UPDATE SKIP LOCKED` + batching live only in `migrateLeaves`.
- Design §Risks: add a header comment to `canonical-branches.ts`
  declaring the TS-only behaviour-hook fields (`kind`, `l3Section`,
  `l3Soft`, `l2Derivation`, `matcherScope`, `acceptsSkillIntent`,
  `synonymDimension`, `maxPathDepth`, `isContainer`) do **not**
  round-trip to `preference_branch`.

### Chunk chatbot-wipe — Delete the chatbot module/UI/onboarding, stub the 3 routes to 501, fix the stale ats-core comment

```yaml
id: chatbot-wipe
depends_on: []
labels:
  - feature:2026-05-26-wipe-and-foundation
  - type:chore
  - priority:medium
  - risk:low
```

**Goal.** Remove the only writer of the legacy preference columns and
the chatbot surface, so the `substrate-cutover` migration can drop those
columns without a coexisting reader/writer breaking typecheck (G4).
Independent of the schema drop — the columns still exist after this
chunk, so every other reader stays green; this lands as its own green PR
and peels ~3000 deletion lines off the cutover diff.

**Files.** Deletion/stub shapes locked by PRD §11.2 + design §9. No
overlap with `substrate-cutover`'s files (the logical dependency is one-
directional and stated in §4).

- `apps/web/src/lib/chatbot/` (entire dir) — delete
- `apps/web/src/lib/llm/preference-llm.ts` — delete
- `apps/web/src/lib/llm/prompts.ts` — delete
- `apps/web/src/lib/llm/preference-llm.test.ts` — delete
- `apps/web/src/lib/llm/prompts.test.ts` — delete
- `apps/web/src/components/chatbot/` (entire dir) — delete
- `apps/web/src/app/onboarding/page.tsx` — delete
- `apps/web/src/app/api/chatbot/message/route.ts` — rewrite → 501 stub
- `apps/web/src/app/api/chatbot/state/route.ts` — rewrite → 501 stub
- `apps/web/src/app/api/chatbot/save/route.ts` — rewrite → 501 stub
- `packages/ats-core/src/geo/resolve-user-location.ts` — modify
  (comment-only fix at lines 8–17; the local
  `LocationPreferenceTierInput` interface is untouched per C11)
- any `*.test.ts` asserting 200/401 on the chatbot routes — update or
  delete (design §Open Questions)

**Acceptance criteria.**

- [ ] `rg "lib/chatbot|components/chatbot|llm/preference-llm|llm/prompts"
  apps/web/src --type ts` returns zero matches outside the deleted files
  themselves (no dangling imports).
- [ ] Each of the 3 route files exports `GET` **and** `POST`, each
  returning `NextResponse.json({ error: "chatbot endpoints retired" },
  { status: 501 })`; the files contain no auth call and no `lib/chatbot`
  import.
- [ ] `apps/web/src/app/onboarding/page.tsx` and
  `apps/web/src/components/chatbot/` no longer exist.
- [ ] `packages/ats-core/src/geo/resolve-user-location.ts` no longer
  references `apps/web/src/lib/chatbot/schemas.ts` in any comment; the
  `LocationPreferenceTierInput` interface body is unchanged (git diff
  shows comment lines only).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` exit 0 (chatbot tests
  removed; route tests updated to expect 501).

**Test strategy.** `pnpm test` (the green gate). The route stubs are
verified by an updated/added route test asserting `501` + the exact JSON
body for both `GET` and `POST` (replacing any prior 200/401 assertions).
ats-core change is comment-only — covered by existing
`resolve-user-location` tests still passing unchanged.

**Effort.** 2–3 h (deletion is fast; the time is in chasing dangling
imports + updating route tests).

**Risks.**

- Stub auth divergence (R4, §6) — a test asserting legacy 401 on a
  chatbot route would fail under the unconditional 501 stub. Mitigation:
  `rg "api/chatbot" --type ts` and update/delete such tests in this
  chunk; note the behaviour change in the PR description.

**Hints (optional).**

- Design §9: three files × ~9 lines each, identical contents, direct
  `NextResponse.json` per route — no shared helper (net wash, simpler
  future deletion).

### Chunk substrate-cutover — Atomic migration + schema + consumer rewire + seeder

```yaml
id: substrate-cutover
depends_on: [profile-tree-module, chatbot-wipe]
labels:
  - feature:2026-05-26-wipe-and-foundation
  - type:feat
  - priority:high
  - risk:high
```

**Goal.** Land the irreducible coupled core (G1): the single
transactional migration (drop 5 columns + `user_company_preference` + 2
conversation tables; add `preferenceTree` + `claimScores`; create
`preference_branch`; wipe `job_match`), the schema TS update, the
`filter-pipeline` + L3-worker rewire onto the tree helpers (G3), the
`internet-expansion` no-op, and the seeder that populates the 5
`app_config` keys + 19 `preference_branch` rows from
`ALL_CANONICAL_BRANCHES` (G2). Depends on both roots: it imports the
`profile-tree` helpers, and the column drops are only safe once the
chatbot (a reader/writer of those columns) is gone.

**Files.** Contents/ordering locked by design §3, §4, §5, §7, §8, §10,
§11; implement to spec.

- `packages/db/src/schema.ts` — modify (drop 5 `userProfiles` cols; drop
  `userCompanyPreferences`, `conversationStates`, `conversationMessages`;
  add `userProfiles.preferenceTree` JSONB with non-NULL default; add
  `jobMatches.claimScores` JSONB nullable; add `preferenceBranches`
  table per design §4, no DDL FK on `parent_slug`)
- `apps/web/drizzle/0010_wipe_and_foundation.sql` — create (hand-edited:
  12-step order per design §7, literal
  `DEFAULT '{"schemaVersion":1,"leaves":[]}'::jsonb`, hand-added
  `DELETE FROM "job_match";`, `--> statement-breakpoint` markers, no
  explicit `BEGIN/COMMIT`)
- `apps/web/drizzle/meta/_journal.json` — modify (Drizzle bookkeeping;
  slug must match the renamed migration)
- `apps/worker/src/lib/scoring-schema.ts` — modify (add `ClaimScoreSchema`
  / `ClaimScoresSchema` type export per design §5; no runtime consumer)
- `apps/web/src/lib/search/filter-pipeline.ts` — modify (drop the
  `userCompanyPreferences` JOIN at lines 71–83; feed
  `deriveL2Inputs(profile.preferenceTree).industries` into the industry
  overlap; retained-column reads unchanged per PRD §11.5)
- `apps/web/src/lib/search/filter-pipeline.test.ts` — modify (reshape
  fixtures from flat columns to tree)
- `apps/worker/src/lib/scoring-prompt.ts` — modify (`UserProfileData`:
  drop the 5 deleted fields, add `treeSummary: string`; user-prompt body
  uses `${profile.treeSummary}`; system prompt body unchanged)
- `apps/worker/src/handlers/llm-scoring.ts` — modify (handler builds
  `treeSummary: summariseTreeForL3(PreferenceTreeSchema.parse(profile.preferenceTree))`
  at the lines 160–174 handoff; drops the 5 deleted fields)
- `apps/worker/src/handlers/internet-expansion.ts` — modify (warn-logged
  no-op per C5; prune now-unused imports)
- `apps/worker/src/lib/seed-config.ts` — modify (keep `seedPollingConfig`;
  add `seedAppConfigDefaults` + `seedPreferenceBranches`, each
  `.onConflictDoNothing()`; wire all three at the existing seed call
  site, each in its own try/catch)
- `apps/worker/src/lib/seed-config.test.ts` — modify (cover the new seed
  shapes)
- *Worker-side import wiring (per OQ1/R1):* if OQ1 relocates the
  worker-shared surface to a `@gjs/*` package, add that dependency to
  `apps/worker/package.json` (and import from it); if OQ1 keeps the
  module in `apps/web`, add the worker `@/`-alias tsconfig entry. The
  module **files themselves are created by `profile-tree-module`** at the
  OQ1-resolved location — this chunk only consumes them, so there is no
  cross-chunk file overlap.

**Acceptance criteria.**

- [ ] `pnpm db:generate` then a hand-edit produces
  `apps/web/drizzle/0010_wipe_and_foundation.sql` containing, in order:
  the 3 `DROP TABLE`s, the 5 `ALTER TABLE user_profile DROP COLUMN`s, the
  `preference_tree` add with the **literal** `DEFAULT
  '{"schemaVersion":1,"leaves":[]}'::jsonb` (not a `$1` binding), the
  `claim_scores` nullable add, `DELETE FROM "job_match";`, and `CREATE
  TABLE preference_branch`.
- [ ] `pnpm db:migrate` exits 0 against a snapshot copy of the dev DB
  (single transaction; aborts cleanly on any failure, leaving no mixed
  state).
- [ ] After migrate + worker boot: `SELECT count(*) FROM
  preference_branch` equals `ALL_CANONICAL_BRANCHES.length` (19); the 5
  `app_config` keys from C8 are present.
- [ ] `git diff` shows `ScoringOutputSchema` unchanged and **no** write
  path to `job_match.claim_scores` (column stays NULL) — C7.
- [ ] Full PRD §4 grep gate returns **0** matches:
  `rg -n 'userCompanyPreferences|coreSkills|growthSkills|avoidSkills|dealBreakers|preferredIndustries|chatbot/(engine|schemas|steps|state)'`
  excluding `apps/web/drizzle/0010_*.sql`, `tests/`, and `**/fixtures/**`.
- [ ] `curl -s -o /dev/null -w "%{http_code}"` against
  `/api/chatbot/{message,state,save}` returns `501` with body
  `{"error":"chatbot endpoints retired"}` (end-to-end, post-cutover).
- [ ] `apps/web/src/lib/db/schema.ts` is still a one-line wildcard
  re-export (C11); `internet-expansion.ts` logs the exact C5 string once
  per batch item and performs no DB read.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` exit 0.

**Test strategy.** `pnpm test` is the gate (reshaped `filter-pipeline`
and `seed-config` fixtures must pass tree-shaped inputs). Migration is
verified by `pnpm db:migrate` against a `pg_dump` snapshot copy, then
the `preference_branch` row-count + `app_config` queries via
`mcp__postgres__execute_sql`. The 501 behaviour is verified by `curl`
against a running dev server. `filter-pipeline.test.ts` first fails on
the old flat-column fixtures, then passes once reshaped to tree inputs.

**Effort.** 5–7 h.

**Risks.**

- JSONB `DEFAULT` literal generation quirk (R2, §6) — Drizzle may emit a
  `$1` binding; mitigation: verify + hand-edit to the literal.
- `DELETE FROM job_match` is DML Drizzle won't emit (R3, §6) —
  mitigation: hand-add with an explanatory comment.
- Cross-package import (R1, §6) — mitigation: OQ1 resolved at the
  `profile-tree-module` chunk; this chunk consumes the resolved location.

**Hints (optional).**

- Design §4: model `preferenceBranches` on `roleFamilies`
  (`schema.ts:347-358`); no DDL FK on `parent_slug` — the seeder enforces
  parent linkage by inserting in `ALL_CANONICAL_BRANCHES` order.
- Design §8: `seedPreferenceBranches` computes `parentSlug` by trimming
  the last `/`-segment; top-level slugs get `null`.
- Design §11: call `summariseTreeForL3` from the **handler**, not inside
  `buildScoringPrompt`, so the prompt builder stays free of a
  `profile-tree` import.
- Design §0009/§0009.sql precedent: `0009_separate_match_signals.sql`
  shows the hand-edit pattern for a JSONB default literal.

---

## 6. Cross-cutting risks

- **R1 — Worker → `profile-tree` cross-package import (plan-wide;
  touches `profile-tree-module` + `substrate-cutover`).** The worker
  must import `ALL_CANONICAL_BRANCHES` (seed) and `summariseTreeForL3` /
  `PreferenceTreeSchema` (L3 handler). Verified: the worker imports
  **all** shared code via `@gjs/*` workspace packages and has **no `@/`
  alias and no apps→apps import precedent**; `tsconfig.base.json`
  defines no `paths`. So the design's stated-preferred fix (add a `@/`
  alias from worker → `apps/web/src/lib`) is non-idiomatic, and the
  design's documented fallback (relocate the worker-shared surface to a
  `@gjs/*` package, e.g. `packages/db` or a new `packages/profile-tree`)
  is the idiomatic path. Mitigation: resolve OQ1 at the
  `profile-tree-module` chunk kickoff (it sets file paths for both
  chunks); per design §"ADR drafts", the relocation **likely warrants a
  fresh ADR** (next free slot 0013).
- **R2 — JSONB `DEFAULT` literal (touches `substrate-cutover`).** Drizzle
  sometimes emits a `$1` parameter binding instead of the inline literal,
  which fails at migrate time. Mitigation: verify the generated `0010`
  shows `DEFAULT '{"schemaVersion":1,"leaves":[]}'::jsonb` literally;
  hand-edit if not.
- **R3 — DML in a schema-diff migration (touches `substrate-cutover`).**
  Drizzle does not emit `DELETE FROM job_match`. Mitigation: hand-add the
  statement between the `claim_scores` add and the `preference_branch`
  create, with a comment explaining the obsolete-cache rationale (C3).
- **R4 — Stub auth divergence (touches `chatbot-wipe`).** The 501 stubs
  skip the legacy `auth.api.getSession()` check, so any test asserting
  401 on a chatbot route fails. Mitigation: scan + update/delete such
  tests in `chatbot-wipe`; document the behaviour change in the PR.
- **R5 — Operator-manual `pg_dump` snapshot (plan-wide / operational).**
  Rollback after the cutover depends on a snapshot the operator must take
  manually before `pnpm db:migrate` (NG8 — no script). Mitigation:
  document the snapshot step in the cutover PR description / README;
  the migration's single transaction means a failed apply rolls back to
  pre-migration state regardless.

---

## 7. Validation strategy

After all three PRs merge to `main` (order: `profile-tree-module` and
`chatbot-wipe` in parallel, then `substrate-cutover`):

1. Operator takes a manual `pg_dump` snapshot of the dev DB (R5).
2. Run `pnpm db:migrate` — migration `0010_wipe_and_foundation.sql`
   applies in a single transaction, exit 0.
3. Reboot the worker — `seedPollingConfig`, `seedAppConfigDefaults`,
   `seedPreferenceBranches` run; idempotent `.onConflictDoNothing()`.
4. Query `SELECT count(*) FROM preference_branch` → 19; confirm the 5
   `app_config` keys exist (`mcp__postgres__execute_sql`).
5. Run `pnpm typecheck && pnpm lint && pnpm test` → all exit 0.
6. Run the PRD §4 grep gate → 0 matches outside the allowlisted paths.
7. `curl` `/api/chatbot/{message,state,save}` → HTTP 501 +
   `{"error":"chatbot endpoints retired"}` (3/3 routes).
8. Visit the search page → empty result set for any user (empty tree →
   no industry filter fires); `/onboarding` is gone (intentionally
   broken per NG2).

**Definition of done:** the substrate is clean and tree-shaped — HEAD is
typecheck/lint/test green, the legacy-name grep gate returns zero outside
the migration/tests/fixtures, `preference_branch` holds exactly 19 rows
seeded from `CANONICAL_BRANCHES`, and a downstream sub-feature author can
import `CANONICAL_BRANCHES` and write a leaf to
`user_profile.preferenceTree.leaves[]` (Scenario B) without touching any
legacy column, table, or chatbot artefact.

---

## 8. Open questions

- [ ] **OQ1 — Home of the `profile-tree` module** (so the worker can
  import `ALL_CANONICAL_BRANCHES` / `summariseTreeForL3` /
  `PreferenceTreeSchema`). Decided by the `profile-tree-module`
  implementer **at chunk kickoff** (it sets file paths for that chunk and
  `substrate-cutover`). Two clean options:
  - **(A)** Keep the whole module in `apps/web/src/lib/profile-tree/` and
    add a worker `@/` alias (design's stated preference). Non-idiomatic:
    R1 found no apps→apps import in the repo.
  - **(B, cleaner if relocating)** Move the **entire** module to a shared
    `@gjs/*` package (e.g. `packages/profile-tree` or under
    `packages/db`); both `apps/web` and `apps/worker` import it
    idiomatically and `index.ts` stays single-rooted. Likely triggers a
    fresh ADR (slot 0013) per design §"ADR drafts".
  - **Avoid** relocating only the worker-imported subset
    (`canonical-branches`, `leaf-schema`, `summarise-l3`): it strands
    `derive-l2`/`mutate-leaf`/`move-leaves`/`migrate-leaves` in
    `apps/web` and leaves `index.ts` re-exporting from mixed `@gjs/*` and
    local `./` paths.

  Research (R1) leans toward (B) — the `@gjs/*` package is the idiomatic
  shape. Not pre-decided here because the design explicitly routed it to
  `/implement-task` and flagged the ADR.
- [ ] **OQ2 — Leaf `id` generation:** `crypto.randomUUID()` (v4) vs an
  existing UUID v7 helper. Decided by the `profile-tree-module`
  implementer — grep the repo for a v7 helper first; default to
  `crypto.randomUUID()` if none exists (design §2).
