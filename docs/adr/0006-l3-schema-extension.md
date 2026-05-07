# ADR-0006 — Widen `ScoringOutputSchema` with per-claim scores and substring-verified evidence

## Status

Proposed

## Context

The umbrella PRD (`docs/product/2026-05-06-profile-driven-architecture.md`)
locks two L3 contracts in §11.2:

- The L3 worker remains **per-job consolidated** (one LLM call per
  scored job; per-claim-per-job rejected on cost grounds).
- The schema must surface **per-claim scoring** with a
  **substring-verifiable evidence phrase** for each soft claim,
  alongside the existing RSLCD dimensional scores.

§11.3 locks the substring-verification invariant: every emitted
`evidencePhrase` must be substring-verifiable against the source job
or company description; the worker must reject or retry hallucinated
phrases. PRD §11.5 records that the existing
`apps/worker/src/handlers/llm-scoring.ts` (358 lines) and
`apps/worker/src/lib/scoring-schema.ts` already implement the per-job
consolidated path with Anthropic structured output via the Vercel AI
SDK; the rewrite is an extension, not a build-from-scratch.

Three schema-extension shapes were considered:

- **Widen** the existing `ScoringOutputSchema` to emit per-claim
  scores + evidence phrases alongside the RSLCD dimensions.
- **Replace** RSLCD with per-claim aggregation — derive synthetic
  per-dimension scores from claim scores grouped by `branchSlug`.
- **Audit pass** — keep RSLCD as the primary path and add per-claim
  only as an occasional calibration pass on a subset of jobs.

Forces:

- The `weight_*` columns on `user_profile` and the `computeMatchPercent`
  helper are calibrated against the RSLCD dimensions. Replacing them
  forces a coordinated rewrite of the weight model in the same PR
  that carries the L3 schema change — too large.
- Per-claim grain is required by the UI (substring-verifiable
  explainability per claim) regardless of which top-level shape we
  pick.
- BYOK economics: every L3 call is user-funded. An audit-pass approach
  doubles cost on the audited subset; widening adds output tokens
  only.
- The PRD locks that there is **only one** L3 LLM call per scored
  job, ruling out the audit-pass shape as a separate call path.

External research (PRD §11.5 + research note): consolidated structured
output is the production default; per-claim-per-job is rare and
expensive. Documented failure modes: position bias on later claims,
score compression, hallucinated evidence quotes (mitigated by
substring verification — already locked), long-list laziness past
~15-20 rubric items.

## Decision

We will widen `ScoringOutputSchema` in
`apps/worker/src/lib/scoring-schema.ts` with a `claims` array
alongside the existing RSLCD fields:

```ts
const ClaimScoreSchema = z.object({
  leafId: z.string(),
  score: z.number(),                      // clamped server-side to 0-10
  evidencePhrase: z.string().nullable(),  // substring of source description
  mentioned: z.boolean(),                 // false if description is silent
});

ScoringOutputSchema = ScoringOutputSchema.extend({
  claims: z.array(ClaimScoreSchema),
});
```

The handler verifies every non-null `evidencePhrase` is a
case-insensitive whitespace-normalised substring of the description
text via a shared utility
(`apps/worker/src/lib/verify-evidence-phrase.ts`). Verification
failures either nullify the phrase with a warn-log or trigger one
retry with a tighter prompt — sub-feature plan picks based on
measured hallucination rate.

The prompt:

- Randomises claim order per call (position-bias mitigation).
- Asks for `mentioned` first, then `score`, then `evidencePhrase`
  (reasoning before number).
- For users with more than 15 active claims, batches into chunks of
  ≤15 with the per-claim contract preserved; the worker merges
  batches into one `claim_scores` array. Cap configurable via
  `app_config.scoring.l3_claims_per_call`.

When the description is silent on a claim, the LLM emits
`mentioned: false`, `score: 5` (neutral), `evidencePhrase: null`.
Rationale: silence is not a no — penalising under-described jobs with
0 systematically downranks smaller startups.

The RSLCD dimensional scores remain unchanged; the existing
`weight_*` columns and `computeMatchPercent` continue to drive the
overall `matchPercent`. Per-claim scores feed UI explainability and
the soft anti-match path (exclude-direction claims with high
`mentioned + score` penalise the match in a sub-feature follow-up).

The widening lands in one sub-feature (the L3 sub-feature) with the
prompt update; the wipe + foundation sub-feature does **not** touch
the schema, only swaps prompt-input sources from flat columns to
tree-derived facts.

## Consequences

- **Positive — calibrated RSLCD weights survive.** No coordinated
  weights rewrite in the same PR.
- **Positive — single LLM call per job preserved**, satisfying PRD
  §11.2 lock and BYOK economics.
- **Positive — per-claim grain unlocks substring-verifiable
  explainability** — every claim shows up on the UI with its own
  evidence or a "not mentioned" badge.
- **Positive — `mentioned: false` flag** preserves selectivity
  signal without distorting scores; the UI can surface "this job
  doesn't mention X" as a positive selectivity hint.
- **Positive — substring verification is a single shared utility**,
  reusable beyond L3 (any future evidence-emitting LLM call uses
  it).
- **Negative — output tokens grow.** A user with 20 active claims
  emits 20 `ClaimScore` objects; output budget per job rises from
  ~150 to ~600 tokens. Acceptable on Haiku 4.5 pricing.
- **Negative — long-claim users need batching.** The 15-claim chunk
  rule adds complexity; sub-feature plan owns the batching and
  merging logic. Position bias may still manifest within a chunk;
  randomisation is a partial mitigation.
- **Negative — `leafId` is a soft reference**, not an FK. A leaf
  deleted between L2 trigger and L3 execution leaves a stale
  `claimScores` entry. Mitigated: server-side filter at render time
  drops claim-score entries whose `leafId` no longer exists.
- **Neutral — RSLCD vs per-branch weights deferred.** A future
  fast-follow may collapse RSLCD into per-claim aggregation; the
  schema today supports both readings.
- **Follow-on work.** Sub-feature plans must (1) update the prompt
  builder to assemble tree-derived facts and per-claim instructions,
  (2) implement substring verification with chosen retry/null
  strategy, (3) handle the >15-claim batching path, (4) add unit
  tests for the verify utility and schema parse.
