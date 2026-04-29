# Preference Tree Profile

Status: **Draft v1** | Date: 2026-04-24 | Owner: vasd85

> **Reader:** this PRD is written for a downstream agent (planner,
> architect, or implementer) — not a human. Sections are fixed in name
> and order; index by section number when needed. Decisions are
> declarative. "N/A" is a valid value for a section; empty is not.

---

## 0. Inputs & pointers

- **Repo:** `/Users/vasd85/repo/personal-projects/global-job-search`
- **Relevant existing docs:**
  - `docs/business-logic-job-search.md` — current collection + matching logic (Draft v3, Section 2 "Company Preferences" and Section 3 "Job Preferences" are directly replaced by this PRD).
  - `docs/architecture-location-matching.md` — reference implementation of the tier-based preference pattern this PRD generalizes.
- **Schema:** `packages/db/src/schema.ts` re-exported via `apps/web/src/lib/db/schema.ts`. Tables touched: `user_profile`, `user_company_preference`, `conversation_state`, `conversation_message`, `synonym_group`, `job_match`.
- **Related code paths:**
  - `apps/web/src/lib/chatbot/engine.ts` — current step-driven engine (replaced).
  - `apps/web/src/lib/chatbot/steps.ts` — 16-step linear taxonomy (replaced).
  - `apps/web/src/lib/chatbot/schemas.ts` — per-step flat Zod extraction schemas (replaced).
  - `apps/web/src/lib/chatbot/state.ts` — draft state management.
  - `apps/web/src/app/api/chatbot/save/route.ts` — flat-field persistence (replaced).
  - `apps/web/src/app/api/chatbot/`* — conversation endpoints.
  - `apps/web/src/lib/llm/prompts.ts` — extraction / clarification / summary prompts (rewritten).
  - `apps/web/src/lib/search/filter-pipeline.ts` — L2 SQL filter, consumes profile fields; `normalizeIndustryTerms` demonstrates current synonym bridging.
  - `packages/ats-core/src/geo/*` — location tier resolver (reference pattern, untouched in MVP).
  - `packages/ats-core/src/classifier/*` — role family classifier (input contract must be preserved).
- **Example failure log:** `temp.log` at repo root (search request for user `KuyACZ7anp11iamniFQ9iXkrBZG44f6z` showing unmatchable industry values propagated into SQL).
- **DB access for the downstream agent:** `mcp__postgres__execute_sql` (dbhub, read-only).

---

## 1. Problem

### 1.1 User problem

The primary user (a senior engineer building a rich, nuanced mental model of the role and company they want) describes their preferences in natural, compound statements that mix multiple conceptual dimensions in a single sentence. Example from `temp.log`, user `KuyACZ7anp11iamniFQ9iXkrBZG44f6z`, "industries" step:

> "Web3/blockchain/crypto, biotech, fintech (but not a traditional banking), Any product companies that have their own bright product"

The current 16-step chatbot asks "what industries interest you?" and extracts a flat `string[]` for a single column. The LLM honestly tries to fit everything into that column:

- `"Web3/blockchain/crypto"` — survives, matches via synonym expansion.
- `"Biotech"` — survives.
- `"Fintech (non-traditional banking)"` — the qualifier collapses into parenthetical noise; never matches any company industry tag.
- `"Product companies"` — not an industry. No company in the DB is tagged `product companies`. Dead in SQL.

The user's intent was split across four conceptual types (pure industry, industry-with-exclusion, company-type, brand-attribute) but there is only one target field. Three out of four intents are either lost or disfigured.

### 1.2 Business problem

The product mission is matching users to their dream jobs. Fidelity of user preference capture is the direct upstream input to match quality. Two compounding issues today:

1. Non-trivial preferences are lost or disfigured at capture because the destination schema is flat per dimension.
2. 11 of 14 user-preference fields currently in the schema are never read by the L2 SQL filter. They exist in the database but do not narrow the candidate set — they only feed the L3 LLM scoring prompt. Improving collection alone does not help until matching also reads the new structure.

Result: even sophisticated users cannot express sophisticated preferences, and even if they could, most of the profile sits unused.

### 1.3 Why now

- The project is in the experimental stage, solo user, no production data protection concerns — architectural rewrites are safe.
- The `user_profile.location_preferences` JSONB tier schema (shipped earlier, with `originalText`, `qualitativeConstraint`, `scope.exclude`) already demonstrates a richer pattern that preserves user phrasing and supports qualified claims. The pattern is not hypothetical — it works in production, in this same app.
- BYOK (per `user_api_key` table, see business-logic doc §13.1) is in place, so LLM-based soft matching is already economically viable.

---

## 2. User & context

### 2.1 Target user

Solo user / product owner: senior QA engineer researching job opportunities, evaluating the product on their own profile. The user is technically deep, has a specific and highly qualified taste ("Web3 testing, not manual regression, not traditional banking, product-first companies"), and has no tolerance for dropped signal. They reopen and refine their profile frequently.

### 2.2 Jobs-to-be-done

"When I tell the system what kind of role and company I want, I want every nuance I mention to be captured and remain matchable — including exclusions, qualifiers, and subjective criteria — so I never have to trade between speaking freely and speaking in the system's vocabulary."

"When I return to my profile, I want to see everything the system knows about me at a glance and be able to correct anything through conversation, without re-doing onboarding from scratch."

### 2.3 Scenarios

