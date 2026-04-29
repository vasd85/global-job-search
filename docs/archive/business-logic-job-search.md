# Business Logic: Job Search & Evaluation

Status: **Draft v3** | Date: 2026-04-01

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

Stored in `app_config` table (see Section 12). User can override per-profile.

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
[B] OFFER "Expand search" (internet, background)
    |  AI finds new companies matching criteria
    |  For each company (incremental, not batched):
    |    1. Fast-path: check if careersUrl is ATS-hosted
    |    2. Primary: probe ATS APIs with slug candidates
    |    3. Save company to DB (ALL companies, even unknown ATS)
    |    4. If supported ATS: poll -> store jobs
    |    5. Level 2 filter -> enqueue LLM scoring
    |-> Results appear incrementally as companies are processed
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
- Structured location matching via geo module (see Section 8)
- Industry filter with synonym expansion (see Section 9)
- Seniority extraction from title
- Department exclusion (Finance, Legal, Sales -> skip for engineering roles)

This gives the user immediate value from the shared job pool.

### 5.3 Internet expansion (Step B)

Triggered when:
- DB returns fewer than N results (configurable threshold)
- User explicitly requests it

Runs as a **background job** (pg-boss). The API returns immediately after enqueuing. Results appear incrementally as each company is processed — no waiting for all companies before filtering/scoring.

**Budget:** Max **20 new companies** discovered per search request. Stored in `app_config` as `search.max_new_companies_per_request = 20`. Limits AI search API cost while still providing meaningful expansion.

Process:
1. Load Level 2 filter context upfront (role families, location tiers, seniority)
2. AI web search: "top {industry} companies {criteria}" + related queries
3. For each discovered company (up to budget cap), incrementally:
   a. Check if already in DB (by normalized domain)
   b. **ATS detection** (probe-first):
      - Fast-path: if `careersUrl` contains a known ATS hostname → extract slug from URL
      - Primary: generate slug candidates from company name → probe Greenhouse, SmartRecruiters, Ashby, Lever public APIs → verify company name from response
   c. **Save to DB** — ALL companies are saved, including those with unknown ATS:
      - Known ATS: `atsVendor = "greenhouse"|"lever"|"ashby"|"smartrecruiters"`, `atsSlug = slug`
      - Unknown ATS: `atsVendor = "unknown"`, `atsSlug = null`, `isActive = false`
      - `atsSearchLog` JSONB stores the complete detection audit trail (all API calls, responses, durations)
   d. If supported ATS: immediate poll → store ALL jobs
   e. Level 2 filter this company's jobs → enqueue passing jobs for LLM scoring
4. Web queries filter to supported ATS vendors only — unknown-ATS companies are stored for auditing but not displayed

### 5.3.1 ATS detection strategy

The system uses **direct ATS API probing** as the primary detection method. All four supported ATS platforms expose unauthenticated public JSON APIs:

| ATS | Probe endpoint | Existence signal | Name verification |
|-----|---------------|------------------|-------------------|
| Greenhouse | `GET boards-api.greenhouse.io/v1/boards/{slug}` | 200 vs 404 | Yes (org name in response) |
| SmartRecruiters | `GET api.smartrecruiters.com/v1/companies/{slug}/postings?limit=1` | 200 vs 404 | No |
| Ashby | `POST jobs.ashbyhq.com/api/non-user-graphql` | GraphQL org ≠ null | Yes (org name in GraphQL) |
| Lever | `GET api.lever.co/v0/postings/{slug}?mode=json&limit=1` | Non-empty array | No (ambiguous empty) |

**Slug generation:** Company names are transformed into multiple candidates (lowercase-stripped, hyphenated, underscored, brand-word-only, CamelCase). Common suffixes (Inc, LLC, Ltd, Corp, GmbH) are stripped.

**Probe order:** Greenhouse → SmartRecruiters → Ashby → Lever (ordered by API reliability and verification capability). Early termination on first verified match.

**Rate limiting:** 200ms delay between requests. Sequential per-company. 30s total deadline per company. Respects vendor limits: SmartRecruiters (10 req/s), Ashby (~100 req/min).

**Why probe-first over URL detection:** AI web search often returns custom career page URLs (`company.com/careers`) that mask the underlying ATS. Probing doesn't depend on the careers URL quality — only the company name.

### 5.3.2 ATS search log

Every company's detection process is fully logged in the `atsSearchLog` JSONB column:

