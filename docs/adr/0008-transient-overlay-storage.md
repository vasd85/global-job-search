# ADR-0008 — Store the transient L2 filter overlay in the URL query string

## Status

Proposed

## Context

The umbrella PRD locks three results-page affordances under the
scored batch (§11.2): "Score more" (extend), "Change profile
preferences" (persistent edit), and "Change filters" (transient L2
overlay scoped to the current search). §11.3 locks the **transient
overlay isolation invariant**: the overlay must never mutate the
profile tree, `conversation_message`, `conversation_state`, or any
persistent DB row — it lives only in request-scoped state.

PRD §11.4 hints at query-string storage (URL-shareable). PRD §10
leaves the storage form open: query string, `sessionStorage`, or
short-lived cookie.

The overlay's job is to let the user say "in this one search,
override my profile-derived L2 inputs (role family, seniority,
location, industry, remote preference) without touching the
profile". The override applies to one search session and is
discarded on page exit, new search, or explicit clear.

Forces:

- The PRD lock forbids any persistent path; we must avoid
  accidentally writing overlay values to a DB row.
- The solo user iterates frequently; URL-shareability has direct
  value (paste a search URL with a relaxed exclusion to compare
  results).
- `searchJobs` is called from `/api/search` and from
  `/api/scoring/trigger`. Both must honour the overlay if present
  for the current request and ignore it otherwise.
- `sessionStorage` survives page reload but vanishes on tab close;
  not URL-shareable; introduces a client-only state pathway that
  the server-side route would have to receive via header or query
  param anyway.
- A short-lived cookie has the same scope as session, no sharing
  benefit, and adds a server-set state mechanism we don't need.

## Decision

We will store the transient L2 overlay in the URL query string.
The search results page reads `useSearchParams()` (Next.js App
Router); any overlay-applicable param overrides the corresponding
profile-derived input on the request.

The overlay parameter set (locked here as the umbrella contract;
sub-feature panel UX may polish labels):

| Param | Maps to | Default |
|-------|---------|---------|
| `rf` | role family slug(s) | profile-derived |
| `sn` | seniority(s) | profile-derived |
| `loc` | structured location summary | profile-derived |
| `ind` | canonical industry token(s) | tree-derived |
| `rmt` | remote preference | profile-derived |

`searchJobs` (in `apps/web/src/lib/search/filter-pipeline.ts`) takes
an optional `overlay` argument — when present, replaces the
corresponding inputs derived from the tree; when absent, reads
from the tree (D1, D9). The overlay never reaches any code path
that writes to `user_profile`, `preferenceTree`,
`conversation_state`, or `conversation_message`.

`/api/scoring/trigger` similarly accepts overlay params and forwards
them to `searchJobs` for the current request only. The candidate
list and the per-job pg-boss enqueue happen against the overlay; no
DB writes propagate the overlay forward.

The "Change filters" affordance opens a side panel that mutates the
URL via `router.replace(?${overlayParams})`. Clearing or pressing
"Reset" removes the params; navigating away discards them
naturally.

## Consequences

- **Positive — URL-shareable.** Solo user can paste / bookmark
  alternative searches without persisting them. Useful for
  iteration loop.
- **Positive — naturally discarded** on navigation; no cleanup
  code.
- **Positive — invariant compliance is structural.** No DB write
  path exists; the overlay never reaches a query that mutates rows.
  Static analysis can grep for "overlay" callers and confirm none
  call `db.insert`/`db.update` on profile tables.
- **Positive — server-side readable** in any route handler via
  `URL` parse; no client-only state to ferry in headers.
- **Negative — query strings are visible in logs.** Non-sensitive
  by definition (filter values), so this is a presentation concern
  only.
- **Negative — URL length cap.** Overlay encodes 5 small params
  with short values; no risk of hitting the cap. If a future
  overlay grows (e.g., long industry-token lists), an alternative
  encoding (base64-encoded JSON) is straightforward.
- **Negative — back/forward navigation surfaces stale overlays.**
  Acceptable; the user explicitly applied them, the URL is the
  source of truth.
- **Neutral — sub-feature owns the panel UX.** Side-panel layout,
  reset-button copy, and which dimensions are exposed in MVP vs
  fast-follow are downstream of this ADR.
- **Follow-on work.** Sub-feature plans must (1) extend
  `searchJobs` with the optional `overlay` arg, (2) thread the arg
  through `/api/scoring/trigger`, (3) build the side panel that
  reads/writes URL params, (4) add a content-lint test that fails
  if any code path appears to write overlay values to the profile
  tables.