- **Scenario A — first conversation from scratch.** User signs in after a DB wipe. The agent opens with a broad baseline question. The user types a compound response including a qualified industry ("fintech but not banking"), a company-type attribute ("product companies with a bright brand"), and a technical skill list. The agent decomposes the response, commits unambiguous claims to their branches with preserved phrasing, and asks a clarification for the ambiguous company-type claim ("I think you mean a company attribute, not an industry — correct, or did you mean something else?"). On user confirmation, the claim lands in the correct branch with `direction: include` and original phrasing preserved.
- **Scenario B — refining after seeing results.** User runs search, gets 27 matches, 5 of which are outsourcing / staffing companies. User opens the chat: "the outsourcing ones — remove them, I don't want staffing companies." The agent updates the exclusions branch with a new leaf `{claim: "outsourcing / staffing companies", direction: exclude}` and the search re-runs. No full re-conversation required.
- **Scenario C — viewing the profile.** User opens the profile view; a MindMap renders with branches expanded to depth 2-3. Each leaf shows the original phrase and a direction indicator (include / exclude / flagged-uncertain). The user spots that "gaming" was bucketed as exclusion when they had only said "no gambling". They return to chat: "I'm fine with gaming, only gambling is out." The agent adjusts the leaf.

---

## 3. Goals & non-goals

### 3.1 Goals

- G1 — Every user-stated preference is represented in the profile tree with the original phrasing preserved verbatim on a leaf, with an explicit `direction` (include | exclude).
- G2 — Ambiguous user statements are resolved explicitly via agent-initiated clarification (best-guess interpretation phrased as a question) before a claim is committed to a branch.
- G3 — Soft / subjective claims (e.g., "bright brand", "product-first culture") are matchable against job and company descriptions via LLM-judge, no longer dead data.
- G4 — User can view every known characteristic of their profile in a single MindMap rendering (depth 2-3), with leaf text matching their own words.
- G5 — The collection process has no "completed" state. The user can refine, add, remove, or redirect any leaf at any time through the same chat interface.
- G6 — Hard filters (location, work authorization, compensation floor, role family, seniority) remain structured and cheap, preserving the L1/L2 funnel performance.

### 3.2 Non-goals

- NG1 — Pre-emptively rewriting the location preference subsystem. Location remains functional in its current form for MVP. See §11.3 for the alignment invariant.
- NG2 — Migrating existing `user_profile` / `user_company_preference` rows into the new schema. All existing user preference data and conversation state is wiped on ship.
- NG3 — Proactive re-engagement (agent initiating conversation after N days of silence, after N job rejections, etc.).
- NG4 — Critique loops (saved / dismissed job actions automatically mutating the tree).
- NG5 — Structured facet tagging on the company / job side (`is_product_company`, `brand_strength`, culture tags). Company side stays predominantly unstructured; soft matching is LLM-judged over raw description text.
- NG6 — Rich MindMap interactions (drag, reorder, theming, multi-select). Depth-2-3 tree render with direction indicator is sufficient.
- NG7 — Paid tier / platform-funded LLM usage. BYOK as per business-logic doc §13.1.

---

## 4. Success metrics

Verification is manual and one-shot for MVP — the solo user performs a full cycle (profile conversation → DB population with companies and jobs → search and match → hand benchmark against direct SQL exploration). Metrics are defined accordingly.


| Metric                                                                                                                                                | Type    | Target                                                                                                          | Measured how                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Every user statement from the transcript appears as a leaf in the profile tree with original phrasing preserved verbatim                              | leading | 100%                                                                                                            | Side-by-side comparison of `conversation_message` log (role=user) vs saved profile tree; manual SELECT + eyeball          |
| No meaningless / unmatchable values remain in structured fields (e.g., strings like `"product companies"` in an industries-only field)                | leading | 0                                                                                                               | Manual SELECT on the tree JSONB and visual inspection                                                                     |
| Ambiguous statements trigger at least one agent clarification turn before a claim is committed                                                        | leading | 100% of ambiguous statements in the test session                                                                | Manual review of `conversation_message` log — count user ambiguous statements vs subsequent assistant clarification turns |
| Manual-benchmark overlap: user hand-picks relevant jobs from direct SQL browsing of `job` table for their profile; compare to system's top-20 matches | lagging | System top-20 contains ≥80% of the hand-picked relevant set                                                     | Hand SQL queries vs `/api/search` output; manual overlap count                                                            |
| Soft claims produce a substring-verifiable `evidence_phrase` in each `job_match` they contribute to                                                   | lagging | Every soft claim that contributed to a match shows an evidence phrase present in the job or company description | Manual review of `job_match` records vs source description text                                                           |


**Kill criteria** (after a full-cycle manual test):

- > 10% of user-stated preferences are lost or assigned to a semantically wrong branch, OR
- Manual-benchmark overlap is below 50%, OR
- The ambiguity-clarification loop fires on more than ~30% of user turns, making the conversation feel like an interrogation.

If any of these fire, roll back and reconsider architecture — options include: drop the branch classification at ingest entirely and move to pure LLM-judge over unstructured claims, OR reshape the branching taxonomy, OR adjust ambiguity thresholds before a rebuild.

---

## 5. Current state

### 5.1 Existing behavior

- `apps/web/src/lib/chatbot/steps.ts` defines 16 sequential steps (target_roles → target_seniority → core_skills → growth_skills → avoid_skills → deal_breakers → salary → location → industries → company_sizes → company_stages → work_format → hq_geographies → product_types → exclusions → dimension_weights → review).
- `apps/web/src/lib/chatbot/engine.ts` (`processMessage`) advances steps one at a time. Each free-text / hybrid step calls the LLM with a per-step Zod extraction schema from `apps/web/src/lib/chatbot/schemas.ts`; the schema returns `{ <field>: T[], confidence, clarificationNeeded, clarificationQuestion? }`.
- `MAX_CLARIFICATIONS = 2` caps clarification rounds per step before force-accepting the extraction (`engine.ts:19`).
- `apps/web/src/app/api/chatbot/save/route.ts` commits the accumulated draft into `user_profile` + `user_company_preference` atomically on "save & finalize".
- `apps/web/src/lib/search/filter-pipeline.ts` (`searchJobs`) reads: `target_titles`, `target_seniority`, `location_preferences`, `preferred_industries` (from `user_profile`) and `industries` (from `user_company_preference`). Only `industries`, `target_titles` (via role family classifier), `target_seniority`, and `location_preferences` (via geo resolver) actually influence the SQL pre-filter or in-code filter. Everything else is dead data at L2.
- `normalizeIndustryTerms` (filter-pipeline.ts:226) splits chatbot labels on `/`, lowercases, then expands via `synonym_group` table (`apps/web/src/lib/search/synonym-cache.ts`).
- `user_profile.location_preferences` JSONB uses a ranked tier schema with `originalText`, `qualitativeConstraint`, `scope.exclude`, and `immigrationFlags`. This is the richer pattern being generalized.

