# Design — Profile-driven architecture (umbrella)

Status: **Draft v1** | Date: 2026-05-07 | Slug:
`2026-05-06-profile-driven-architecture` | Format: B (Architectural
Decision) — multi-decision overhaul.

> **Reader.** This is the cross-cutting technical design that all
> sub-features of the overhaul inherit. Sub-feature plans (each a
> future `/feature` session) flesh out detail. Decisions stop at the
> seams where one sub-feature can finalise without committing the
> next. Detailed rationale for the broad-scope decisions lives in the
> ADR drafts under `./adr/`; this document gives the integrated
> picture and the binding contracts.

---

## 0. Inputs

- PRD: `docs/product/2026-05-06-profile-driven-architecture.md`
  (binding; §11.2 locks; §11.1/§10 routes the open questions to here).
- Research: `./research.md`.
- Manifesto:
  `/Users/vasd85/Documents/Notes/Projects/global-job-search/product-manifesto.md`
  (overrides on conflict).
- Predecessor: `docs/archive/preference-tree-profile.md`.
- Schema today: `packages/db/src/schema.ts`.
- ADRs: `docs/adr/0004-branch-registry-storage.md`,
  `docs/adr/0005-conversation-runtime.md`,
  `docs/adr/0006-l3-schema-extension.md`,
  `docs/adr/0007-per-claim-scores-on-job-match.md`,
  `docs/adr/0008-transient-overlay-storage.md`,
  `docs/adr/0009-tree-persistence.md`,
  `docs/adr/0010-wipe-and-foundation.md`.

---

## 1. Decision drivers (cross-cutting)

These shape every choice below. Listed once.

1. **PRD §11.2 lock list** — tree shape, nine canonical branches,
   verbatim leaf phrasing, direction polarity, conversational
   collection, ambiguity-clarification, Other-only auto-placement,
   edits-via-Chat, UI-control toggle, no finished state, unstructured
   company side, wipe-at-ship, bounded L3 cap, three results
   affordances, transient overlay isolation, naming.
2. **Process invariant (CLAUDE.md + memory):** every PR compiles +
   lints + tests at HEAD; no prod users → schema/API may break
   freely; old code removed in same PR that replaces it; no feature
   flags. Decomposition must yield green PRs.
3. **Manifesto:** profile-as-compass, private-by-default,
   selectivity, humans decide.
4. **Hybrid funnel preserved:** L1 (status) → L2 (cheap deterministic)
   → L3 (LLM-judge). Never collapse to pure LLM.
5. **Existing reference patterns to imitate, not duplicate:**
   - `user_profile.locationPreferences` JSONB tier shape (verbatim
     `originalText`, `qualitativeConstraint`, `scope.exclude`,
     `immigrationFlags`).
   - `app_config` for runtime-tunable scalars.
   - `role_family` table — DB-resident developer-editable taxonomy.
   - `synonym_group` — canonical-token expansion utility.
   - L3 worker idempotency-on-content-hash.
6. **BYOK economics dominate at L3** — every LLM call user-funded
   (`user_api_key`); soft scoring must consolidate, not balloon.

---

## 2. Architecture (whole picture)

```
┌─────────────────────────────────────────────────────────────┐
│ UI layer                                                    │
│ ┌──────────────┐   UI toggle   ┌────────────────────────┐   │
│ │ Chat surface │ ◀──────────▶  │ Profile surface        │   │
│ │ (agent)      │               │  └─ Profile Map (view) │   │
│ └──────┬───────┘               └────────────────────────┘   │
│        │ writes claims                ▲ reads tree          │
└────────┼──────────────────────────────┼─────────────────────┘
         ▼                              │
┌─────────────────────────────────────────────────────────────┐
│ Conversation runtime  +  Tree store                         │
│  - claim parser / decomposer (LLM, structured output)       │
│  - branch router (canonical or Other; ambiguity loop)       │
│  - tree CRUD on user_profile.preferenceTree (JSONB)         │
│  - branch registry: preference_branch table                 │
└──────┬──────────────────────────────────────────────────────┘
       │ reads (live derivation, no denorm)
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Matcher pipeline                                            │
│  L1 status → L2 SQL+structured (tree-derived inputs)        │
│           → L3 LLM-judge (per-job consolidated;             │
│              widened schema with per-claim score +          │
│              substring-verified evidencePhrase)             │
└──────┬──────────────────────────────────────────────────────┘
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Search results page                                         │
│  - scored batch (cap from app_config)                       │
│  - 3 affordances: Score more / Change profile / Change      │
│    filters (transient L2 overlay, query-string scoped)      │
└─────────────────────────────────────────────────────────────┘
```

