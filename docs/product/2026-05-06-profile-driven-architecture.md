# Profile-driven architecture (overhaul)

Status: **Draft v1** | Date: 2026-05-06 | Owner: vasd85

> **Reader:** this PRD is written for a downstream agent (planner,
> architect, or implementer) — not a human. Sections are fixed in name
> and order; index by section number when needed. Decisions are
> declarative. "N/A" is a valid value for a section; empty is not.
>
> **Umbrella scope.** This PRD captures architectural decisions that
> bind ALL sub-features of the overhaul. Each sub-feature is a future
> `/feature` session with its own PRD scoped to its slice; this
> umbrella covers the cross-cutting contract.

---

## 0. Inputs & pointers

- **Repo:** `/Users/vasd85/repo/personal-projects/global-job-search`
- **Canonical product reference:**
  `docs/base/product-manifesto.md` — overrides any conflicting proposal.
- **Predecessor draft:**
  `docs/archive/preference-tree-profile.md` (Draft v1, not approved)
  — substantial portions adopted; refinements documented in §§ 6–11
  and § 10.
- **Research note:**
  `.claude/scratchpads/2026-05-06-profile-driven-architecture/research.md`
- **Schema:** `packages/db/src/schema.ts`, re-exported via
  `apps/web/src/lib/db/schema.ts`. Tables touched: `user_profile`,
  `user_company_preference`, `conversation_state`,
  `conversation_message`, `synonym_group`, `job_match`, `app_config`.
  New table(s) introduced by sub-features (downstream choice).
- **Code paths replaced:**
  - `apps/web/src/lib/chatbot/engine.ts` (sequential 16-step engine).
  - `apps/web/src/lib/chatbot/steps.ts`,
    `apps/web/src/lib/chatbot/schemas.ts`,
    `apps/web/src/lib/chatbot/state.ts`.
  - `apps/web/src/app/api/chatbot/save/route.ts`.
  - `apps/web/src/lib/llm/preference-llm.ts`,
    `apps/web/src/lib/llm/prompts.ts`.
- **Code paths extended (not replaced):**
  - `apps/web/src/lib/search/filter-pipeline.ts` — L2 inputs reshaped
    to read tree-derived values.
  - `apps/worker/src/handlers/llm-scoring.ts`,
    `apps/worker/src/lib/scoring-schema.ts`,
    `apps/worker/src/lib/scoring-prompt.ts` — L3 schema and prompt
    widened to read the tree, emit per-claim scores and evidence
    phrases inside the same per-job consolidated call.
  - `apps/web/src/app/api/scoring/trigger/route.ts` — operates over
    the new candidate set; cap from `app_config`.
- **Code paths untouched:** auth (`user`, `session`, `account`,
  `verification`); ATS ingestion (`company`, `job`, `poll_log`,
  `company_submission`, vendor extractors under
  `packages/ats-core/src/extractors/*`); role family classifier
  (`packages/ats-core/src/classifier/*`, `role_family` table); geo /
  location-tier resolver (`packages/ats-core/src/geo/*`);
  `synonym_group` + `apps/web/src/lib/search/synonym-cache.ts`;
  `app_config`; BYOK key store (`user_api_key`); durable
  job-signal extraction columns (`job.{visaSponsorship,
  relocationPackage, workAuthRestriction, languageRequirements,
  travelPercent, securityClearance, shiftPattern,
  signalsExtractedAt, signalsExtractedFromHash}`).
- **DB access:** `mcp__postgres__execute_sql` (read-only via dbhub).

---

## 1. Problem

### 1.1 User problem