### 5.2 Baseline data

All numbers verified during research via `mcp__postgres__execute_sql`.

- **User's current saved industries** (user `KuyACZ7anp11iamniFQ9iXkrBZG44f6z`):
  ```
  ["Web3/blockchain/crypto", "Biotech",
   "Fintech (non-traditional banking)", "Product companies"]
  ```
  2 of 4 entries are unmatchable against any existing company tag.
  SQL: `SELECT industries FROM user_company_preference WHERE user_id = '...';`
- **SQL terms the filter actually emits** (from `temp.log` line 181-197):
  ```
  ['web3','blockchain','defi','decentralized_finance','crypto',
   'cryptocurrency','bitcoin','digital_currency','exchange',
   'crypto_exchange','digital_exchange','biotech',
   'fintech (non-traditional banking)','product companies']
  ```
  Last two contribute zero matches.
- **Top company industry tags** (lowercase tokens, top 20):
`fintech (91), blockchain (35), b2b_saas (31), payment_processing (26), web3 (23), saas (23), developer_tools (23), cryptocurrency (18), infrastructure (15), crypto (9), lending (9), ai (9), payments (9), security (8), biotech (8), defi (7), hardware (7), gaming (6), embedded_finance (5), exchange (5)`.
No tag captures "product company" or "brand strength" concepts — validates §8 alternative C rejection.
SQL: `SELECT tag, COUNT(*) FROM (SELECT unnest(industry) as tag FROM company WHERE industry IS NOT NULL) GROUP BY tag ORDER BY count DESC LIMIT 40;`
- **Synonym group coverage for `industry` dimension:** 15 groups, 48 total synonyms.
SQL: `SELECT dimension, COUNT(*), SUM(array_length(synonyms, 1)) FROM synonym_group GROUP BY dimension;`
- **User's `exclusions` field** (same user):
  ```
  ["gambling", "gaming", "traditional banking", "defense industry"]
  ```
  Note: "traditional banking" WAS captured correctly in exclusions — so extraction does split signals in some cases. The problem is not that extraction is universally broken, but that the industries bucket has no place to host qualified or non-industry claims, and the relation between a positive claim ("fintech") and its exclusion ("but not traditional banking") is severed across two disconnected fields.
- **Fields collected but not read by L2 filter:** `core_skills`, `growth_skills`, `avoid_skills`, `deal_breakers`, `exclusions`, `product_types`, `hq_geographies`, `company_sizes`, `company_stages`, `work_format`, `min_salary`, `target_salary`, `preferred_industries` (duplicate of `user_company_preference.industries`). These are surfaced in the L3 LLM scoring prompt but do not prune candidates at L1 or L2.

---

## 6. Proposed solution

### 6.1 Conceptual approach

The user's profile becomes a **tree**. The tree has two layers:

1. **Fixed top-level branches** — a small taxonomy of preference dimensions (role, skills, industries, company attributes, compensation, location, exclusions, and so on). Branches are the structural contract both with the user (they see them in the MindMap view) and with the matching layer (hard filters derive from specific branches).
2. **Free-form leaves** — every leaf is a *claim*. A claim preserves the user's original phrasing verbatim and carries a direction polarity (include vs exclude) and an optional bag of canonical tokens useful for structured matching (e.g., lowercase industry tags). Claims MAY carry a qualifier note (e.g., "but not banking" captured as context) and an uncertainty marker when committed via soft-exit. (Leaf schema sketch in §11.4.)

Collection becomes a **conversation**, not a scripted wizard:

- The agent opens with a broad baseline question that invites the user to speak across multiple dimensions in one breath, then parses the response and routes each decomposed claim to the appropriate branch. Unambiguous claims commit directly. Ambiguous ones (fit multiple branches, or fit none cleanly) trigger an **agent-initiated clarification**: the agent states its best-guess interpretation as a question and waits before committing. If the user pushes back or the clarification budget is exhausted, the agent commits to its best-guess branch with the uncertainty marker set — the MindMap renders such leaves distinctly.
- The agent adapts to what the user volunteers: follows deep threads, surfaces neglected branches after the active thread settles.
- There is no "finished" state. The same Chat surface is the entry point for refinement later ("Remove gambling from exclusions", "Actually I'm fine with contract roles") — the agent updates leaves in place.

Matching stays **hybrid**:

- **Hard filters** remain structured and cheap at L1/L2: location (existing tier resolver), salary floor, work-auth, role family, seniority. These read from derived columns computed from the tree at save time, or via a live tree walk (downstream choice).
- **Soft claims** are scored at L3 by an LLM-judge that reads the raw job / company description alongside each claim and returns a per-claim score plus a substring-verifiable evidence phrase that powers UI explainability. Exclusion claims route to anti-match (penalize or zero the score when the evidence indicates the claim is satisfied).
- **L3 is a bounded batch: the judge scores up to a configured candidate cap from L2's output (ordering heuristic — downstream choice) and stops.** No silent background continuation of the remainder — protecting the BYOK user's LLM tokens is a primary constraint.
- **When candidates remain, the user drives what happens next.** At the bottom of the results, three affordances are surfaced (labels in §11.4): (a) extend the scored batch to the next group (repeatable until the pool is exhausted), (b) edit persistent preferences (returns to Profile + Chat; propagates to future searches), (c) apply transient L2 filter overrides in a per-search side panel — overrides apply only to this search and are NEVER persisted into the Profile tree. Leaving the page, starting a new search, or clearing the overlay discards the overlay.
- **Transient overrides and the Profile tree are disjoint.** The tree is the source of truth for persistent preferences; transient overrides are a per-search scratch pad letting the user say "in this one search, relax my 'no banking' exclusion" without corrupting the profile.