**Persistent state** (DB):

- **Profile tree** — verbatim leaves with direction polarity; JSONB
  on `user_profile.preferenceTree`.
- **Branch registry** — developer-editable hierarchy; new
  `preference_branch` table.
- **Per-claim L3 scores** — JSONB on `job_match.claim_scores`.

**Transient state** (request-scoped):

- **L2 overlay** — query-string params; never persisted.

---

## 3. Decisions index

| # | Decision | Status | ADR |
|---|----------|--------|-----|
| D1 | Tree persistence form | JSONB on `user_profile` | ADR-0009 |
| D2 | Branch registry storage | `preference_branch` table | ADR-0004 |
| D3 | L3 schema extension | Widen `ScoringOutputSchema` | ADR-0006 |
| D4 | Per-claim scores on `job_match` | New `claim_scores` JSONB | ADR-0007 |
| D5 | Conversation runtime | Single LLM, structured output | ADR-0005 |
| D6 | Profile-Map renderer | Narrowed to two; final pick deferred | — |
| D7 | Transient L2 overlay storage | Query string | ADR-0008 |
| D8 | Wipe + foundation seam | First-PR diff shape | ADR-0010 |
| D9 | Live derivation vs persisted denorm | Live derivation | — |
| D10 | Skills sub-intent encoding | `skillIntent` marker on Skills leaves | — |
| D11 | RSLCD vs per-branch weights | DEFER (keep RSLCD for MVP) | — |
| D12 | L3 cap / ordering / extend increment | Tunable via `app_config` | — |
| D13 | Empty-tree Profile-Map UX | DEFER (UI sub-feature) | — |
| D14 | "Description does not mention" L3 | Neutral 5 + `mentioned: false` | (in L3 ADR) |

---

## 4. D1 — Tree persistence (JSONB on `user_profile`)

Three forms considered: JSONB column, normalized `claim` table, or
log-plus-digest hybrid. ADR rationale in ADR-0009.

**Choice:** single JSONB column `user_profile.preferenceTree`
mirroring the existing `locationPreferences` precedent. Flat array
of leaves; hierarchy reconstructed at render via `branchPath`.

**Leaf schema (binding):**

```ts
type Direction = 'include' | 'exclude'

interface Leaf {
  leafId: string                            // UUID; stable identity
  branchSlug: string                        // e.g. "industry"
  branchPath: string[]                      // ["industry"] or
                                            //   ["company-attributes","brand"]
  claim: string                             // verbatim user phrasing
  direction: Direction
  canonical?: string[]                      // synonym-group expansion
  note?: string                             // qualifier captured
  source?: { turnId: string }               // FK to conversation_message.id
  flaggedUncertain?: boolean
  confidence?: number                       // 0..1
  skillIntent?: 'keep' | 'grow' | 'avoid'   // Skills branch only — D10
  createdAt: string                         // ISO
  updatedAt: string
}

interface PreferenceTree {
  schemaVersion: 1
  leaves: Leaf[]
}
```

**`branchSlug` validation** is server-side at write time (a leaf must
reference an active row in `preference_branch`). No Postgres FK —
JSONB boundary makes it impractical; D2's soft-delete (`active = false`)
plus a periodic audit covers drift.