The solo product owner — a senior QA engineer building a private
profile of preferences for a thoughtful, selective job search —
describes preferences in compound natural-language statements that
mix multiple conceptual dimensions (qualifiers, exclusions,
company-type attributes) in one sentence. The current 16-step
chatbot extracts one flat field per step. A statement like
"Web3/blockchain/crypto, biotech, fintech (but not traditional
banking), product companies that have their own bright product"
collapses across step boundaries: qualifiers degrade into
parenthetical noise, non-industry attributes ("product companies")
land in a column where no company is tagged, and the relation
between a positive claim and its exclusion ("fintech, but not
banking") is severed across two disconnected fields. Three of four
conceptual intents are either lost or disfigured. When the user
returns to refine, they must re-traverse the linear wizard. There
is no view that surfaces everything the system thinks it knows
about them.

### 1.2 Business problem

Per the product manifesto, fidelity of preference capture is the
direct upstream input to match quality, and match quality is the
indirect lever the system controls toward its north star (an
accepted job offer for a role that matches preferences). Two
compounding issues cap fidelity today: (1) the destination schema
is flat per dimension; non-trivial preferences are lost or
disfigured at capture; (2) ~11 of 14 user-profile fields are not
read by the L2 SQL pre-filter — they only feed the L3 LLM-scoring
prompt and never narrow the candidate set. Improving capture alone
does not help until matching also reads the new structure.

### 1.3 Why now

- Solo / experimental stage; no production data protection
  concerns. Architectural rewrites are safe; schema and API can
  be broken freely.
- The existing `user_profile.locationPreferences` JSONB tier
  schema (with `originalText`, `qualitativeConstraint`,
  `scope.exclude`, `immigrationFlags`) demonstrates a richer leaf
  pattern that already works in production.
- BYOK (`user_api_key`) is in place — per-job LLM-judge calls are
  economically viable for the solo user.
- An existing per-job consolidated L3 worker
  (`apps/worker/src/handlers/llm-scoring.ts`, 358 lines, Claude
  Haiku 4.5 via Vercel AI SDK with structured-output schema) is
  the right foundation to extend with per-claim scoring and
  evidence phrases — not a build-from-scratch.

---

## 2. User & context

### 2.1 Target user

Solo user / product owner: senior QA engineer, manifesto-driven,
researching job opportunities and validating the product on his
own profile. Technically deep. Specific and qualified preferences
("Web3 testing, not manual regression, not traditional banking,
product-first companies"). Returns to refine the profile
frequently. No tolerance for dropped signal.

### 2.2 Jobs-to-be-done

"When I tell the system what kind of role and company I want, I
want every nuance I mention to be captured and remain matchable —
including exclusions, qualifiers, and subjective criteria — so I
never have to trade between speaking freely and speaking in the
system's vocabulary."

"When I return to my profile, I want to see everything the system
knows about me at a glance and be able to correct anything through
conversation, without re-doing onboarding from scratch."

### 2.3 Scenarios

- **Scenario A — first conversation from scratch.** User signs in
  after a database wipe. The agent opens with a broad baseline
  question. The user replies with a compound statement spanning
  industry, qualifier, exclusion, and company-type. The agent
  decomposes the response, commits unambiguous claims to their
  branches with preserved phrasing, asks one clarification for the
  ambiguous company-type claim, and on confirmation routes the
  claim to the correct branch.
- **Scenario B — refining after seeing results.** User runs search
  and sees five outsourcing companies in the top 27. User opens
  Chat: "the outsourcing ones — remove them, I don't want staffing
  companies." The agent appends a leaf to Exclusions with verbatim
  phrasing and exclude direction; the search re-runs. No
  re-traversal of any wizard.
- **Scenario C — viewing the profile.** User opens the Profile
  view. The Profile Map renders the tree at depth 2–3, leaves
  labeled with the user's own words, direction visually
  differentiated. User spots a misplaced claim, returns to Chat,
  asks to fix it; the agent updates the leaf in place.

---

## 3. Goals & non-goals

### 3.1 Goals

- G1 — Every user-stated preference is represented in the profile
  tree with original phrasing preserved verbatim on a leaf, with
  an explicit `direction` (include or exclude).
- G2 — Ambiguous user statements are resolved by agent-initiated
  clarification (best-guess interpretation phrased as a question)
  before commit; soft-exit commits flag the leaf as uncertain when
  the clarification budget is spent.
- G3 — Soft / subjective claims (e.g., "bright brand",
  "product-first culture") are matchable at L3 against job and
  company description text via an extended LLM-judge that returns
  a per-claim score and a substring-verifiable evidence phrase.
- G4 — User can view every branch of their profile in a single
  Profile Map rendering at the configured max depth. Edits flow
  through Chat, never inline on the map.
- G5 — There is no "completed" state. The same Chat surface is
  the entry point for refinement; the agent updates leaves in
  place.
- G6 — Hard filters (location, work authorization, compensation
  floor, role family, seniority) remain structured and cheap at
  L1/L2, preserving funnel performance.
- G7 — L3 scoring runs in bounded batches. The judge scores up to
  a configured candidate cap from L2's output and stops; users
  control whether to extend the batch via an explicit affordance.
- G8 — At the bottom of the scored batch, exactly three
  user-driven continuation affordances are surfaced: extend the
  scored batch, edit persistent profile preferences (returns to
  Profile + Chat), apply transient L2 filter overrides scoped to
  the current search only.

### 3.2 Non-goals

- NG1 — Pre-emptive rewrite of the location preference subsystem
  (`user_profile.locationPreferences`,
  `packages/ats-core/src/geo/*`). Location stays functional in
  MVP; alignment is fast-follow.
- NG2 — Migrating existing `user_profile`,
  `user_company_preference`, `conversation_state`, or
  `conversation_message` rows. Wipe at ship; no migration.
- NG3 — Evidence-as-content on leaves (links to work, portfolio
  artefacts, project references, numbers). Belongs to a separate
  "from profile to application" cycle.
- NG4 — Application projection (role-specific CV, cover letter,
  answers to application questions). Separate cycle.
- NG5 — Interview prep, offer negotiation, networking, post-hire
  support. Manifesto out-of-current-scope.
- NG6 — Public profile surface, recruiter inbound channel,
  open-to-work signal. Forbidden by manifesto.
- NG7 — Mass-blast / auto-submit. Forbidden by manifesto.
- NG8 — Pre-emptive structured facet tagging on the company side
  (`is_product_company`, brand strength, culture tags). Soft
  matching is LLM-judged over raw description text.
- NG9 — Proactive re-engagement (agent initiating after N days /
  N rejections). Fast-follow.
- NG10 — Critique loops (saved / dismissed actions automatically
  mutating the tree). Fast-follow.
- NG11 — Rich Profile Map interactions (drag, reorder, theming,
  multi-select). Depth-2–3 render with direction indicator is
  enough for MVP.

---

## 4. Success metrics

This is an umbrella PRD. End-state metrics apply when the entire
overhaul lands; each sub-feature additionally defines its own
landing-time correctness criteria in its own PRD.

Verification is manual and one-shot for the solo-experimental
product (per archive PRD § 4 baseline; manifesto forbids
volume-based KPIs).

| Metric | Type | Target | Measured how |
|---|---|---|---|
| Every user statement from the transcript appears as a leaf with original phrasing preserved verbatim | leading | 100% | Side-by-side compare of `conversation_message` (role=user) vs saved tree; manual SELECT + eyeball |
| No meaningless / unmatchable values remain in structured fields (e.g., `"product companies"` in an industry-only column) | leading | 0 | Manual SELECT on the tree JSONB / claim table; visual inspection |
| Ambiguous user statements trigger ≥ 1 agent clarification turn before commit | leading | 100% of ambiguous statements in the test session | Manual review of `conversation_message` log — count user ambiguous turns vs subsequent assistant clarifications |
| L3 scored batches stop at the configured cap; extending happens only on explicit user affordance | leading | 0 incidents of background continuation | Audit `apps/worker/src/handlers/llm-scoring.ts` enqueue path + scored-vs-cap counts in logs |
| Manual top-N benchmark overlap: user hand-picks relevant jobs from direct SQL browsing of `job` table; system top-20 contains the hand-picked relevant set | lagging | ≥ 80% overlap | Hand SQL queries vs `/api/search` output; manual overlap count |
| Soft claims that contributed to a match show an `evidence_phrase` substring-verifiable in the source job or company description | lagging | 100% of contributing soft claims | Manual review of `job_match` per-claim records vs source `description_text` |

**Kill criteria** (after a full-cycle manual test):

- More than 10% of user-stated preferences are lost or assigned to
  a semantically wrong branch, OR
- Manual top-N benchmark overlap below 50%, OR
- Ambiguity-clarification fires on more than ~30% of user turns,
  making the conversation feel like an interrogation.

If any fires, roll back and reconsider architecture. Options
include: drop branch classification at ingest and move to pure
LLM-judge over unstructured claims; reshape the branching
taxonomy; adjust the ambiguity threshold; or cancel the rewrite.

---

## 5. Current state

### 5.1 Existing behavior

- 16-step chatbot wizard
  (`apps/web/src/lib/chatbot/engine.ts:104` `processMessage`,
  `apps/web/src/lib/chatbot/steps.ts:78–317`) extracts one flat
  field per step via per-step Zod schemas
  (`apps/web/src/lib/chatbot/schemas.ts`). `MAX_CLARIFICATIONS=2`
  baked at engine line 19.
- Atomic save into `user_profile` and `user_company_preference`
  via `apps/web/src/app/api/chatbot/save/route.ts`.
- L1/L2 filter
  (`apps/web/src/lib/search/filter-pipeline.ts:43–176`) reads
  only `targetTitles` (via `classifyJobMulti`), `targetSeniority`,
  `remotePreference`, `locationPreferences` /
  `preferredLocations`, and `industries` (with synonym expansion).
- L3 scoring worker (`apps/worker/src/handlers/llm-scoring.ts`,
  358 lines) is triggered by
  `apps/web/src/app/api/scoring/trigger/route.ts` after L2 returns
  up to 200 candidates. Uses `pg-boss` queue
  `FUTURE_QUEUES.llmScoring`; calls Claude Haiku 4.5 via Vercel
  AI SDK with structured-output schema
  (`apps/worker/src/lib/scoring-schema.ts`); writes RSLCD scores,
  `matchPercent`, `matchReason`, `evidenceQuotes` to `job_match`.
  Cache-keyed on `jobContentHash`.
- `user_profile.locationPreferences` JSONB ranked-tier schema is
  the structurally richest preference object today and the model
  the new tree generalizes.
- Durable LLM-extracted job signals on `job` (visa, relocation,
  work-auth, language, travel, security clearance, shift) with
  provenance (`signalsExtractedAt`, `signalsExtractedFromHash`).
  Stays.

### 5.2 Baseline data

Numbers verified during research and archive PRD § 5
(`mcp__postgres__execute_sql`):

- User's saved industries (user
  `KuyACZ7anp11iamniFQ9iXkrBZG44f6z`):
  `["Web3/blockchain/crypto", "Biotech", "Fintech
  (non-traditional banking)", "Product companies"]`. Two of four
  are unmatchable. SQL: `SELECT industries FROM
  user_company_preference WHERE user_id = '...';`
- Top company industry tags (lowercase, top 20):
  `fintech (91), blockchain (35), b2b_saas (31), payment_processing
  (26), web3 (23), saas (23), developer_tools (23), cryptocurrency
  (18), infrastructure (15), crypto (9), lending (9), ai (9),
  payments (9), security (8), biotech (8), defi (7), hardware (7),
  gaming (6), embedded_finance (5), exchange (5)`. No tag for
  "product company" or "brand strength". SQL: `SELECT tag,
  COUNT(*) FROM (SELECT unnest(industry) AS tag FROM company
  WHERE industry IS NOT NULL) GROUP BY tag ORDER BY count DESC
  LIMIT 40;`
- Synonym-group coverage for `industry` dimension: 15 groups, 48
  synonyms total. SQL: `SELECT dimension, COUNT(*),
  SUM(array_length(synonyms,1)) FROM synonym_group GROUP BY
  dimension;`
- Same user's `exclusions` field correctly captured "traditional
  banking" — extraction is not universally broken; failure is
  structural.
- Fields collected but not read by L2: `core_skills`,
  `growth_skills`, `avoid_skills`, `deal_breakers`, `exclusions`,
  `product_types`, `hq_geographies`, `company_sizes`,
  `company_stages`, `work_format`, `min_salary`, `target_salary`,
  `preferred_industries`. Surfaced only in the L3 scoring prompt;
  never narrow the candidate set.

---

## 6. Proposed solution

### 6.1 Conceptual approach

The user's profile becomes a **tree** with two layers:

1. **Fixed top-level branches** — taxonomy of preference dimensions
   (role, skills, compensation, location, industry, company
   attributes, exclusions, deal-breakers, other). Branches are the
   structural contract with the user (rendered in the Profile Map)
   and with the matcher (hard filters derive from specific
   branches).
2. **Free-form leaves** — every leaf is a *claim*. A claim
   preserves the user's original phrasing verbatim, carries a
   direction polarity (include or exclude), and optionally a bag
   of canonical tokens for structured matching. Soft-exit commits
   carry an uncertainty marker. Each leaf retains a reference to
   the originating `conversation_message` turn.

Collection becomes a **conversation**, not a scripted wizard. The
agent opens with a broad baseline question, parses the response,
decomposes claims, routes unambiguous ones to their branches, asks
agent-initiated clarification (best-guess phrasing) before
committing ambiguous ones, and adapts to threads the user follows.
There is no "finished" state — the same Chat surface is the entry
point for ongoing refinement.

Matching stays **hybrid**:

- **Hard filters at L1 / L2** remain structured and cheap. L2's
  inputs (target titles, seniority, canonical industry tokens,
  remote-preference flag, location tiers) come from tree-derived
  reads or denormalized columns.
- **Soft claims at L3** are scored by the existing per-job
  consolidated LLM-judge worker, extended to emit per-claim scores
  and substring-verifiable evidence phrases inside the same
  structured-output call. The judge runs in a bounded batch up to
  a configurable candidate cap, then stops.
- **Three user-driven continuation affordances** under the scored
  batch: (a) extend, (b) edit persistent profile, (c) apply
  transient L2 filter overrides scoped to the current search only.
  The transient overlay is disjoint from the profile tree.

Profile UI splits into **Chat** and **Profile** views with a
**UI-control toggle**. The Profile view contains the **Profile
Map** at the configured max render depth, view-only. All edits
flow through Chat.

### 6.2 User flow

Happy path — first conversation from scratch:

1. User signs in. Profile Map is empty. Chat is active.
2. Agent opens with a broad question.
3. User types a compound natural-language statement.
4. Agent decomposes claims. Unambiguous → committed with verbatim
   phrasing and direction. Ambiguous → agent-initiated
   clarification with a best-guess phrasing.
5. User answers clarifications; claims land in branches.
6. Agent summarizes what landed and nudges neglected branches.
7. User toggles to Profile via UI control. Profile Map renders at
   depth 2–3, leaves labeled in user's own words,
   direction-differentiated.
8. User toggles back to Chat to fix any misplacement; agent
   updates the leaf in place.
9. User runs search at any time. L1/L2 read tree-derived inputs;
   L3 scores up to the configured cap.
10. Bottom of scored batch shows three affordances: extend, edit
    profile, apply transient filters.
11. Transient filter use updates results in place; profile tree
    untouched. Leaving the page or starting a new search clears
    the overlay.

Unhappy branches: agent misinterprets → user rejects clarification,
agent reformulates or accepts a user-named branch. Clarification
budget exhausts → agent commits to best-guess branch with the
uncertainty marker; the Profile Map renders such leaves
distinctly. No matches for a claim → surface "no job descriptions
reference this claim"; user relaxes, drops, or keeps. Contradicting
claim added later → tree holds both; the judge reconciles at match
time. Visual conflict surfacing is fast-follow.

### 6.3 Entities & state changes

- **New / changed concept: tree-shaped profile.** Top-level
  branches plus leaves at any depth. Leaf preserves verbatim user
  phrasing, direction polarity, optional canonical tokens, optional
  qualifier note, optional uncertainty marker, source-turn
  reference.
- **New / changed concept: developer-editable branch registry.**
  Stores the hierarchy and the UI max render depth. Adjustable at
  runtime.
- **New / changed concept: per-claim scoring on `job_match`.** L3
  emits per-claim scores and substring-verifiable evidence phrases
  alongside the existing dimensional RSLCD scoring within the same
  structured output. Persistence form (existing `evidenceQuotes`
  widened, new column, or new table) is downstream-agent's choice.
- **Removed (as direct user-editable schema columns).**
  `user_profile.{coreSkills, growthSkills, avoidSkills,
  dealBreakers, preferredIndustries}`; entire
  `user_company_preference` table. Some MAY persist as derived
  denormalized columns for L2 convenience.
- **Retained.** `user_profile.locationPreferences`,
  `preferredLocations`, `remotePreference` (untouched in MVP);
  `user_profile.weight_*` (rebalancing decision deferred — see
  § 11.1); `conversation_state` and `conversation_message` (now
  host the ongoing profile conversation, not just an onboarding
  transcript); `synonym_group`; `role_family`; `app_config`; ATS /
  poll / signal / auth tables.

### 6.4 Interactions with existing features

- **Replaced:** chatbot engine, steps, schemas, state, save route,
  preference LLM helpers, prompts. No "finalize" endpoint; the
  tree updates incrementally.
- **Extended:** L1/L2 filter pipeline (reads tree-derived inputs);
  L3 scoring worker (output schema widened with per-claim scores +
  evidence phrases; cap enforced from `app_config`); scoring
  trigger route (no silent background continuation past cap).
- **Untouched in MVP:** ingestion / polling / ATS detection /
  vendor extractors; auth, sessions, BYOK keys; role family
  classifier; geo / location-tier resolver; durable
  LLM-extracted job signals (`signalsExtractedAt` provenance
  pattern).

---

## 7. MVP scope

### 7.1 In the first ship

- Tree-shaped profile data model with variable depth (top-level
  branches + sub-branches + leaves at any depth).
- Canonical top-level branch set: **Role, Skills, Compensation,
  Location, Industry, Company Attributes, Exclusions,
  Deal-breakers, Other**.
- Developer-editable branch registry (hierarchy + UI max render
  depth) adjustable at runtime via `app_config` or equivalent.
- Non-canonical-input policy: agent places claims it cannot
  confidently route in **Other** with explicit chat
  acknowledgement; the agent must not auto-create new canonical
  branches.
- Conversational profile agent replacing the 16-step engine:
  baseline opener, adaptive thread following, nudges for neglected
  branches, ambiguity-clarification with best-guess phrasing,
  soft-exit with uncertainty marker.
- Two UI views — Chat and Profile — with a UI-control toggle. The
  Profile view contains the **Profile Map** at the configured max
  depth (default ≈ 2–3, deeper levels via drill-down). Profile is
  view-only; edits are in Chat.
- Hybrid matcher v2: L1/L2 SQL filter reads tree-derived inputs;
  the existing L3 scoring worker is extended with per-claim scores
  + substring-verifiable evidence phrases in the same
  structured-output call; bounded batch with cap from
  `app_config`; no background continuation past cap.
- **Three results-page affordances** under the scored batch:
  extend the scored batch (repeatable until pool exhausted), edit
  persistent profile preferences (returns to Profile + Chat),
  apply transient L2-filter overrides (per-search overlay,
  disjoint from the profile tree, discarded on exit / new search /
  explicit clear).
- Complete wipe of existing user preference and conversation rows
  at ship.
- **Naming:** UI sections `Chat` and `Profile`. Profile-Map
  artefact inside Profile = `Profile Map`. **No user-facing brand
  name for the conversational process.** Forbidden labels:
  `Onboarding`, `Interview`, any job-interview-adjacent phrasing.

### 7.2 Fast follow (after MVP validation)

- **Location alignment audit.** Once tree shape stabilises, open
  `user_profile.locationPreferences` tier structure and the new
  tree side by side. If structurally divergent (different leaf
  shape / direction handling / Profile-Map rendering), align —
  required if divergence is structural, not optional.
- Proactive re-engagement (agent surfaces gaps, contradictions,
  stale leaves after N days / N rejections).
- Critique loop — dismissed / saved actions mutate the tree.
- Compaction / digest of long-running conversations.
- Profile-Map interactions — click-to-edit opens chat with
  context; visual conflict surfacing; collapse / expand defaults
  per branch.
- Conflict surfacing (contradictory claims in the same branch
  flagged for user review).

### 7.3 Maybe-never

- Mirror company-side preference tree (rejected — § 8 Alternative
  C).
- LinkedIn / resume auto-import to seed the profile (orthogonal,
  separate PRD).
- Multi-user / collaborative profile editing.
- Platform-funded LLM usage (manifesto + § 11.3 BYOK invariant).
- Public profile surface, recruiter inbound channel,
  open-to-work signal (forbidden by manifesto).

---

## 8. Alternatives considered

### Alternative A — Conversational agent over the existing flat schema (no tree)

Why considered: smaller blast radius. Replaces only the engine,
not the storage shape. Externally-validated pattern (most legacy
talent products use flat-tag claims). Defers data-model rewrite.

Why rejected: does not fix the structural loss. The flat
`industries` column still has no place for "fintech but not
banking" as a coherent claim, and "product companies" still has no
home. The qualifier-loss problem is in the destination schema, not
only in the ingest path. Keeping flat schema delays manifesto
alignment ("profile is the compass") and forces a second rewrite
later. Adopted as a **sequencing option**: the umbrella roadmap
MAY land conversational agent before the full tree-data-model swap
if sub-feature decomposition warrants — downstream `/plan` decision.

### Alternative B — Pure embeddings + LLM rerank (no structured profile)

Why considered: maximum flexibility; zero classification at ingest.
Recent industry trend (Otta / newer Wellfound / YC-era startups
per external research).

Why rejected: hard filters lose their cheap path — location,
salary, role family, seniority must stay structured at L1/L2 to
keep search fast. Match cost balloons. The user explicitly wants
to *see* the profile as a structured artefact (Profile Map at
depth 2–3, manifesto principle "profile is the compass"). Profile
as transcript or vector is not viewable at a glance.

### Alternative C — Mirror user tree and company tree (symmetric facets)

Why considered: symmetric structures simplify matching to a
tree-vs-tree diff. Conceptually clean.

Why rejected: requires heavy company-side enrichment — manually
or LLM-tagging every company against a fixed attribute schema
(`is_product_company`, `brand_strength`, `culture_type`).
Vocabulary lock-in: any new attribute the user invents has no
matching slot until that side is re-tagged. The company tag
distribution (§ 5.2) shows the existing vocabulary has no concepts
for "product company" or "brand strength". The hybrid path trades
deterministic matching on soft criteria for flexibility and lower
ingest cost.

---

## 9. Risks & trade-offs

### 9.1 Product risks

- **Over-clarification fatigue.** Mitigated by clarification
  budget per claim and soft-exit with uncertainty marker. Tracked
  by Kill criterion in § 4.
- **Profile drift / self-contradiction.** Tree accumulates
  contradictions over time; visual conflict surfacing is
  fast-follow. Acceptable for MVP; the L3 judge sees both at match
  time.
- **Profile-Map misplacement undermining trust.** Mitigated by
  preserving original phrasing on every leaf and rendering
  uncertainty-flagged leaves distinctly.
- **Hallucinated evidence at L3.** Mitigated by substring-verifying
  every evidence phrase against source `description_text`.
  Implementation must enforce.
- **Scope-induced broken state.** The overhaul is large; a
  half-migrated app is unusable. Mitigated by no prod users +
  hooks gating typecheck, lint, and `pnpm test` per PR. Each
  sub-feature PR keeps the codebase compiling and tests green at
  HEAD; intermediate broken-UX is acceptable, broken-codebase is
  not.
- **Derivation brittleness.** L2 SQL needs canonical tokens and
  target titles from the tree. If derivation flakes, search
  quality degrades silently. Mitigated by explicit tests on the
  derivation layer and log surfacing of "no canonical form
  derived".

### 9.2 Business risks

N/A — solo product owner, no users beyond the owner, no revenue
exposure, no competitive positioning.

### 9.3 Dependencies & assumptions

- Anthropic API (BYOK) and Claude Haiku 4.5 remain available and
  economically viable for per-job consolidated scoring. If pricing
  changes materially, L3 strategy must be re-costed.
- `user_profile.locationPreferences` schema is stable enough to
  leave untouched in MVP; if blocking bugs surface, alignment
  becomes MVP scope.
- `synonym_group`, `role_family`, the geo resolver, and the role
  family classifier remain stable. The new tree must derive
  inputs compatible with their existing contracts, OR contracts
  update in the same sub-feature.
- Job descriptions exist for jobs that should be soft-matched.
  Ashby / SmartRecruiters lazy description fetch still applies;
  jobs without descriptions surface as "no description available".
- pg-boss queue infrastructure remains stable.
- Conversation endpoints (`apps/web/src/app/api/chatbot/*`) can be
  restructured without breaking auth / session flows.
- Project-memory invariant — "no prod users; schema/API can be
  broken freely" — holds throughout the overhaul.

---

## 10. Open questions

For `/design` and the per-sub-feature `/feature` sessions to
resolve.

- [ ] Persistence form of the tree: JSONB on `user_profile`, a
  dedicated `claim` table, or a log-plus-digest hybrid.
- [ ] Storage form of the developer-editable branch registry: DB
  table (`preference_branch`), `app_config` JSONB, or TS
  constant. Locked: developer-editable without redeploy.
- [ ] Profile-Map renderer / library choice (react-flow, markmap,
  elk, custom).
- [ ] Ambiguity-clarification budget. Current
  `MAX_CLARIFICATIONS=2` is the starting reference; revisit during
  agent design.
- [ ] L3 scoring schema extension shape: widen
  `ScoringOutputSchema` to emit per-claim scores + evidence
  phrases alongside RSLCD; replace RSLCD with per-claim
  aggregation; or keep RSLCD and add per-claim only as a
  calibration audit pass on a subset.
- [ ] Profile-Map visual language for direction states and the
  Other branch.
- [ ] Whether denormalized columns derived from the tree are
  persisted in the DB or computed live at query time.
- [ ] How the L3 judge surfaces "the source description does not
  mention this claim at all" — neutral score, zero, penalty, or
  skip.
- [ ] L3 cap ordering heuristic (recency / L2 score / per-branch
  balance / …); default cap value; default extend-batch
  increment.
- [ ] Default UI max render depth; whether deeper levels are
  hidden until drill-in or shown collapsed with a visible count.
- [ ] Exact set of L2 dimensions exposed in the transient-filter
  overlay (role family / seniority / location / industry are
  certain; salary / work-format / visa — in or out?), and storage
  form of the overlay (query string / session / cookie).
- [ ] Empty-tree state in the Profile-Map UX (empty Map /
  placeholder illustration / redirect to Chat).
- [ ] Encoding of Skills sub-intent (keep / grow / avoid) inside
  the universal leaf schema (extend direction enum vs add
  `skill_intent` marker).
- [ ] Wipe + foundation point: which sub-feature in the roadmap
  carries the wipe of old chatbot code, drops flat fields, and
  scaffolds the tree schema. (Decided by `/plan`.)
- [ ] Matcher dimensional weights vs per-branch / per-claim
  rebalancing: keep RSLCD with derivation, replace with per-branch
  weights, or collapse to per-claim aggregated up.

---

## 11. Contract with the downstream agent

### 11.1 Decisions the agent owns

- DB shape for the tree (JSONB on `user_profile`, dedicated claim
  table, or log-plus-digest hybrid) and DB / config form of the
  developer-editable branch registry.
- Whether and how to persist derived denormalized columns vs
  computing live.
- Profile-Map renderer / library choice and layout algorithm.
- Concrete UI affordance for the Chat ↔ Profile toggle (mechanism
  as a UI control is locked; shape is the agent's call).
- Conversational agent internals: prompt architecture, LLM model
  choice per turn, structured outputs vs tool-calls, opener /
  clarification / nudge / Other-acknowledgement copy.
- Ambiguity clarification budget and soft-exit threshold.
- Synonym-group integration: extend existing dimensions, add
  dimensions per branch, or bypass for branches where canonical
  tokens are not meaningful.
- L3 scoring schema extension shape (widen vs replace vs audit
  pass) and L3 cap ordering heuristic, default cap, extend-batch
  increment.
- Default UI max render depth for the Profile Map and the
  drill-down interaction for deeper levels.
- UI shape of the transient-filter side panel (L2 dimensions
  exposed, layout, reset behaviour) and storage form of the
  overlay.
- Encoding of Skills sub-intent (grow / keep / avoid) in the leaf
  schema.
- Test architecture for the new engine and observability hooks
  (drift, clarification rate, evidence-phrase hallucination rate,
  L3 over-cap incidence).
- Sub-feature decomposition order and the wipe + foundation point
  (decided by `/plan`).

### 11.2 Decisions that are locked

Any change to the following requires reopening this PRD with the
user.

- The profile data model is a **tree with fixed top-level branches
  and free-form leaves**. Not flat arrays, not pure transcript,
  not symmetric with companies.
- The canonical top-level branch set is **the nine branches in
  § 6.3**: Role, Skills, Compensation, Location, Industry,
  Company Attributes, Exclusions, Deal-breakers, Other.
  Sub-branches and the full hierarchy under canonical roots are
  developer-editable at runtime via the `preference_branch` table.
- **Composition changes to the canonical set itself** (add / remove
  / rename / move / merge a canonical branch) **are supported and
  expected** as the product's understanding of preferences evolves.
  Canonical-branch semantics live in a single TS constant
  `CANONICAL_BRANCHES` at
  `apps/web/src/lib/profile-tree/canonical-branches.ts` (single
  source of truth); JSONB rewrite of leaves on composition change
  uses the `migrate-leaves.ts` utility. Composition changes still
  require updating this PRD § 11.2 + § 6.3 (governance preserved);
  the architecture absorbs the change without scattered refactors.
  Detail and playbook: ADR-0011.
- Tree depth is variable. Leaves live at any depth. The UI renders
  up to a configured max depth; deeper levels reachable via
  drill-down. Both hierarchy AND max render depth are
  developer-editable at runtime.
- Every leaf preserves the user's original phrasing **verbatim**.
  No truncation, no reformatting, no canonicalisation that
  replaces the user's words.
- Every leaf carries a **direction polarity** — include or
  exclude. No polarity-less leaves.
- Collection is **conversational and adaptive**. No 16-step linear
  wizard.
- Ambiguous input triggers **agent-initiated clarification with a
  best-guess interpretation** before commit. No silent branch
  classification.
- Non-canonical claims land in **Other** with explicit chat
  acknowledgement. The agent **must not auto-create new canonical
  branches** from user input.
- Editing is always via Chat. No inline edit on the Profile Map.
- Switching between Chat view and Profile view is a **UI control**
  (tab / button / nav). Never a chat command interpreted by the
  LLM.
- There is **no finished state**. No "complete" flag that locks
  the profile.
- Company side stays predominantly **unstructured**. Hard filters
  remain structured; soft claims are LLM-judged. No pre-emptive
  company-facet tagging.
- All existing user preference data and conversation state is
  **wiped at ship**. No migration path.
- **L3 scoring runs in bounded batches and stops** at a configured
  candidate cap. No silent background continuation past the cap.
- **The L3 worker remains per-job consolidated structured output**
  (one LLM call per scored job). Per-claim-per-job is rejected on
  cost grounds and inconsistent with the existing
  `apps/worker/src/handlers/llm-scoring.ts` pattern.
- **The results page exposes exactly three user-driven continuation
  affordances** under the scored batch: extend, edit persistent
  profile, apply transient L2-filter overrides scoped to the
  current search only. Re-shaping, consolidating, or hiding any
  of the three requires reopening this PRD.
- **Transient L2-filter overrides never mutate** the profile tree,
  `conversation_message`, or `conversation_state`. They live only
  in the current search session and are discarded on page exit /
  new search / explicit clear.
- **Naming is locked.** UI sections = `Chat` and `Profile`.
  Profile-Map artefact inside Profile = `Profile Map`. **No
  user-facing brand name for the conversational process.** The
  agent is internally "the profile assistant"; this label is NOT
  surfaced in UI copy. Forbidden labels: `Onboarding`,
  `Interview`, any job-interview-adjacent phrasing.
- **Out of scope this overhaul.** Evidence-as-content (links,
  numbers, project artefacts on leaves) and application
  projection (role-specific CV / cover letter / answers). Locked
  per user 2026-05-06; belongs to a separate "from profile to
  application" cycle.

### 11.3 Invariants to preserve

- **Location preferences** (`user_profile.locationPreferences`,
  `preferredLocations`, `remotePreference`,
  `packages/ats-core/src/geo/*`,
  `apps/web/src/lib/search/filter-pipeline.ts` location-tier
  resolution) remain functional throughout MVP. If the final tree
  schema makes the location tier structure visibly inconsistent
  (different leaf shape, different direction handling, different
  Profile-Map rendering), the divergence MUST be flagged and
  fast-follow alignment scheduled. Do not permanently leave it
  divergent.
- **Role family classifier** (`packages/ats-core/src/classifier/*`)
  and its input contract (title + department) remain functional.
  The tree's Role branch must produce `targetTitles[]` in a shape
  the classifier accepts without modification, OR the classifier
  contract updates in the same sub-feature.
- **L1 → L2 → L3 funnel ordering**: cheap deterministic filters
  first; LLM-judge only on survivors. Do not move all filtering
  to LLM.
- **Evidence-phrase substring verification at L3.** Every
  per-claim `evidencePhrase` emitted by the L3 worker MUST be
  substring-verifiable against the actual job or company
  description text it references. The worker MUST reject or
  retry hallucinated phrases before persisting them on
  `job_match`. Hallucination at the explainability layer
  destroys trust; this check is not optional.
- **Transient L2-filter overlay isolation**: the per-search
  overlay applied via the "Change filters" affordance MUST NOT
  mutate the profile tree, `conversation_message`,
  `conversation_state`, or any persistent DB row. Implementation
  lives only in request-scoped state (query params, in-memory
  session, or short-lived cookie — downstream choice).
- **Worker-extracted job signals** (`job.{visaSponsorship,
  relocationPackage, workAuthRestriction, languageRequirements,
  travelPercent, securityClearance, shiftPattern,
  signalsExtractedAt, signalsExtractedFromHash}`) continue to be
  populated by the existing scoring worker on the same cadence.
  The soft-judge MAY read them as inputs but MUST NOT overwrite
  them outside the existing idempotent extraction path keyed on
  `description_hash` / `signalsExtractedFromHash`.
- **Auth, session, BYOK keys, ATS ingestion / polling / vendor
  extractors, `role_family`, `company`, `job` tables** —
  untouched, except `job_match` is extended per § 6.3 and new
  durable-signal columns on `job` MAY be ADDED under the existing
  pattern; existing signal columns are not reshaped or removed.
- **`synonym_group` table and
  `apps/web/src/lib/search/synonym-cache.ts`** — retained, may be
  extended; must not be removed. The tree's canonical tokens
  flow through synonym expansion at search time.
- **Process invariant.** Each sub-feature PR keeps the codebase
  compiling and `pnpm test` green at HEAD. Old code is removed in
  the same PR that replaces it. Hooks (typecheck + lint + tests)
  gate every PR.
- **BYOK invariant.** Per-job LLM calls remain user-funded via
  `user_api_key`. No platform-funded LLM usage.

### 11.4 Technical hints (optional, non-binding)

- Hint — **leaf schema sketch:** `{ claim: string, direction:
  'include' | 'exclude', canonical?: string[], note?: string,
  source_turn_id?: string, flagged_uncertain?: boolean,
  confidence?: number }`. Not binding. Evidence-as-content fields
  explicitly out of scope.
- Hint — **branch registry sketch:** `preference_branch` table
  with `{ slug, parent_slug, display_name, sort_order, description,
  active, config_json? }`. Top-level branches have NULL
  `parent_slug`; sub-branches point at a parent.
- Hint — **`app_config` keys:** `scoring.l3_candidate_cap`
  (default ≈ 100) caps L3 per search and doubles as the
  extend-batch increment. `ui.profile_map_max_depth` (default 3)
  caps rendered tree depth.
- Hint — **three affordance labels:** `Score more` (extend),
  `Change profile preferences` (persistent edit), `Change
  filters` (transient overlay). Polish allowed if semantic intent
  is preserved.
- Hint — **transient filter overlay dimensions:** start with the
  L2 dimensions currently read by `filter-pipeline.ts` (role
  family, seniority, location tiers, industry, remote
  preference). Query-string storage makes the overlay
  URL-sharable and survives page reload without persisting.
- Hint — **L3 schema extension:** widen
  `apps/worker/src/lib/scoring-schema.ts`'s structured-output
  schema with `claims: [{claimId, score, evidencePhrase}]`
  alongside existing RSLCD fields. One Claude Haiku 4.5 call per
  job continues to score everything in one structured response.
  Substring-verify every `evidencePhrase` against source
  description text; reject or retry hallucinations.
- Hint — **wipe + foundation sub-feature.** The first sub-feature
  in the roadmap is the natural carrier for: dropping
  `user_company_preference`, dropping flat fields on
  `user_profile`, removing `apps/web/src/lib/chatbot/*` and
  `apps/web/src/app/api/chatbot/save/route.ts`, scaffolding the
  tree schema and branch registry, leaving L2 / L3 reading the
  remaining fields (or stubbed) so `pnpm test` remains green at
  PR boundary.
- Hint — **canonical-branches TS constant.** Add
  `apps/web/src/lib/profile-tree/canonical-branches.ts` exporting
  `CANONICAL_BRANCHES: CanonicalBranchDef[]` where each entry
  carries declarative behaviour hooks: `slug`, `kind`,
  `displayName`, `description`, `l2Derivation?`,
  `synonymDimension?`, `acceptsSkillIntent?`, `matcherScope?`,
  `l3Soft?`. All hard-coupled call sites (`deriveL2Inputs`,
  conversation prompt-builder, L3 prompt-builder, `skillIntent`
  validator, exclusions/deal-breakers split, synonym dimension
  binding) read from this constant rather than hardcoding slug
  literals. Pairs with `migrate-leaves.ts` (JSONB rewrite for
  branch composition migrations). Detail and composition-change
  playbook: ADR-0011.

### 11.5 Verified during research

- L1/L2 SQL filter (`apps/web/src/lib/search/filter-pipeline.ts:43`)
  reads only `targetTitles`, `targetSeniority`, `remotePreference`,
  `locationPreferences` / `preferredLocations`, and `industries`.
  ~11 of 14 user-profile fields are dead at L2.
- L3 scoring worker (`apps/worker/src/handlers/llm-scoring.ts`,
  358 lines) is already per-job consolidated, calls Claude Haiku
  4.5 via Vercel AI SDK with a structured-output schema, writes
  `job_match` rows. The rewrite extends this; not greenfield.
- Bug reproduced on the test user's profile: filter pipeline
  emits dead strings like `'fintech (non-traditional banking)'`
  and `'product companies'` that match no company tag.
- Company tag vocabulary (top 40) has no concept of "product
  company" or "brand strength" — validates §8 Alternative C
  rejection.
- `user_profile.locationPreferences.tiers` is already structured
  in the reference pattern (with `originalText`,
  `qualitativeConstraint`, `scope.exclude`, `immigrationFlags`)
  on the test user's row — the generalised shape model.
- The `app_config` key-value table is the established home for
  tunable parameters.
- Nine-branch canonical set (§ 6.3) cross-checked against the 14
  current profile fields, the 16 existing chatbot steps, the test
  user's populated row, and external talent-product facets.
- Per-job consolidated structured-output L3 scoring is the
  industry default (per delegated subagent research).
  Per-claim-per-job is rare outside research benchmarks.
- pg-boss queue infrastructure (`FUTURE_QUEUES.llmScoring`) is in
  place.
- BYOK (`user_api_key`) is in place; per-job LLM-judge calls are
  economically viable for the solo user.
- Process constraint: hooks gate typecheck + lint per commit and
  `pnpm test` per PR. No prod users → schema and API can be broken
  freely.