**Profile view** is a MindMap rendering at the configured max depth (default ≈ 2-3): top-level branches expanded one level, leaves readable as the user's own words, direction visually differentiated. No inline edit — clicking opens Chat with context.

### 6.2 User flow

Happy path — first conversation from scratch:

1. User signs in. The profile MindMap is empty. Chat is active.
2. Agent: "Tell me what kind of role and company you're looking for — you can say whatever comes to mind, I'll sort it out."
3. User types a compound natural-language response spanning role, skills, industries, and company attributes.
4. Agent parses. For each extracted claim: unambiguous → committed to its branch with preserved phrasing and direction. Ambiguous → agent formulates a best-guess clarification question.
5. User answers clarifications. Claims land in branches.
6. Agent summarizes what has landed ("I've placed …") and nudges neglected branches: "You haven't mentioned compensation — want to talk about it now or later?"
7. User switches to the Profile view at any moment **via a UI control** (tab / nav button) — not by a chat command. The MindMap renders the current tree at depth 2-3, leaves labeled with the user's own phrasing, direction-differentiated (include / exclude / flagged-uncertain). The Profile view is view-only.
8. When the user wants to change something they see on the map (wrong branch, wrong direction, claim to remove), they **switch back to Chat via the same UI control** and tell the agent what to change ("Remove gambling from exclusions" / "I actually don't care about company size"). Editing is always via conversation; the MindMap has no inline edit.
9. User can ask for a search at any point. Search pipeline reads the tree; L1/L2 use hard-filter derivations; L3 LLM-judge scores the top-N soft claims subject to the per-search candidate cap (§6.1), returning per-claim evidence phrases.
10. At the bottom of the scored batch, three affordances are always visible (labels in §11.4): extend the scored batch, edit persistent preferences (returns to Profile + Chat), or apply transient filters (opens a per-search L2-overlay panel that never persists).
11. If the user uses the transient filter panel, results update in place with the overlay applied. The Profile tree is untouched. Leaving the page or starting a new search clears the overlay.

**Returning to refine:** the user opens the same Chat surface ("The outsourcing companies in my results — filter them out."), the agent appends a new leaf to the Exclusions branch with verbatim phrasing, exclude direction, canonical tokens derived, and a source-turn reference, and the search is re-run (or lazily re-runs on the next request).

**Unhappy branches:**

- **Agent misinterprets.** User rejects the clarification ("No, I meant an industry"). Agent reformulates with the corrected branch or lets the user name it directly.
- **User pushes back on clarifications.** When the clarification budget is spent, the agent commits to its best-guess branch with the uncertainty marker set; the MindMap surfaces such leaves distinctly.
- **No matching jobs for a claim.** Results surface "No job descriptions reference ''". User can relax, drop, or keep the claim.
- **User views profile mid-conversation.** MindMap renders the partial tree; empty branches render empty. User returns to Chat to fill them.
- **Contradicting claim added later.** ("I want startups" week 1, "actually scaleups" week 4.) For MVP, the tree holds both and the judge reconciles at match time; visual conflict surfacing is fast-follow.

### 6.3 Entities & state changes

**Canonical top-level branches (MVP).** The set below is the committed starting taxonomy. Branch definitions live in a developer-editable registry so the canonical set can evolve without redeploy (same pattern as the existing `role_family` and `synonym_group` tables; registry shape is a downstream decision — see §11.4). Branches are **not hardcoded** in application code.

1. **Role** — titles, seniority, role family. Feeds the L2 role-family classifier. Hard filter.
2. **Skills** — what the user has and wants to keep, what they want to grow into, what they want to avoid. Three user stances inside this branch; encoding of the grow-vs-keep distinction is a downstream choice (see §11.4 hint).
3. **Compensation** — minimum acceptable, target, currency. Hard filter at L1 when min is specified.
4. **Location** — retains the existing ranked-tier structure with `scope`, `workFormats`, `immigrationFlags`, `qualitativeConstraint`, `originalText`. Work format per tier and immigration/visa/relocation live here (not in a separate branch) to avoid redundancy with the existing location model.
5. **Industry** — domain of the company (fintech, biotech, web3, etc.). Leaves carry both user phrasing and optional canonical tokens expanded via `synonym_group` for L2 SQL overlap. Qualifiers (e.g., "fintech but not banking") are preserved on the leaf and routed to the LLM-judge at L3.
6. **Company Attributes** — soft qualitative character: size, stage, funding, HQ geography, product-vs-services, brand strength, culture, work-format culture. Scored at L3 by the LLM-judge against raw company/job description text.
7. **Exclusions** — cross-cutting anti-matches targeting **the company** (industries / company types the user refuses to work with, e.g., "gambling", "defense industry", "outsourcing / staffing"). Apply at company level — all jobs at a matched company are filtered out.
8. **Deal-breakers** — hard anti-matches targeting **the job's own requirements** (e.g., "requires security clearance", "travel >50%", "contract only"). Zero the match for a specific job regardless of other scores.
9. **Other** — catch-all for claims the agent could not confidently place in any canonical branch. See non-canonical policy below.

**Tree depth is variable.** Each canonical branch MAY have sub-branches; sub-branches MAY have further sub-branches; leaves live at any depth. The developer-editable registry stores the full **hierarchy**, not just the top-level set. For example: the Skills branch naturally decomposes into sub-branches for "keep", "grow into", and "avoid"; Company Attributes decomposes into size, stage, funding, HQ geography, product-vs-services, brand, culture; Location already uses a nested ranked-tier structure. Both the **hierarchy definition** AND the **UI max render depth** are developer-editable at runtime (default ≈ 2-3 levels shown, deeper levels reachable via drill-down).