**Location preferences exception:** `user_profile.locationPreferences`
remains in its existing tier shape per PRD NG1 + §11.3 invariant. The
Profile Map adapter projects tier shape into leaf shape **read-only**
at render. Fast-follow alignment if structurally divergent.

---

## 5. D2 — Branch registry (`preference_branch` table)

Choices: dedicated table, `app_config` JSONB blob, TS constant
(rejected by lock). ADR-0004.

**Choice:** dedicated `preference_branch` table modelled on
`role_family`.

```ts
preferenceBranch = pgTable("preference_branch", {
  slug: text("slug").primaryKey(),
  parentSlug: text("parent_slug")
    .references(() => preferenceBranch.slug),
  displayName: text("display_name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  config: jsonb("config"),                  // per-branch tunables
  createdAt: ...,
  updatedAt: ...,
});
```

**Seed migration** installs the nine top-level slugs from PRD §6.3:
`role`, `skills`, `compensation`, `location`, `industry`,
`company-attributes`, `exclusions`, `deal-breakers`, `other`. First
cut of sub-branches per PRD §11.4 hint:

- `skills` → `skills/keep`, `skills/grow`, `skills/avoid`.
- `company-attributes` → `size`, `stage`, `funding`, `hq`,
  `product-or-services`, `brand`, `culture`.

**UI max-depth** lives separately in
`app_config.ui.profile_map_max_depth` (default 3) — narrow scalar,
not part of hierarchy.

**Why not `app_config` blob:** per-row editing is operationally
simpler than rewriting a tree blob; `parentSlug` self-FK enforces
referential integrity on the registry; mirrors `role_family` exactly
(zero new mental load).

---

## 6. D3 — L3 schema extension (widen `ScoringOutputSchema`)

Choices: widen, replace RSLCD with per-claim aggregation, or audit
pass. ADR-0006.

**Choice:** widen the existing schema with a `claims` array
alongside RSLCD. Lowest risk; preserves calibrated `weight_*`
columns; delivers per-claim grain in the same single LLM call.

```ts
const ClaimScoreSchema = z.object({
  leafId: z.string(),
  score: z.number(),                       // clamped server-side 0-10
  evidencePhrase: z.string().nullable(),   // substring of source text
  mentioned: z.boolean(),                  // false if description silent
});

ScoringOutputSchema = ScoringOutputSchema.extend({
  claims: z.array(ClaimScoreSchema),
});
```

**Substring verification** (PRD §11.3 invariant): every non-null
`evidencePhrase` is case-insensitive whitespace-normalised
substring-checked against description text via shared utility
`apps/worker/src/lib/verify-evidence-phrase.ts`. On miss → either
retry once with tighter prompt or null the phrase + warn-log
(sub-feature picks based on measured rate). **No hallucinated phrase
reaches `job_match`.**

**Prompt mitigations** (research findings, PRD §11.5):

- Randomise claim order per call (position-bias).
- Ask for `mentioned` first, then `score`, then `evidencePhrase`
  (reasoning-before-number).
- For users with > 15 active claims: chunk into ≤ 15 per call,
  multiple consolidated calls per job, merge. Cap configurable via
  `app_config.scoring.l3_claims_per_call`.

**Silence handling (D14):** LLM emits `mentioned: false`, `score: 5`
(neutral), `evidencePhrase: null`. Penalising silence with 0
systematically downranks under-described jobs (small startups);
neutral 5 keeps RSLCD stable and lets the UI surface "this job
doesn't mention X" as a selectivity hint.

**RSLCD scores stay.** `weight_*` columns and `computeMatchPercent`
unchanged. Per-claim scores feed UI explainability and (sub-feature)
soft anti-match for `direction: 'exclude'` claims.

---

## 7. D4 — Per-claim scores on `job_match` (JSONB column)

Choices: new JSONB column, new `job_match_claim` table, or overload
`evidenceQuotes`. ADR-0007.

**Choice:** new JSONB column `claim_scores` on `job_match`. Single-row
read returns RSLCD + per-claim atomically; mirrors the tree's JSONB
shape (D1); `evidenceQuotes` retains its semantics (whole-match
summary quotes) without overload.

