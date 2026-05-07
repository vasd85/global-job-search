# ADR-0007 — Persist per-claim L3 scores as a JSONB column on `job_match`

## Status

Proposed

## Context

The L3 schema-extension ADR widens `ScoringOutputSchema` with a
`claims` array carrying per-claim scores and substring-verified
evidence phrases. Those values must land on the `job_match` row so
the UI and any future analytics can read them alongside the existing
RSLCD scores.

The umbrella PRD (§6.3) leaves the persistence form to the architect:
"existing `evidenceQuotes` widened, new column, or new table". The
decision shapes how rendering, querying, and indexing work for soft
matches.

Forces:

- `job_match` is keyed on `(userProfileId, jobId)` — a per-claim
  array nests naturally under that composite key as a 1:N
  relationship.
- The UI reads `job_match` rows by profile and renders soft-match
  detail in the same view; an extra JOIN to fetch claim detail adds
  latency for no clear win.
- The chosen tree persistence ADR keeps the user's tree as JSONB;
  symmetry between leaf storage (JSONB) and per-claim score storage
  (JSONB) keeps the mental model coherent.
- The existing `evidenceQuotes` column holds the verbatim quotes that
  support the **whole-match** `matchReason`. Overloading it with
  per-claim evidence is semantic conflation.
- No anticipated cross-row analytics on per-claim scores in MVP
  (manifesto forbids volume metrics; user is solo).

## Decision

We will add a new JSONB column `claim_scores` to `job_match`:

```ts
jobMatches = pgTable("job_match", {
  // existing columns retained
  claimScores: jsonb("claim_scores"),
});
```

The column holds the `claims: ClaimScore[]` array emitted by the
widened L3 schema. The L3 worker writes both `claimScores` and the
existing `matchReason` / `evidenceQuotes` in the same upsert; the
read-side queries return both atomically. `evidenceQuotes` retains
its current semantics — whole-match summary quotes — and is
**not** overloaded with per-claim evidence.

`leafId` inside `ClaimScore` is a soft reference to a leaf in
`user_profile.preferenceTree`. No Postgres FK (the leaf lives in
JSONB). A render-time filter drops entries whose `leafId` no longer
resolves to an active leaf.

## Consequences

- **Positive — single-row reads return all match detail.** UI
  rendering, analytics, and the trigger route see RSLCD + per-claim
  in one row.
- **Positive — symmetry with the tree persistence form.** Both
  per-user trees and per-match claim arrays are JSONB; the coding
  patterns reuse.
- **Positive — `evidenceQuotes` keeps its existing semantics.** No
  consumers need to change to read `evidenceQuotes`; the new column
  is additive.
- **Positive — fewer transactions.** The L3 worker upsert remains
  one statement; no extra INSERTs into a side table.
- **Negative — no FK on `leafId`.** Stale entries possible after a
  leaf delete; resolved by render-time filter. Acceptable for solo
  product.
- **Negative — querying for "all matches that score claim X above
  Y"** requires a JSONB path expression rather than a normalized
  join. No such query is in MVP scope; a Postgres GIN index on the
  column can be added later if a use case appears.
- **Neutral — `matchReason` and `evidenceQuotes` semantics
  unchanged.** Future revisions can deprecate them in favour of an
  aggregate computed from `claim_scores`; this ADR doesn't take that
  step.
- **Follow-on work.** Sub-feature plans must (1) write the migration
  adding the column, (2) update the L3 upsert to write both fields,
  (3) update the UI rendering to read `claim_scores` for per-claim
  explainability, (4) write a small render-time filter that drops
  claim-score entries whose `leafId` is no longer present in the
  user's tree.