**Non-canonical-input policy.** When a user claim fits no canonical branch even after clarification, the agent places it in the **Other** branch with preserved phrasing and direction, explicitly acknowledges the placement in chat, and renders Other distinctly in the MindMap. The agent **MUST NOT auto-create new canonical branches from user input** — adding / merging / splitting canonical branches is a developer action, informed over time by the aggregate of Other-branch leaves across sessions.

**General entity changes:**

- **New:** tree-shaped preference profile — top-level branches plus leaves per branch. Each leaf carries verbatim user phrasing, direction polarity, optional canonical tokens, optional qualifier note, optional uncertainty marker (set on soft-exit commits), and a reference into `conversation_message` back to the originating user turn. Leaf schema sketch in §11.4.
- **New on matching:** per-claim score and a substring-verifiable evidence phrase on each `job_match` soft-claim contribution. Existing `evidence_quotes` / `match_reason` columns MAY be extended or restructured — downstream choice.
- **Removed (as direct user-editable schema columns):** `user_company_preference.industries`, `.company_sizes`, `.company_stages`, `.work_format`, `.hq_geographies`, `.product_types`, `.exclusions`, and on `user_profile`: `core_skills`, `growth_skills`, `avoid_skills`, `deal_breakers`, `preferred_industries`. Some MAY remain as derived denormalized columns populated from the tree for L2 convenience — the canonical truth is the tree.
- **Retained:** `user_profile.location_preferences` / `preferred_locations` / `remote_preference` (untouched in MVP, see §11.3); `conversation_state` + `conversation_message` (now the ongoing profile conversation log, not only an onboarding transcript; minor schema extension possible); `synonym_group` (canonical-token expansion utility); `role_family`, `job`, `company`, ingestion / polling tables (untouched).

### 6.4 Interactions with existing features

- **Chatbot engine, steps, schemas, state, save route** (`apps/web/src/lib/chatbot/*`, `apps/web/src/app/api/chatbot/save/route.ts`) and their tests — replaced by the conversational agent. No "finalize" endpoint; the tree updates incrementally as the conversation progresses.
- **LLM prompts** (`apps/web/src/lib/llm/prompts.ts`): `EXTRACTION_SYSTEM_PROMPT`, `SUMMARY_SYSTEM_PROMPT`, `CLARIFICATION_SYSTEM_PROMPT`, `LOCATION_EXTRACTION_GUIDANCE` — rewritten / restructured for claim decomposition. `ROLE_FAMILY_EXPANSION_SYSTEM_PROMPT` can likely remain.
- **Filter pipeline (`filter-pipeline.ts`):** L2 stays. Its inputs (target titles, seniority, canonical industry tokens, remote-preference flag, location tiers) must be available via direct tree walk or derived columns. `normalizeIndustryTerms` / synonym expansion stays useful.
- **Role family classifier (`packages/ats-core/src/classifier/*`) and geo matching (`packages/ats-core/src/geo/*`):** unchanged in MVP. The tree's role branch must expose `targetTitles[]` and seniority in the classifier's current shape; location resolver continues consuming `user_profile.location_preferences`.
- **L3 LLM scoring (worker):** extended with (a) per-claim scoring with evidence phrases alongside the dimensional RSLCD scores (aggregation keep or restructure — downstream decides); (b) enforcement of the per-search L3 candidate cap — score only top-N from L2's output, mark the rest as "beyond budget".
- **Durable LLM conclusions on `job` rows:** retained (signal columns in §11.3). The soft-judge MAY read them and MAY add new durable conclusions using the same idempotent-on-content-hash pattern.
- **Untouched in MVP:** ingestion / polling / ATS detection; auth, sessions, user API keys.

---

## 7. MVP scope

### 7.1 In the first ship

- **Tree-shaped profile data model with variable depth** (top-level branches + sub-branches + leaves at any depth) plus the **canonical top-level taxonomy** (the 9 branches enumerated in §6.3), both stored in a developer-editable registry so branches / sub-branches and the UI max render depth are adjustable at runtime.
- **Non-canonical-input policy** implemented: Other branch, explicit agent acknowledgment, no auto-creation of canonical branches.
- **Conversational agent** replacing STEPS: baseline opener, adaptive thread following, nudges for neglected branches, ambiguity-clarification with best-guess phrasing, soft-exit with the uncertainty marker set on the committed leaf.
- **Two UI views** — Chat and Profile — with a UI-level toggle. The MindMap (the Profile Map) lives inside Profile and renders up to the configured max depth; Profile is view-only, all edits happen in Chat.
- **Hybrid matcher:** L2 SQL filter reads tree-derived inputs (role family, seniority, canonical industry tokens, remote flag, location tiers — derivations preserved in shape); L3 LLM-judge scores soft claims per job with substring-verifiable evidence phrases; L3 bounded-batch scoring stops at a configured candidate cap with no silent background continuation.
- **Three results-page affordances** (under the scored batch): extend the scored batch (repeatable), edit persistent preferences (Profile + Chat), apply transient filters (per-search L2 overlay, never persisted). Copy labels in §11.4.
- **Transient L2 filter overlay** — a per-search scratch pad for overriding L2 dimensions without touching the Profile tree. Cleared on leaving the page or starting a new search.
- Durable LLM conclusions on jobs (columns enumerated in §11.3, plus provenance) remain populated by the scoring worker — no functional change to that extraction path.
- Complete wipe of existing user preference data and conversation state at ship time. No migration.
- **Naming:** two UI sections — `Chat` and `Profile`. The MindMap artifact inside Profile is called `Profile Map`. **No user-facing brand name for the process.** No "Onboarding", no "Interview". Concept labels fixed; copy polish allowed.

### 7.2 Fast follow (after validation)