```ts
jobMatches = pgTable("job_match", {
  // existing columns unchanged
  claimScores: jsonb("claim_scores"),       // ClaimScore[]
});
```

`leafId` references a leaf in `user_profile.preferenceTree` — soft
reference, not FK. Render-time filter drops entries whose `leafId`
no longer exists.

---

## 8. D5 — Conversation runtime (single LLM, structured output)

Choices: single structured-output call per turn, tool-use, or
multi-step pipeline. ADR-0005.

**Choice:** single Anthropic call per user turn via `generateText` +
`Output.object` (same Vercel AI SDK pattern the L3 worker uses).
TypeScript engine applies tree mutations after parse.

**Turn output contract (binding):**

```ts
const NewClaimSchema = z.object({
  branchSlug: z.string(),
  branchPath: z.array(z.string()),
  claim: z.string(),                              // verbatim from user
  direction: z.enum(['include', 'exclude']),
  canonical: z.array(z.string()).optional(),
  note: z.string().optional(),
  skillIntent: z.enum(['keep', 'grow', 'avoid']).optional(),
  confidence: z.number().optional(),
});

const TurnOutputSchema = z.object({
  replyText: z.string(),
  claimsToCommit: z.array(NewClaimSchema),
  ambiguousClaim: z.object({
    bestGuessBranch: z.string(),
    bestGuessDirection: z.enum(['include', 'exclude']),
    bestGuessClaimText: z.string(),
    clarificationQuestion: z.string(),
  }).nullable(),
  branchNudge: z.string().nullable(),
  acknowledgment: z.string().nullable(),
});
```

**Runtime layer** (`apps/web/src/lib/profile-conversation/`):

1. Load `preferenceTree` and active branch registry.
2. Build prompt (system: agent role, branch taxonomy, copy guidance,
   forbidden-labels guard per PRD §11.4; user: prior turns from
   `conversation_message`, current message, current tree summary).
3. Call Anthropic with `TurnOutputSchema`.
4. Validate each `claimsToCommit`: `branchSlug` resolves to active
   row; verbatim phrasing substring-derivable from user turn;
   `skillIntent` set iff Skills branch.
5. Assign `leafId` UUIDs; append to tree.
6. If `ambiguousClaim` non-null, store on `conversation_state` as
   `pendingAmbiguousClaim`, increment
   `clarificationsForCurrentClaim`. On budget exhaust → commit
   best-guess with `flaggedUncertain: true`, surface via
   `acknowledgment`.
7. Persist assistant turn to `conversation_message` with raw
   structured output on `metadata`.

**`conversation_state.state` reshapes** from legacy step-driven to:

```ts
ConversationStateV2 = {
  schemaVersion: 2,
  clarificationsForCurrentClaim: number,
  pendingAmbiguousClaim?: { bestGuess, question, asked: number },
  visitedBranches: string[],
}
```

No `currentStepIndex`, no `draft`. Tree mutations apply directly.

**Defaults:** Claude Haiku 4.5 (parity with L3 worker; lowest BYOK
cost). Clarification budget 2 via
`app_config.chatbot.clarification_budget`.

**Concurrency:** optimistic concurrency via `user_profile.updatedAt`
check in the turn handler; on conflict, replay the new claim against
the fresh tree.

---

## 9. D6 — Profile-Map renderer (narrowed)

Sub-feature owns final pick. Narrowed option space:

- **A. `markmap-lib` / `markmap-view`** — markdown-driven mind-map
  renderer. Pros: minimum config. Cons: limited per-leaf React
  control for direction styling.
- **B. `react-flow` (xyflow)** — general node/edge graph with manual
  layout. Pros: per-node React markup → trivial direction-styling
  and uncertain-badges. Cons: more setup.

Reject `elk.js` + custom SVG (excess effort) and pure markmap-only
(insufficient styling control).

