# Business Logic: Job Search & Evaluation

Status: **Draft v2** | Date: 2026-03-19

---

## 1. Overview

The application helps users find their dream job by:

1. Building a detailed professional profile (out of scope for this doc)
2. Collecting company and job preferences via chatbot
3. Searching and scoring jobs against user preferences
4. Assisting with the application process (out of scope for this doc)

This document covers **steps 2 and 3**: how we collect preferences, search for jobs, populate the database, and evaluate results.

---

## 2. Company Preferences (Chatbot)

The chatbot collects criteria that define what kind of companies interest the user.

### 2.1 Criteria

| Criterion | Purpose | Data type | Priority |
|---|---|---|---|
| **Industry / domain** | Primary filter. web3, fintech, AI/ML, healthtech, devtools, etc. | `string[]` (multi-select + custom) | Required |
| **Company size** | startup (1-50), scaleup (50-500), enterprise (500+) | `enum[]` | Required |
| **Company stage** | seed, Series A-C, late-stage, public | `enum[]` | Optional |
| **Work format** | remote-first, hybrid, onsite | `enum` | Required (already in `remotePreference`) |
| **HQ geography** | Affects timezone, visa, culture | `string[]` | Optional |
| **Product type** | B2B, B2C, B2B2C, developer tools, infra | `string[]` | Optional |
| **Exclusions (blocklist)** | Explicit exclusions: outsourcing, agencies, gambling, etc. | `string[]` | Optional |

### 2.2 What NOT to ask