- Location alignment audit: once the new tree shape is stable, open the `location_preferences` tier structure and the new tree side by side. If location leaves look structurally divergent (different shape, different direction handling, different view rendering), align location into the common model. This is **required if divergence is structural** — not an escape hatch. Deferred from MVP only to reduce the blast radius of the first ship.
- Proactive re-engagement: agent surfaces gaps, contradictions, or stale leaves after N days / N rejections.
- Critique loop: dismissed / saved job signals mutate the tree (e.g., dismissing five fintech jobs → agent asks "should I deprioritize fintech?").
- Compaction / digest: long-running conversations produce a digest leaf summary; raw log retained.
- MindMap interactions: click-to-edit opens chat with the right context; visual conflict surfacing; collapse / expand defaults per branch.
- Conflict surfacing: contradictory claims in the same branch get flagged for user review.

### 7.3 Maybe-never

- Mirror company-side preference tree. Rejected — §8 Alternative C.
- Auto-seeding the profile from LinkedIn / resume imports. Orthogonal, separate PRD.
- Multi-user / collaborative profile editing.
- Platform-funded LLM usage (non-BYOK).

---

## 8. Alternatives considered

### Alternative A — Multi-stage filtering: deterministic normalizer first, LLM cleanup on residue

Why considered: raised by the user during Phase 1 as one possible direction, keeps the current step-based engine intact, minimal surface change.

Why rejected: treats the symptom, not the cause. The root problem is that the destination schema is a flat `string[]` per dimension — there is no column to hold "fintech but not banking" as a single coherent claim, and "product companies" has no place at all. Even perfect normalization cannot route a claim to a branch that does not exist. A residue-LLM pass adds complexity and a second model call without solving the structural loss of signal.

### Alternative B — Fully unstructured: store user input verbatim, match via LLM-judge over raw transcript

Why considered: maximum flexibility; zero classification at ingest; closely matches subagent research pattern 5 (log + digest).

Why rejected: hard filters have no cheap path. Location, salary, work-auth, seniority need to stay structured at L1/L2 to keep search fast. Match cost balloons — every L3 pass reads the full transcript per candidate job. And the user explicitly wants to *see* their profile as a structured object (MindMap, §3.1 G4) — "profile as transcript" is not a viewable artifact at a glance.

### Alternative C — Mirror user tree and company tree (symmetric facets)

Why considered: symmetric structures simplify the matching algorithm to a tree-vs-tree diff. Clean conceptually.

Why rejected: requires heavy company-side enrichment — manually or LLM-tagging every company in the DB against a fixed attribute schema (`is_product_company`, `brand_strength`, `culture_type`, etc.). Vocabulary lock-in: a new attribute a user invents has no matching slot on the company side until that side is re-tagged. The user explicitly loosened the symmetry requirement in Phase 3 ("структура может быть разной"). The chosen hybrid path trades deterministic matching on soft criteria for flexibility and lower ingest cost.

---

## 9. Risks & trade-offs

### 9.1 Product risks

- **Over-clarification fatigue.** If the agent asks "did you mean X or Y?" on too many turns, the conversation feels like an interrogation. Mitigation: clarification budget per ambiguous claim; soft-exit with the uncertainty marker. Kill criterion in §4 tracks this.
- **Profile drift / self-contradiction over time.** Without a finished state, the tree accumulates contradictions. MVP accepts this — conflicts are surfaced to the LLM-judge at match time; visual conflict surfacing is fast-follow.
- **MindMap misplacement damaging trust.** If the agent bucketed a claim into the wrong branch and the user doesn't notice, the mistake persists. Mitigation: preserved original phrasing on every leaf + distinct rendering of uncertainty-flagged leaves makes misplacement visible.
- **LLM-judge hallucinated evidence.** Judge returns a plausible-looking evidence phrase that isn't actually in the source text. Mitigation: evidence phrases must be substring-verifiable against the job or company description; implementation must check.
- **Scope-induced broken state.** "Everything except location" is a large rewrite; a half-migrated app is unusable. Mitigation: solo user, no prod — ship as a single atomic cut, not incrementally behind flags.
- **Derivation brittleness.** L2 SQL needs canonical tokens / target titles / seniority from the tree. If derivation is flaky, search results degrade silently. Mitigation: test the derivation layer explicitly; surface "no canonical form derived" in logs.

### 9.2 Business risks

N/A — no users beyond the owner, no revenue exposure, no competitive positioning at this stage.

### 9.3 Dependencies & assumptions

- Anthropic API (BYOK) remains available. Per-claim / per-job LLM-judge calls must stay economically viable for the solo user. If token pricing changes materially, soft matching strategy must be re-costed.
- `location_preferences.tiers` schema is stable enough to leave untouched in MVP. If it turns out to have bugs the new system depends on, those become MVP-scope.
- `synonym_group` + `role_family` tables and the L2 classifier / geo modules remain stable. New tree must derive inputs compatible with their existing contracts, or those contracts must be updated in the same cut.
- Job descriptions are present in the DB for jobs that should be soft-matched. Ashby / SmartRecruiters use lazy description fetch (business-logic doc §D9). Soft claims on jobs without descriptions will have no signal — acceptable for MVP, surfaced in UI as "no description available".
- Conversation endpoints (`apps/web/src/app/api/chatbot/*`) can be restructured without breaking auth / session flows.

---

## 10. Open questions