**Recommendation:** **B (react-flow)** unless the UI sub-feature
prototypes show otherwise. Bundle ~80 KB gz; tree layout via
`elkjs` adapter or `dagre` plugin (one-line config). Final pick
deferred; ADR if the choice has cross-cutting consequences (likely
not).

---

## 10. D7 — Transient L2 overlay (query string)

ADR-0008.

**Choice:** URL query string. URL-shareable; naturally discarded on
navigation; structurally cannot mutate persistent state (no DB write
path exists).

**Locked overlay parameter set** (sub-feature panel UX may polish
labels):

| Param | Maps to | Default |
|-------|---------|---------|
| `rf` | role family slug(s) | profile-derived |
| `sn` | seniority(s) | profile-derived |
| `loc` | structured location summary | profile-derived |
| `ind` | canonical industry token(s) | tree-derived |
| `rmt` | remote preference | profile-derived |

**Contract:** `searchJobs` takes optional `overlay` arg — present →
override profile-derived inputs; absent → read tree (D9).
`/api/scoring/trigger` forwards same arg. Neither code path writes
overlay values to any DB row.

---

## 11. D8 — Wipe + foundation seam (first PR shape)

ADR-0010. Locks the first sub-feature's PR
diff so subsequent ones inherit a deterministic substrate.

**Database (one Drizzle migration, single transaction):**

- `DROP TABLE user_company_preference`.
- `ALTER TABLE user_profile DROP COLUMN core_skills, growth_skills,
  avoid_skills, deal_breakers, preferred_industries`.
- `ALTER TABLE user_profile ADD COLUMN preference_tree jsonb`.
- `CREATE TABLE preference_branch` (D2); seed nine top-level + first
  cut sub-branches.
- `ALTER TABLE job_match ADD COLUMN claim_scores jsonb`.
- Insert `app_config` defaults: `scoring.l3_candidate_cap = 100`,
  `scoring.extend_batch_size = 100`, `ui.profile_map_max_depth = 3`,
  `chatbot.clarification_budget = 2`,
  `scoring.l3_claims_per_call = 15`.
- `DELETE FROM conversation_message`; `DELETE FROM conversation_state`.

**Code removals:**

- `apps/web/src/lib/chatbot/{engine,steps,schemas,state,location-utils}.ts`
  + `*.test.ts` siblings.
- `apps/web/src/app/api/chatbot/save/route.ts`.
- `apps/web/src/lib/llm/{preference-llm,prompts}.ts`.

**Code stubs introduced:**

- `apps/web/src/lib/profile-tree/` — Zod leaf schema, pure CRUD
  (`appendLeaf`, `updateLeaf`, `deleteLeaf`, `getLeavesByBranch`),
  branch-registry reader, `deriveL2Inputs(tree)`. Unit-tested.
- `apps/web/src/lib/profile-conversation/` — no-op `processTurn`
  returning "not yet implemented" + empty mutations. Replaced by D5
  sub-feature.
- `apps/web/src/app/api/chatbot/*` — auth-preserving 501 stubs so
  the existing UI does not crash. Replaced by conversation
  sub-feature.

**Filter pipeline (`filter-pipeline.ts`):**

- Drop `userCompanyPreferences` JOIN (table dropped).
- Read `userProfile.preferenceTree`; pass through
  `deriveL2Inputs(tree)` to get `targetTitles`, `targetSeniority`,
  `industries`, `remotePreference`. Empty tree → empty results.

**L3 worker:** rewire input source from flat columns to
`deriveL2Inputs` + tree-summary helper. **Schema not yet widened**
in this PR — RSLCD path unchanged, only inputs change. Per-claim
scoring lands in the L3 sub-feature.

**Acceptance gates:** typecheck, lint, test green; search returns
empty for all users (correct post-wipe); no reference to removed
columns or `user_company_preference` outside the migration.

---

## 12. D9 — Live derivation, no persisted denorm

L2 needs `targetTitles`, `targetSeniority`, canonical industry
tokens, remote-pref flag, location tier struct.