```json
{
  "timestamp": "2026-04-04T12:00:00Z",
  "slugCandidates": ["acmecorp", "acme-corp", "acme"],
  "steps": [
    {
      "type": "url_detection",
      "timestamp": "2026-04-04T12:00:00.000Z",
      "input": "https://acme.com/careers",
      "result": "not_found",
      "durationMs": 0
    },
    {
      "type": "api_probe",
      "timestamp": "2026-04-04T12:00:00.001Z",
      "vendor": "greenhouse",
      "slug": "acmecorp",
      "endpoint": "https://boards-api.greenhouse.io/v1/boards/acmecorp",
      "httpStatus": 404,
      "result": "not_found",
      "durationMs": 312
    },
    {
      "type": "api_probe",
      "timestamp": "2026-04-04T12:00:00.513Z",
      "vendor": "greenhouse",
      "slug": "acme",
      "endpoint": "https://boards-api.greenhouse.io/v1/boards/acme",
      "httpStatus": 200,
      "result": "found",
      "matchedName": "Acme Inc.",
      "nameVerified": true,
      "confidence": "high",
      "durationMs": 287
    }
  ],
  "outcome": {
    "vendor": "greenhouse",
    "slug": "acme",
    "method": "api_probe",
    "confidence": "high"
  }
}
```

The log is complete enough to reconstruct and debug the entire detection process: which slugs were tried, which APIs were called, what responses came back, and why the final decision was made.

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
  - Structured location matching (geo module)
  - Industry synonym expansion
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
   - Detect ATS vendor (probe-first, URL fast-path)
   - Insert into `companies` with `source = "auto_discovered"` — **all companies saved, including unknown ATS**
   - `atsSearchLog` stores the full detection audit trail
   - If supported ATS: immediate first poll -> store all jobs -> Level 2 filter -> enqueue scoring
   - If unknown ATS: saved with `atsVendor = "unknown"`, `isActive = false` (for auditing and future re-probing)

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

## 8. Structured Location Matching (Level 2 Filter)

**Status: Implemented (P6.1).** Module in `packages/ats-core/src/geo/`, integrated in `filter-pipeline.ts`.

Replaces the naive substring location matching (which produced false positives like "US" matching "Campus" and false negatives like "UK" not matching "United Kingdom") with a type-aware geographic matching system.

### 8.1 Reference data

All static TypeScript — no external API calls, no new npm dependencies.

| Data source | Contents | Size |
|---|---|---|
| `country-data.ts` | ~250 ISO 3166 countries with aliases (e.g., "uk" → GB, "holland" → NL) | Forward + reverse index |
| `composite-regions.ts` | ~25 composite regions (EU, EEA, DACH, Nordics, APAC, etc.) with member country codes | Reverse index |
| `timezone-groups.ts` | ~8 timezone groups (US timezone, EU timezone, etc.) with UTC offset ranges and member countries | Reverse index |
| `us-states.ts` | US state abbreviations (50+DC+territories), Canadian province abbreviations (~13) | Maps |
| `city-index.generated.json` | ~25K cities from GeoNames cities15000 dataset, sorted by population | ~1.5 MB JSON |

### 8.2 Job location parser

`parseJobLocation(raw: string): ParsedJobLocation[]`

Converts raw ATS location strings into structured entities:

1. Normalize: lowercase, trim, collapse whitespace
2. Detect remote/anywhere signals via word-boundary regex
3. Handle "Remote, \<scope\>" patterns (e.g., "Remote - Europe")
4. Split on comma, resolve right-to-left: country → state → city
5. Handle multi-location strings ("Berlin, DE or London, UK") via ` or ` / ` and ` separators
6. Set confidence level: `full` (country + city resolved), `partial` (country only), `unresolved`

### 8.3 User location resolver

`resolveAllTiers(tiers): ResolvedTierGeo[]`

Resolves user preference tiers (from chatbot `locationPreferences` JSONB) into structured geo data:

- **"any" scope**: matches everything
- **"countries" scope**: resolves each entry via country lookup, falls back to region lookup
- **"regions" scope**: resolves via composite region lookup, falls back to country
- **"timezones" scope**: resolves via timezone group lookup
- **"cities" scope**: resolves via city index, adds city's country code automatically
- **Exclusions**: processed separately, subtracted from resolved set
- **Unresolved entries**: kept for substring fallback matching, not silently dropped

### 8.4 Matching algorithm

`matchJobToTiers(locationRaw, workplaceType, resolvedTiers): LocationMatchResult`

1. No tiers configured → everything passes (no location filter)
2. Null/empty `locationRaw` → passes (backward compatibility)
3. For each tier (sorted by rank): check `workFormatMatch` AND `geoMatch`
4. First matching tier → `{ passes: true, matchedTier: tier.rank }`
5. No match → `{ passes: false, matchedTier: null }`