- Persistence form of the tree and storage form of the canonical branch registry (JSONB vs normalized table vs log-plus-digest for the tree; DB table vs `app_config` JSONB vs TS constant for the registry). Locked: both developer-editable without redeploy.
- MindMap renderer / library choice (react-flow, markmap, elk, custom).
- Ambiguity-clarification budget (current `MAX_CLARIFICATIONS = 2` is a starting reference).
- Whether L3 scoring keeps the RSLCD dimensional summary or collapses fully to per-claim scores.
- MindMap visual language for direction states and the Other branch.
- Whether denormalized columns derived from the tree are persisted in the DB or computed live at query time.
- How the soft-judge surfaces "the job description does not mention this claim at all" — neutral score, zero, penalty, or skip.
- L3 cap ordering heuristic (recency / L2 score / per-branch balance / …), default cap value, default extend-batch increment.
- Default UI max render depth for the Profile Map; whether deeper levels are hidden until drill-in or shown collapsed with a visible count.
- Exact set of L2 dimensions exposed in the transient-filter overlay (role family / seniority / location / industry are certain; salary / work-format / visa — in or out?), and storage form of the overlay (query string / session / cookie).
- How to surface the empty-tree state in the Profile Map UX (empty MindMap / placeholder illustration / redirect to Chat).

---

## 11. Contract with the downstream agent

### 11.1 Decisions the agent owns