**Choice:** live tree walk in TypeScript at search time, **not**
persisted denormalisation. Tree is single source of truth; walking
the JSONB is cheap (profile size bounded); avoids two-source-of-truth
bugs.

`deriveL2Inputs(tree)` lives at
`apps/web/src/lib/profile-tree/derive-l2.ts` — pure, testable.
Industry leaves with `direction: 'exclude'` are **not** handed to L2
(positive overlap only); they ride into L3 as soft anti-match
claims.

`preferred_locations` and `remote_preference` columns on
`user_profile` were already derived from `locationPreferences` —
that pattern continues for them in MVP (location's NG1 carve-out;
fast-follow alignment makes them tree-derived too).

---

## 13. D10 — Skills sub-intent encoding

Universal `direction` + per-leaf `skillIntent` marker on Skills leaves
only.

- `direction` stays universal (every leaf has it).
- Skills leaves carry `skillIntent: 'keep' | 'grow' | 'avoid'`.
  `"want to keep using Python"` → `direction: 'include'`,
  `skillIntent: 'keep'`. `"want to learn Rust"` →
  `direction: 'include'`, `skillIntent: 'grow'`.
- `direction: 'exclude'` + `skillIntent: 'avoid'` is symmetric
  (slightly redundant but consistent).
- `hasGrowthSkillMatch` (current scoring schema field) drops from
  schema and computes server-side from `claim_scores` —
  `mentioned: true` on any `skillIntent: 'grow'` claim.

---

## 14. D11 — RSLCD vs per-branch weights (DEFER)

**MVP default:** keep RSLCD with derivation. D3 widens schema; the
existing `weight_*` columns continue to drive `matchPercent`.

DEFER: per-branch weights vs per-claim aggregation needs an
empirical pass against PRD §4 manual top-N benchmark. Fast-follow
sub-feature post-MVP.

---

## 15. D12 — L3 cap / ordering / extend (partial)

- `scoring.l3_candidate_cap` (default 100) — caps per-search.
  Current trigger requests `searchJobs(limit: 200)`; cap shrinks
  downstream.
- `scoring.extend_batch_size` (default 100) — per "Score more"
  click.
- **Ordering** for MVP: `firstSeenAt DESC` (recency; matches existing
  `fetchBatch` ORDER BY). Fast-follow: per-branch balance / L2
  score-blended via `app_config.scoring.cap_ordering` enum.
- **No background continuation past cap.** Trigger route slices the
  candidate list at cap before enqueue. "Score more" re-invokes with
  `offset = cap * N`.

---

## 16. D13 — Empty-tree Profile-Map UX (DEFER)

UI sub-feature decides between empty-state illustration, redirect to
Chat, or placeholder branch outline. Out of umbrella scope.

---

## 17. Cross-cutting: failure modes & risks

Risks that every sub-feature plan must address:

- **Tree write conflicts.** Two browser tabs commit concurrently →
  last-write-wins overwrites. Mitigation: optimistic concurrency via
  `user_profile.updatedAt` in the turn handler; replay on conflict.
  D5 sub-feature owns.
- **L3 hallucinated evidence.** Locked invariant — substring-verify
  every `evidencePhrase`. Shared utility
  `apps/worker/src/lib/verify-evidence-phrase.ts`. Hallucination
  rate is a kill-switch signal (PRD §4 + §9.1).
- **Synonym expansion.** `expandTerms('industry', ...)` consumes
  `canonical: string[]` from each leaf, not the verbatim `claim`.
  D5 runtime populates `canonical` at commit using the synonym
  registry. Leaves where canonical is unknown still match at L3
  (soft) — they just don't narrow at L2.
- **Forbidden labels (PRD §11.4).** UI must not contain `Onboarding`,
  `Interview`, or job-interview-adjacent phrasing. Sub-feature plan
  includes a content-lint test
  (`expect(uiCopy).not.toMatch(/onboard|interview/i)`).
- **Branch-slug drift.** A leaf with `branchSlug` not in
  `active=true` set is orphaned. Mitigation: soft-delete on
  branches; server-side validator at write time; periodic audit.