- Specific tech stack (that's a job property, not company property)
- Company reputation / ratings (subjective, unstable data)
- Specific company names (user can add those separately via company submission)

### 2.3 Schema impact

Add a separate table `user_company_preferences` or a JSONB column `companyPreferences` in `user_profiles`. Separate table is preferred for queryability.

---

## 3. Job Preferences (Chatbot)

### 3.1 Skill model: Strengths vs Desires vs Avoidance

A key distinction: user skills and user desires are different things.

| Field | Meaning | Example | Scoring impact |
|---|---|---|---|
| `coreSkills[]` | What user does well AND wants to keep doing | Selenium, API testing, CI/CD | High Skills Fit |
| `growthSkills[]` | What user wants to learn / gain experience in | AI testing tools, performance engineering | Medium Skills Fit + Growth bonus |
| `avoidSkills[]` | What user does NOT want to do (even if capable) | Manual regression, SAP testing | Penalty or deal-breaker |

### 3.2 Chatbot questions (in order)

1. **Target roles** - "What position are you looking for?" -> `targetTitles[]` (existing)
2. **Seniority level** - junior / mid / senior / lead / manager -> `targetSeniority[]` (existing)
3. **Core expertise** - "What are you best at? What do you definitely want to apply?" -> `coreSkills[]`
4. **Growth areas** - "What would you like to learn on your next job?" -> `growthSkills[]`
5. **Avoidance** - "Is there anything you definitely do NOT want to work with?" -> `avoidSkills[]`
6. **Deal-breakers** - "What is absolutely unacceptable?" -> `dealBreakers[]` (new)
7. **Salary expectations** - `minSalary` (existing) + `targetSalary` + `currency` (new)
8. **Location** - `preferredLocations[]`, `remotePreference` (existing)
9. **Dimension weights** - priorities across 5 scoring dimensions (updated)

### 3.3 Schema changes needed

Rename in `user_profiles`:
- `primarySkills` -> `coreSkills`
- `secondarySkills` -> `growthSkills`

Add to `user_profiles`:
- `avoidSkills: text[]`
- `dealBreakers: text[]`
- `targetSalary: integer`
- `salaryCurrency: text`

---

## 4. Scoring Model

### 4.1 Current state (problematic)

Current schema uses MDSC: Mobility, Domain, Skills, Compensation.
Legacy pipeline uses MCSD: Match, Compensation, Stability, Domain.

These are **different dimensions** with conflicting names. Must be unified.

### 4.2 New model: RSLCD (5 dimensions)

| Dimension | Code | What it evaluates | Score |
|---|---|---|---|
| **Role Fit** | R | Does the role/level match target titles + seniority? | 0-10 |
| **Skills Fit** | S | Do required skills overlap with core + growth skills? Is there avoidSkills conflict? | 0-10 |
| **Location Fit** | L | Does remote/hybrid/onsite + geography match preferences? | 0-10 |
| **Compensation Fit** | C | Is salary within acceptable range? | 0-10 |
| **Domain Fit** | D | Does company industry/product type match preferred domains? | 0-10 |

Each dimension scored 0-10. User sets weights (sum = 1.0). `matchPercent` = weighted sum normalized to 0-100.

### 4.3 Default weights

Weights are not equal. Role and Skills are the most critical — if the role doesn't match, nothing else matters.

| Dimension | Default weight | Rationale |
|---|---|---|
| Role Fit (R) | 0.25 | Primary filter — wrong role = irrelevant job |
| Skills Fit (S) | 0.25 | Core value proposition for the candidate |
| Location Fit (L) | 0.20 | Hard constraint for many users |
| Compensation Fit (C) | 0.15 | Important but often negotiable |
| Domain Fit (D) | 0.15 | Nice-to-have, rarely a deal-breaker |

Stored in `app_config` table (see Section 11). User can override per-profile.

### 4.4 Growth bonus

Default: **+7% to matchPercent** when a job requires skills from `growthSkills[]`.

Applied after weighted sum calculation. Capped so that final matchPercent does not exceed 100.

Stored in `app_config` as `scoring.growth_bonus_percent = 7`.

### 4.5 Deal-breakers

`dealBreakers[]` act as hard filters. If a job matches any deal-breaker pattern, it gets `matchPercent = 0` regardless of other scores. Examples: "requires security clearance", "travel >50%", "contract role".

### 4.6 Schema changes

Update `job_matches` table:
- `scoreM` -> `scoreR` (Role Fit)
- `scoreD` -> `scoreD` (Domain Fit, unchanged)
- `scoreS` -> `scoreS` (Skills Fit, unchanged semantics but includes growth/avoid logic)
- `scoreC` -> `scoreC` (Compensation Fit, unchanged)
- Add `scoreL` (Location Fit)

Update `user_profiles` weights:
- `weightMobility` -> `weightRole`
- `weightDomain` -> `weightDomain` (unchanged)
- `weightSkills` -> `weightSkills` (unchanged)
- `weightCompensation` -> `weightCompensation` (unchanged)
- Add `weightLocation`

---

## 5. Search Flow

### 5.1 User-facing flow

```
User fills profile
      |
[A] INSTANT SEARCH (DB, < 1 sec)
    |  SQL: jobs JOIN companies
    |  WHERE role_family_match(title)
    |    AND location_match
    |    AND industry_match
    |-> Show results immediately
      |
[B] OFFER "Expand search" (internet)
    |  AI finds new companies matching criteria
    |  detectAtsVendor -> add to DB
    |  pollCompany -> store all jobs
    |-> Show new results incrementally
      |
[C] LLM SCORING (async, background)
    |  For each matched job:
    |  - Fetch description if needed
    |  - Score R/S/L/C/D dimensions
    |  - Save to job_matches
    |-> Push scores to UI via SSE / polling
```

### 5.2 Instant search (Step A)

Query the existing database using deterministic filters (no LLM needed):
- Title matching via role family classifier (see Section 7)
- Location / remote preference filter
- Industry / domain filter
- Seniority extraction from title
- Department exclusion (Finance, Legal, Sales -> skip for engineering roles)

This gives the user immediate value from the shared job pool.

### 5.3 Internet expansion (Step B)

Triggered when:
- DB returns fewer than N results (configurable threshold)
- User explicitly requests it

**Budget:** Max **20 new companies** discovered per search request. Stored in `app_config` as `search.max_new_companies_per_request = 20`. Limits AI search API cost while still providing meaningful expansion.

Process:
1. AI web search: "top {industry} companies {criteria}" + related queries
2. For each discovered company (up to budget cap):
   - Check if already in DB (by normalized domain)
   - If new: detect ATS vendor -> add to `companies` table
   - Immediate poll -> store ALL jobs
3. Apply instant search filters -> show new results
4. Queue for LLM scoring

### 5.4 LLM scoring (Step C)

Only triggered for jobs that pass the fast filter (Step A/B).
Runs asynchronously. Results streamed to UI as they complete.
Cached per user+job: re-scored only if `job_content_hash` changes.

---

## 6. Database Population Strategy

### 6.1 Core decision: Store All, Evaluate Lazily

**Store ALL jobs from every company. Evaluate only on demand.**

#### Cost analysis

| Operation | Cost per unit | Volume | Total |
|---|---|---|---|
| ATS API call (list jobs) | Free (public endpoints) | 1000 companies | ~100 sec compute |
| Store job metadata | ~5KB per row | 500K jobs | ~2.5 GB storage |
| LLM evaluation per job | ~$0.005 (Haiku) | 25K after filter | ~$125 |
| LLM evaluation per job | ~$0.02 (Sonnet) | 25K after filter | ~$500 |

ATS APIs are free public endpoints (no auth). Storage is cheap.
LLM evaluation is the only expensive part -> only evaluate what passes the filter.

#### Why store everything

- ATS APIs return all jobs in a single response (no server-side filtering available, except SmartRecruiters)
- Storage cost is negligible
- A job irrelevant to User A may be perfect for User B
- Pre-filtering (Level 2) is free deterministic code

### 6.2 Three-level funnel

```
Level 1: STORE ALL (free)
  Save ALL jobs from ALL companies: title, department, location,
  url, salary, description (if available in list API).
  |
  ~500K jobs in database

Level 2: FAST FILTER (free, < 1ms per job)
  Deterministic filter against user profile:
  - Role family title matching
  - Location / remote filter
  - Seniority extraction
  - Department exclusion
  |
  ~5% pass -> ~25K jobs

Level 3: LLM EVALUATION (paid, cached)
  Full RSLCD scoring for jobs with descriptions.
  Cached per user_profile_id + job_content_hash.
  |
  25K x $0.005 = $125 per full corpus per user profile
```

### 6.3 What to store immediately vs on-demand

**Immediately (during poll):**
- All fields from ATS list API: title, url, department, location, salary, workplace_type
- `description_text` if vendor returns it in list response (Greenhouse, Lever do)
- Job metadata: ats_job_id, job_uid, source_type, source_ref, posted_date

**On-demand (lazy, when user requests matching jobs):**
- `description_text` for vendors that require a separate detail API call (Ashby, SmartRecruiters). Fetched lazily to save API calls; adds some latency but avoids fetching descriptions for jobs no user ever looks at. Eager fetching can be reconsidered later if latency becomes a problem.
- LLM evaluation scores (`job_matches` records)

### 6.4 Adding new companies to the database

**User-triggered:**
1. User searches -> not enough DB results
2. AI web search for matching companies
3. For each new company:
   - Validate: not already in DB (check by normalized domain)
   - Detect ATS vendor
   - Insert into `companies` with `source = "auto_discovered"`
   - Immediate first poll -> store all jobs
   - Apply user's fast filter -> show matching results

**Background expansion (scheduled):**
- Weekly: AI search for companies in popular industries
- Sources: Crunchbase, Y Combinator, ProductHunt, TechCrunch
- No user involvement needed
- Grows the shared pool for all users

**User submission:**
- Existing `company_submissions` table handles this
- User submits company name + website
- System detects ATS, adds to pool after validation

---

## 7. Role Family Classifier (Level 2 Filter)

**Status: Implemented (P4).** Classifier in `packages/ats-core/src/classifier/`, seed data in `apps/web/src/lib/ingestion/seed-role-families.ts`.

Replaces the legacy Stage 2B (manual GPT checkpoint).
Universal, not QA-specific. Pure code, no LLM.

### 7.1 Taxonomy structure

10 role families seeded in the `role_families` table: `qa_testing`, `backend`, `frontend`, `fullstack`, `devops_infra`, `data_engineering`, `data_science`, `product_management`, `design`, `engineering_management`.

Each family defines: `strong_match[]`, `moderate_match[]`, `department_boost[]`, `department_exclude[]`.

Full seed data: `apps/web/src/lib/ingestion/seed-role-families.ts` → `ROLE_FAMILY_SEED_DATA`.

### 7.2 Matching algorithm

Exported functions: `normalizeTitle()`, `classifyJob()`, `classifyJobMulti()` from `@gjs/ats-core/classifier`.

1. User selects 1-3 role families from taxonomy
2. For each job in DB:
   - Normalize title (lowercase, strip seniority prefixes)
   - Check `department_exclude` first -> if match, score = 0 (early exit)
   - Check against `strong_match` patterns -> score 1.0
   - Check against `moderate_match` patterns -> score 0.7
   - Apply `department_boost` if department matches AND base score > 0 -> score + 0.2 (capped at 1.0)
3. Jobs with score >= 0.5 pass to Level 3

Pattern matching uses substring containment (`includes()`), not regex.

**Known limitations:** Substring matching can produce false positives (e.g., "hr" in `department_exclude` matches "Chrome"). The ~85-90% precision target accepts this; Level 3 LLM scoring catches false positives. Word-boundary matching can be added later if needed.

### 7.3 Dynamic taxonomy expansion

The initial taxonomy covers ~10 role families. It must be extensible without code changes.

**When a user enters a role that doesn't match any existing family:**
1. LLM analyzes the user's target title
2. LLM decides: does it fit an existing family, or is a new one needed?
3. If new family needed: LLM generates `strong_match`, `moderate_match`, `department_boost`, `department_exclude` lists
4. System presents the proposed new family to the user for confirmation
5. On confirmation: new family is saved to the `role_families` table in DB
6. Available to all users going forward

Role families are stored in the database (not hardcoded), loaded at application startup and cached. This allows adding new families without redeployment.

### 7.4 Expected precision

~85-90% precision. Acceptable for a pre-filter because LLM evaluation (Level 3) catches false positives.

### 7.5 Future improvement

Embedding similarity: embed user's target titles, compare cosine similarity with each job title. OpenAI ada-002: ~$0.00001 per title. For 500K titles = $5. Can be added later if keyword matching proves insufficient.

---

## 8. Daily Polling Strategy

### 8.1 Current implementation assessment

`poll-company.ts` has a solid diff engine:
- Compares by `ats_job_id`
- Uses `description_hash` for content change detection
- 7-day grace period before marking jobs stale (protects against API glitches)
- 30-day threshold for marking jobs closed
- Proper error handling and logging to `poll_logs`

**Verdict: keep as-is. It's well designed.**

### 8.2 What needs to be added: adaptive polling frequency

Not all companies need daily polling. Adaptive schedule reduces unnecessary API calls.

| Company category | Polling frequency |
|---|---|
| New (< 7 days in DB) | Every day |
| Active (changes in last 3 days) | Every day |
| Stable (no changes in 7+ days) | Every 3 days |
| Very stable (no changes in 30+ days) | Every 7 days |
| Error (3+ consecutive errors) | Every 7 days, with backoff |
| Inactive (`isActive = false`) | Do not poll |

### 8.3 Schema additions for `companies` table

```
consecutiveErrors: integer      -- consecutive error count
pollPriority: text              -- "daily" | "regular" | "weekly"
nextPollAfter: timestamp        -- do not poll before this time
```

### 8.4 Polling cost estimate

With 1000 active companies:
- ~400 daily (new + active) x 365 = 146K API calls/year
- ~400 regular (every 3 days) x 122 = 48.8K
- ~200 weekly x 52 = 10.4K
- **Total: ~205K API calls/year** (negligible load)

### 8.5 Rate limiting protection

Current implementation does not account for ATS vendor when distributing load.

**Needed:**
- Group poll requests by vendor
- Limit concurrency per vendor (e.g., max 5 simultaneous requests to Greenhouse)
- Add jitter (random 0-5 sec delay) between requests to the same vendor
- Exponential backoff on consecutive errors per company

---

## 9. Decisions Log

| # | Decision | Rationale |
|---|---|---|
| D1 | Store ALL jobs, evaluate lazily | ATS APIs are free; storage is cheap; LLM evaluation is the only expensive part |
| D2 | Three-level funnel (Store -> Fast Filter -> LLM) | Reduces LLM cost from $2500 to ~$125 per user per full corpus |
| D3 | No cross-user evaluation caching | Profile differences (domain, location, growth skills, avoid skills) make evaluations non-transferable between users |
| D4 | 5-dimension scoring model (RSLCD) | Replaces conflicting MDSC/MCSD models with clear, universal dimensions |
| D5 | Skills split into core / growth / avoid | Captures both strengths and career development desires |
| D6 | Deterministic role family classifier for pre-filtering | Replaces manual GPT Stage 2B; free, ~85-90% precision |
| D7 | Adaptive polling frequency | Reduces unnecessary API calls; keep existing diff engine |
| D8 | Per-vendor rate limiting for polling | Prevents ATS blocking; not implemented yet |
| D9 | Lazy description fetch | For vendors requiring detail API calls (Ashby, SmartRecruiters), fetch on-demand only. Saves API calls; revisit if latency is a problem |
| D10 | Dynamic role taxonomy via LLM | Start with ~10 families in DB; LLM proposes new families when user enters unknown role; user confirms; available to all users |
| D11 | BYOK (Bring Your Own Key) for LLM | Users provide their own Anthropic API key; no paid plans at launch. Simplifies MVP; paid tiers designed later |
| D12 | Configurable parameters in `app_config` table | Scoring weights, growth bonus, search budget — all stored in DB, not hardcoded. Change without redeployment |

---

## 10. Configurable Parameters (`app_config` table)

All tunable parameters are stored in a database table `app_config` (key-value with JSON values). This allows changing behavior without redeployment.

| Key | Default value | Description |
|---|---|---|
| `scoring.default_weights` | `{"R": 0.25, "S": 0.25, "L": 0.20, "C": 0.15, "D": 0.15}` | Default scoring dimension weights for new users |
| `scoring.growth_bonus_percent` | `7` | Bonus % added to matchPercent when job matches growthSkills |
| `search.max_new_companies_per_request` | `20` | Max new companies discovered per internet search |
| `polling.vendor_concurrency` | `5` | Max simultaneous API requests per ATS vendor |
| `polling.jitter_max_ms` | `5000` | Max random delay between requests to same vendor |
| `polling.stale_threshold_days` | `7` | Days without seeing a job before marking it stale |
| `polling.closed_threshold_days` | `30` | Days without seeing a job before marking it closed |

---

## 11. LLM API Key Strategy

### 11.1 MVP: Bring Your Own Key (BYOK)

At launch, users provide their own Anthropic API key. The application uses it for:
- Job evaluation (Level 3 scoring)
- Internet company search
- Role taxonomy expansion
- Chatbot interactions (profile building)

User's API key is stored encrypted in the database, scoped to their account.

### 11.2 Future: Paid tiers

To be designed later. Possible model:
- Free tier: limited evaluations per month (using platform API key)
- Pro tier: higher limits, priority scoring
- Enterprise: unlimited, custom integrations

---

## 12. Open Questions

1. **Chatbot conversation design**: Exact question flow, branching logic, validation rules — needs UX design.
2. **Real-time scoring UX**: SSE vs polling vs WebSocket for streaming LLM evaluation results to the UI.
3. **Multi-language support**: Should role taxonomy and matching work for non-English job titles?