**Work format matching**: remote/hybrid/onsite enum comparison. Null job type → passes. "relocation" treated as "onsite".

**Geo matching** (priority order):
- Tier scope "any" → passes
- Job "Anywhere" → passes
- Remote job with no geographic scope → passes
- City-level: check against `resolvedCityNames` set
- Country-level: check against `resolvedCountryCodes` set
- Fallback: word-boundary substring match for unresolved entries (short needles ≤3 chars use `\b` regex to avoid "US" matching "Campus")

### 8.5 Performance

- **LRU cache** (10K entries) for `ParsedJobLocation` keyed by lowercase `locationRaw`. Shared across all search requests in the same process.
- City index lazy-loaded on first use (~1.5 MB one-time parse).
- Per-job matching is O(tiers) with O(1) `Set.has()` lookups.
- No schema changes, no external API calls at search time.

---

## 9. Synonym Normalization (Level 2 Filter)

**Status: Implemented.** DB table `synonym_group`, logic in `packages/ats-core/src/taxonomy/`, cache in `apps/web/src/lib/search/synonym-cache.ts`.

Bridges the vocabulary gap between user preferences (LLM-extracted free-form text) and company data (seeded industry tags). Without synonym expansion, user preference "Cryptocurrency/Blockchain" produces zero results when companies are tagged `["web3", "crypto", "exchange"]`.

### 9.1 Problem scope

Audited all string comparison points in the filter pipeline:

| # | Dimension | Status |
|---|---|---|
| 1 | **Industry** | Fixed by synonym expansion |
| 2 | Role/Title | OK — role family classifier uses curated patterns |
| 3 | Seniority | OK — both sides use the same enum |
| 4 | Location | OK — structured geo matching, not string comparison |
| 5 | Workplace Type | OK — both sides use enum |
| 6 | Skills | Future risk — schema only, not yet wired |
| 7 | Product Types | Future risk — schema only |
| 8 | Exclusions | Future risk — schema only |

### 9.2 DB schema: `synonym_group` table

```sql
CREATE TABLE synonym_group (
  id            SERIAL PRIMARY KEY,
  dimension     TEXT NOT NULL,
  canonical     TEXT NOT NULL,
  synonyms      TEXT[] NOT NULL,
  umbrella_key  TEXT,
  UNIQUE(dimension, canonical)
);
```

Example: "crypto" group has synonyms `{crypto, cryptocurrency, bitcoin, digital_currency}` with `umbrella_key = "crypto_ecosystem"`. The "web3" and "exchange" groups share the same umbrella key, enabling bidirectional expansion across related concepts.

### 9.3 Expansion algorithm

`expandTerms(groups, terms): string[]`

1. Build reverse lookup: lowercase synonym → SynonymGroup
2. Build umbrella index: umbrella_key → SynonymGroup[]
3. For each input term: find matching group, collect all synonyms
4. If group has `umbrella_key`: also collect synonyms from all groups sharing that key
5. Unknown terms pass through unchanged (lowercased)
6. Output is deduplicated

**Example**: `expandTerms(groups, ["cryptocurrency"])` → `["crypto", "cryptocurrency", "bitcoin", "digital_currency", "web3", "blockchain", "defi", "decentralized_finance", "exchange", "crypto_exchange", "digital_exchange"]`

`canonicalize(groups, term): string` — returns the canonical form of a term, or the term itself if not found.

### 9.4 Integration

1. `normalizeIndustryTerms()` in `filter-pipeline.ts` splits compound chatbot labels on "/" (e.g., "Web3/Blockchain/Crypto" → `["web3", "blockchain", "crypto"]`), then expands through the synonym DB
2. Expanded terms are used in the SQL `&&` array overlap condition against `companies.industry`
3. The synonym cache (`synonym-cache.ts`) loads `synonym_group` table once and caches in-memory per process

### 9.5 Adding new synonyms

One DB insert per synonym group. No code change, no redeployment:

```sql
INSERT INTO synonym_group (dimension, canonical, synonyms, umbrella_key)
VALUES ('industry', 'nft', ARRAY['nft', 'non_fungible_token', 'digital_collectibles'], 'crypto_ecosystem');
```

### 9.6 Design decisions

- **Why not pg_trgm / fuzzy matching**: "crypto" and "web3" are conceptually related but lexically unrelated (0.0 trigram similarity). Fuzzy matching solves typos, not vocabulary normalization.
- **Why not embeddings**: Overkill for a closed vocabulary. Harder to debug. Good fit for future Level 3 semantic matching.
- **Why not a code-level Map**: Requires redeployment to add synonyms. Vocabulary will grow as skills, product types, and exclusions matching is added.
- **Why umbrella keys**: Industry concepts form clusters (crypto/web3/blockchain/exchange are all "crypto ecosystem"). Umbrella keys link related groups bidirectionally without duplicating synonym lists.