- **Wipe scope.** D8 migration drops two tables and rewrites a third
  in one transaction. Mitigation: `pg_dump` snapshot before applying
  (cheap insurance even for solo product).

---

## 18. Sub-feature decomposition guidance (for `/plan`)

Five visible seams; `/plan` finalises ordering and exact boundaries.

1. **Wipe + foundation** (D8). Outcome: clean substrate; profile
   tree + branch registry + claim_scores column present; legacy
   chatbot module deleted; L2/L3 reading tree-derived inputs but
   empty.
2. **Conversation runtime + tree CRUD wiring** (D5 + D1 wiring).
   Outcome: user can chat, claims commit to the tree, raw tree view
   is renderable. Routes the Chat API surface in place of the
   removed `/api/chatbot/save`.
3. **Profile-Map renderer + UI shell** (D6). Outcome: tree
   visualised at depth 2-3 with direction differentiation;
   UI-control toggle between Chat and Profile.
4. **L3 widening** (D3 + D4 + D14 + new prompt). Outcome: per-claim
   scoring with substring-verified evidence persisted on
   `claim_scores`.
5. **Results-page affordances + transient overlay** (D7 + D12
   polish). Outcome: "Score more" / "Change profile preferences" /
   "Change filters" live; overlay routes through query string.

Possible seam 6: fast-follow location alignment (PRD §7.2) if
divergence becomes structural during seam 3.

**Hard ordering constraint:** seam 1 first. Seams 2 and 3 are
independent on the data layer — `/plan` may parallelise them post-
seam-1.

---

## 19. Open questions left to sub-feature design

Per PRD §10, narrowed to those that don't need umbrella decisions:

- D6 final renderer (markmap-lib vs react-flow) — UI sub-feature.
- D11 weights-vs-per-branch — fast-follow post-MVP cycle.
- D12 cap default value calibration — sub-feature, post first
  manual cycle.
- D13 empty-tree UX — UI sub-feature.
- Per-branch synonym dimension assignments (which `synonym_group`
  dimensions feed which branches) — D5 sub-feature.

Locked here (no further escalation):

- D1 tree shape, D2 branch registry, D3 L3 widening, D4 per-claim
  storage form, D5 conversation runtime, D7 transient overlay
  storage, D8 wipe seam, D9 live derivation, D10 Skills
  `skillIntent`, D14 L3 silence behaviour.

---

## 20. Patterns to follow (file references)

- `apps/web/src/lib/db/schema.ts` — re-export pattern for new
  tables. Add `preferenceBranch` + schema additions in
  `packages/db/src/schema.ts`; re-export from web.
- `apps/worker/src/lib/scoring-schema.ts` — Zod-as-source-of-truth
  for structured-output schemas. New `ClaimScoreSchema` and
  `TurnOutputSchema` follow the same shape.
- `apps/worker/src/handlers/llm-scoring.ts:181-186` — `generateText`
  + `Output.object` pattern for the conversation runtime to mirror.
- `packages/ats-core/src/geo/types.ts` — `ResolvedTierGeo` shape and
  the verbatim/canonical/qualitative-constraint pattern that the
  leaf schema generalises.
- `apps/web/src/lib/search/synonym-cache.ts` and
  `filter-pipeline.ts:235-249` — `normalizeIndustryTerms` and
  `expandTerms` are the reuse target for canonical expansion at
  search time.
- `apps/web/src/lib/db/schema.ts` (`appConfig` row) — runtime
  tunable pattern.
- `packages/db/src/schema.ts` (`roleFamilies`) — DB-resident
  developer-editable taxonomy template for `preferenceBranch`.

---

## 21. Naming reminders (PRD §11.2 lock)

- UI sections: `Chat`, `Profile`. Inside Profile: `Profile Map`.
- No user-facing brand for the conversational process.
- Internally only: "the profile assistant".
- Forbidden in UI copy: `Onboarding`, `Interview`, any
  job-interview-adjacent phrasing.

Enforced by the content-lint test (§17).
