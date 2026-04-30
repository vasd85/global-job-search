# ADR-0001 — Record architecture decisions

## Status

Accepted

## Context

`docs/agents/architecture.md` is the constitution for this project's
agent system, but it captures the *current* state — not the path that
got us there. Decisions accumulate in PR descriptions, scratchpads, and
chat transcripts that are either ephemeral or not greppable in
practice. When a future engineer (often a future version of the same
solo developer) asks "why was this done this way?", the answer
typically requires re-deriving the reasoning from scratch.

We want a lightweight, append-only log of architecturally significant
decisions, sitting alongside the constitution rather than inside it,
so the constitution stays small and the rationale stays preserved.
Michael Nygard's "Documenting Architecture Decisions"
(https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
describes exactly this pattern under the name Architecture Decision
Records (ADRs); it is widely adopted prior art and a good fit at our
scale.

## Decision

We will use Markdown ADRs in `docs/adr/`, named `NNNN-short-slug.md`,
following the Michael Nygard format from
[`0000-template.md`](./0000-template.md) — sections **Status**,
**Context**, **Decision**, **Consequences** in that order.

ADRs are append-only. A merged ADR's Context, Decision, and
Consequences sections are not edited; only the Status field moves
(`Accepted` → `Deprecated` or `Superseded by ADR-XXXX`). When a
decision is superseded, a new ADR is written and its Decision section
references the prior ADR; the prior ADR's Status is updated in the
same PR.

New ADRs land via the same PR review flow as code (Tier 1 per
`docs/agents/architecture.md § 2`). The `/design` skill — when built
per Step 4 of `docs/plans/agent-system.md` — drafts ADRs as a side
effect when a design contains decisions with broad scope, writing
them to `docs/adr/<NNNN>-<slug>.md` on the planning branch.

## Consequences

**Positive.**
- Decision history becomes greppable in a single, predictable
  location.
- Future engineers can reconstruct *why* a choice was made without
  re-deriving the trade-offs.
- New decisions get a structured place to live, separate from the
  constitution; the constitution stays focused on the current state.
- The supersession chain forms an audit trail that survives commit
  squashing and PR-description rot.

**Negative.**
- Minor overhead per non-trivial decision: roughly 10 minutes to
  write a brief ADR.
- Authors must remember to write one; this is a process discipline,
  not enforced by tooling.
- Numbering collisions are possible if two ADRs are drafted in
  parallel branches — resolved at PR-merge time by renaming one.

**Neutral.**
- The supersession chain is maintained manually. At solo-project
  scale this is cheap; if the chain ever grows long enough to make
  manual maintenance error-prone, automation becomes a follow-on
  consideration.
- ADRs do not replace `docs/designs/` — designs describe the *how*
  of a feature; ADRs capture the load-bearing decisions inside that
  design (or anywhere else in the project).