- DB shape for the tree (JSONB on `user_profile`, a dedicated claim table, or log-plus-digest) and DB/config form of the developer-editable branch registry.
- Whether and how to persist derived denormalized columns (target titles, canonical industry tokens, seniority, remote flag) vs computing live.
- MindMap renderer / library choice and layout algorithm; concrete UI affordance for the Chat ↔ Profile toggle (mechanism as a UI control is locked, shape is the agent's call).
- Conversational agent internals: prompt architecture, LLM model choice per turn, structured outputs vs tool-calls vs multi-step extraction, and the exact copy of opener / clarification / nudge / Other-acknowledgment templates.
- Ambiguity clarification budget and soft-exit threshold.
- Synonym-group integration: extend existing dimensions, add dimensions per branch, or bypass for branches where canonical tokens are not meaningful.
- Whether L3 scoring keeps the RSLCD aggregate, collapses to per-claim, or both; the L3 candidate-cap ordering heuristic; default cap value; extend-batch increment size.
- Default UI max render depth for the Profile Map and the drill-down interaction for deeper levels.
- UI shape of the transient-filter side panel (L2 dimensions exposed, layout, reset behavior) and the storage form of the overlay (query string / session / cookie).
- Encoding of Skills sub-intent (grow vs keep) inside the universal leaf schema — see §11.4 hint.
- Test architecture for the new engine and observability hooks (drift detection, clarification rate, evidence-phrase hallucination rate, L3 over-cap incidence).

### 11.2 Decisions that are locked

Any change to the following requires reopening this PRD with the user.

- The profile data model is a **tree with fixed top-level branches and free-form leaves**. Not flat arrays, not pure transcript, not mirror-symmetric with companies.
- Every leaf preserves the user's original phrasing **verbatim**. No truncation, no reformatting, no "canonicalization" that replaces the user's words.
- Every leaf carries a **direction polarity** — it either represents something the user wants more of or something the user wants excluded. No polarity-less leaves.
- Collection is **conversational** and **adaptive**. No 16-step linear wizard.
- Ambiguous input triggers **agent-initiated clarification with a best-guess interpretation** BEFORE commit. No silent branch classification.
- Editing is always via chat. No inline edit on the MindMap.
- Switching between the Chat view and the Profile view is driven by a **UI control** (tab / button / nav). The view toggle is never a chat command interpreted by the LLM.
- There is **no finished state**. No "complete" flag that locks the profile.
- Company side stays predominantly **unstructured**. Hard filters remain structured; soft claims are LLM-judged. No pre-emptive company-facet tagging.
- All existing user preference data and conversation state is **wiped at ship**. No migration path.
- The canonical top-level branch set is **the nine branches committed in §6.3** (Role, Skills, Compensation, Location, Industry, Company Attributes, Exclusions, Deal-breakers, Other). The branch **hierarchy** (branches, sub-branches, deeper nesting) is **developer-editable at runtime** via a registry — not hardcoded in app code.
- **Tree depth is variable** in the data model; leaves live at any depth. The UI renders up to a **configured max render depth**; deeper levels are reachable via drill-down. The max render depth is developer-editable at runtime.
- When a user claim fits no canonical branch, it lands in **Other** with preserved phrasing and explicit chat acknowledgment. The agent **MUST NOT auto-create new canonical branches** from user input — branch changes are a developer action.
- **L3 scoring runs in bounded batches and stops.** The judge scores up to a configured candidate cap from L2's output, then halts. No silent background continuation. Unbounded scoring is not an acceptable implementation.
- **The results page exposes exactly three user-driven continuation affordances** under the scored batch: (a) extend the scored batch to the next candidate group (repeatable), (b) navigate to the persistent profile editor (Profile + Chat), (c) open a transient L2-filter overlay scoped to the current search only. Re-shaping, consolidating, or hiding any of the three requires reopening this PRD.
- **Transient L2 filter overrides never mutate the Profile tree, `conversation_message`, or `conversation_state`.** They live only in the current search session and are discarded on page exit, new search, or explicit clear. Persisting them silently would be a product bug, not a convenience.
- **Durable worker-extracted job signals** (enumerated in §11.3) continue to be populated by the scoring worker on the same cadence as today. New signals of comparable durability MAY be added using the same idempotent-on-content-hash pattern.
- **Naming is locked:** UI sections = `Chat` and `Profile`. MindMap artifact inside Profile = `Profile Map`. **No user-facing brand name for the conversational process.** The agent is referred to internally as "the profile assistant" but that term is NOT surfaced in UI copy. Explicitly forbidden: `Onboarding`, `Interview`, any job-interview-adjacent phrasing. Copy polish is permitted; concept labels are fixed.

### 11.3 Invariants to preserve

- **Location preferences (`user_profile.location_preferences`, `preferred_locations`, `remote_preference`) remain functional** throughout MVP. Code paths untouched: `packages/ats-core/src/geo/*`, `apps/web/src/lib/search/filter-pipeline.ts` location-tier resolution. **However**: if the final tree schema makes the location tier structure visibly inconsistent (different leaf shape, different direction handling, different MindMap rendering than other branches), the divergence MUST be flagged, and a fast-follow alignment is expected — location is a reference implementation, not a carve-out. Do not permanently leave it divergent.
- **Role family classifier** (`packages/ats-core/src/classifier/*`) and its input contract (title + department) remain functional. The tree's role branch must be able to produce `targetTitles[]` in a shape the classifier accepts without modification, OR the classifier input contract is updated in the same cut.
- **L1 → L2 → L3 funnel ordering**: cheap deterministic filters first; LLM-judge only on survivors. Do not move all filtering to LLM — per business-logic doc §4 and §6, this is load-bearing for cost.
- **Transient L2 filter overlay isolation**: the per-search overlay applied via the "Change filters" affordance MUST NOT mutate the Profile tree, `conversation_message`, `conversation_state`, or any persistent DB row. Implementation lives only in request-scoped state (e.g., query params, in-memory session, short-lived cookie — downstream choice). If any code path tries to persist overlay values into profile storage, that is a bug to fix, not a feature.
- **Worker-extracted job signals** (`job.visaSponsorship`, `job.relocationPackage`, `job.workAuthRestriction`, `job.languageRequirements`, `job.travelPercent`, `job.securityClearance`, `job.shiftPattern`) and their provenance columns (`job.signalsExtractedAt`, `job.signalsExtractedFromHash`) continue to be populated by the existing scoring worker. The soft-judge may **read** them as inputs but must not overwrite them outside the existing idempotent extraction path (which is keyed on `description_hash` / `signalsExtractedFromHash`).
- **Auth, session, user API keys, ingestion, polling, ATS detection, `role_family`, `company`, `job` tables** — untouched by this PRD (except that `job_match` is extended per §6.3, and new durable-signal columns on `job` may be ADDED under the existing pattern, but existing signal columns are not re-shaped or removed).
- **`synonym_group` table and `synonym-cache.ts`** — retained. May be extended; must not be removed. The tree's canonical tokens can continue to flow through synonym expansion at search time.

### 11.4 Technical hints (optional, non-binding)

- **Hint — leaf schema sketch:** `{ claim: string, direction: 'include' | 'exclude', canonical?: string[], note?: string, source_turn_id?: string, flagged_uncertain?: boolean, confidence?: number }`. Shape not binding.
- **Hint — branch registry sketch:** a `preference_branch` table with `{ slug, parent_slug, display_name, sort_order, description, active, config_json? }` — top-level branches have NULL `parent_slug`, sub-branches point at a parent. Seed script installs the nine top-level branches from §6.3 and a first cut of sub-branches (Skills → core / growth / avoid; Company Attributes → size / stage / funding / HQ / product_type / brand / culture). Mirrors the existing `role_family` / `synonym_group` pattern.
- **Hint — configuration keys in `app_config`:** `scoring.l3_candidate_cap` (default ≈ 100, calibrate against the §4 manual cycle) caps L3 per search AND doubles as the extend-batch size (simplest, predictable cost). `ui.profile_map_max_depth` (default 3) caps rendered tree depth in the Profile Map. Both adjustable without redeploy.
- **Hint — three affordance labels:** `Score more` (extend), `Change profile preferences` (persistent edit), `Change filters` (transient overlay). User-agreed copy; polish allowed if semantic intent is preserved.
- **Hint — transient filter overlay dimensions:** start with the L2 dimensions currently read by `filter-pipeline.ts` (role family, seniority, location tiers, industry, remote preference). Query-string storage makes the overlay URL-sharable and survives page reload without persisting.
- **Hint — Skills sub-direction encoding:** the Skills branch expresses three stances — "keep", "grow into", "avoid". Option A: extend the direction enum for Skills only (`include_keep | include_grow | exclude`). Option B: keep `direction: include | exclude` universal and add a `skill_intent` marker on Skills leaves. Keep universal direction semantics clean.
- **Hint — evidence phrase must be substring-verifiable** against the actual job or company description. If the judge returns a phrase not present in the source text, reject or retry. Hallucination at the explainability layer destroys trust.

### 11.5 Verified during research

- Bug reproduced on the user's profile row; the filter pipeline emits dead strings like `'fintech (non-traditional banking)'` and `'product companies'` that match no company tag (see §5.2).
- Company tag vocabulary (top 40) has no concept of "product company" or "brand strength" — validates §8 Alternative C rejection.
- `location_preferences.tiers` is already structured in the reference pattern (with `originalText`, `qualitativeConstraint`, `scope.exclude`, `immigrationFlags`) on the current user's row. This is the generalized shape.
- `exclusions` correctly captured "traditional banking" on the same turn that industries bucket mangled its qualifier — extraction is not universally broken; the shape of the `industries` bucket and the disconnection between a positive claim and its qualifier across two fields are the root causes.
- 11 of 14 user-preference fields never influence L2 SQL; they only feed the L3 LLM scoring prompt — so improving capture alone does not help until matching reads the new structure.
- BYOK (`user_api_key`) is in place (business-logic §13.1), so per-claim / per-job LLM-judge calls are economically viable.
- Durable LLM conclusions on `job` rows are **already in production** with provenance via `job.signalsExtractedAt` + `job.signalsExtractedFromHash`. The soft-judge reuses this pattern for any new durable signal — no new mechanism needs to be invented.
- The `app_config` key-value table (business-logic §12) is the established home for tunable parameters like the L3 cap and the UI max render depth.
- Nine-branch canonical set (§6.3) cross-checked against (a) the 14 current profile fields + 16 steps, (b) the user's populated row, (c) subagent competitor research (facets near-universal across job-matching products: role, skills, comp, location, industry, company-size/stage, culture, exclusions).
- Five external product patterns surveyed (labeled facets, structured + embedding, LLM-scored rubric, CBR with critiquing, continuous conversational state). Selected direction is closest to the LLM-scored rubric, augmented with log-plus-digest for persistence, borrowing the rank / `originalText` idea from the location tier model.