---

## 10. Daily Polling Strategy

### 10.1 Current implementation assessment

`poll-company.ts` has a solid diff engine:
- Compares by `ats_job_id`
- Uses `description_hash` for content change detection
- 7-day grace period before marking jobs stale (protects against API glitches)
- 30-day threshold for marking jobs closed
- Proper error handling and logging to `poll_logs`

**Verdict: keep as-is. It's well designed.**

### 10.2 What needs to be added: adaptive polling frequency

Not all companies need daily polling. Adaptive schedule reduces unnecessary API calls.

| Company category | Polling frequency |
|---|---|
| New (< 7 days in DB) | Every day |
| Active (changes in last 3 days) | Every day |
| Stable (no changes in 7+ days) | Every 3 days |
| Very stable (no changes in 30+ days) | Every 7 days |
| Error (3+ consecutive errors) | Every 7 days, with backoff |
| Inactive (`isActive = false`) | Do not poll |

### 10.3 Schema additions for `companies` table

```
consecutiveErrors: integer      -- consecutive error count
pollPriority: text              -- "daily" | "regular" | "weekly"
nextPollAfter: timestamp        -- do not poll before this time
```

### 10.4 Polling cost estimate

With 1000 active companies:
- ~400 daily (new + active) x 365 = 146K API calls/year
- ~400 regular (every 3 days) x 122 = 48.8K
- ~200 weekly x 52 = 10.4K
- **Total: ~205K API calls/year** (negligible load)

### 10.5 Rate limiting protection

Current implementation does not account for ATS vendor when distributing load.

**Needed:**
- Group poll requests by vendor
- Limit concurrency per vendor (e.g., max 5 simultaneous requests to Greenhouse)
- Add jitter (random 0-5 sec delay) between requests to the same vendor
- Exponential backoff on consecutive errors per company

---

## 11. Decisions Log

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
| D13 | Structured geo matching for Level 2 location filter | Replaces substring matching; eliminates false positives ("US" → "Campus") and false negatives ("UK" ≠ "United Kingdom"); static reference data, no external APIs |
| D14 | DB-backed synonym expansion for industry matching | Bridges vocabulary gap between chatbot output and company tags; new synonyms via DB insert, no code change |
| D15 | Umbrella keys for cross-concept synonym linking | Industry concepts form clusters (crypto/web3/exchange); umbrella_key enables bidirectional expansion without synonym duplication |
| D16 | Probe-first ATS detection | Direct API probing is the primary ATS detection method; URL detection is a fast-path optimization. AI web search often returns custom career page URLs that mask the ATS |
| D17 | Save all discovered companies | Companies with unknown ATS are saved with `atsVendor = "unknown"` for auditing and future re-probing. Web queries filter to supported ATS only |
| D18 | ATS search log (`atsSearchLog` JSONB) | Every detection attempt (URL checks, API probes, responses, durations) is logged per company. Enables debugging why a company was or wasn't detected |
| D19 | Incremental filtering/scoring in expansion | Level 2 filtering and scoring enqueue happen per-company as each is processed, not batched after all companies. Delivers results faster |

---

## 12. Configurable Parameters (`app_config` table)

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
| `probe.per_request_delay_ms` | `200` | Delay between ATS probe requests (rate limit protection) |
| `probe.max_total_ms` | `30000` | Maximum total probe time per company before giving up |
| `probe.request_timeout_ms` | `5000` | Timeout per individual probe HTTP request |

---

## 13. LLM API Key Strategy

### 13.1 MVP: Bring Your Own Key (BYOK)

At launch, users provide their own Anthropic API key. The application uses it for:
- Job evaluation (Level 3 scoring)
- Internet company search
- Role taxonomy expansion
- Chatbot interactions (profile building)

User's API key is stored encrypted in the database, scoped to their account.

### 13.2 Future: Paid tiers

To be designed later. Possible model:
- Free tier: limited evaluations per month (using platform API key)
- Pro tier: higher limits, priority scoring
- Enterprise: unlimited, custom integrations

---

## 14. Open Questions

1. **Chatbot conversation design**: Exact question flow, branching logic, validation rules — needs UX design.
2. **Real-time scoring UX**: SSE vs polling vs WebSocket for streaming LLM evaluation results to the UI.
3. **Multi-language support**: Should role taxonomy and matching work for non-English job titles?
