# ADR-0012 — Canonical merge strategy for `/log-episode` finale

## Status

Accepted

## Context

`/log-episode`'s finale step closes a per-task PR with `gh pr merge`,
and recent PRs were inconsistent about which flag accompanies the
call: PR #46 (GJS-21) used `--merge`, PR #47 (GJS-23) used `--squash`.
The post-GJS-23 SKILL.md and `docs/agents/architecture.md` then froze
`--squash --delete-branch` without recording a rationale.

For a solo project, the trade-offs around merge strategy matter
differently than in a large-team monorepo:

- Each PR carries 2-4 meaningful Conventional Commits already grouped
  by logical change. `--squash` flattens them into one, losing
  intra-PR granularity that `git blame` and `git log` rely on for
  per-change attribution.
- The episode log (`docs/episodes/<YYYY-MM>.jsonl`) cites
  feature-branch SHAs in fields like `phase-state.md` references and
  decision narratives. `--rebase` would rewrite those SHAs and break
  the citations after merge.
- `main` history is read by hand, not by CI throughput tooling; one
  merge commit per PR is cheap and reversible via `--first-parent`
  filtering when a PR-level overview is wanted.

## Decision

We will use `gh pr merge --merge --delete-branch` as the canonical
flag set for `/log-episode`'s finale (step 5(f)). We will not use
`--squash` (loses intra-PR granularity) or `--rebase` (rewrites SHAs,
invalidates episode-log citations, forces `git branch -D` because
branch tips become unreachable from `main`).

## Consequences

- **Positive — SHA stability.** Feature-branch commit SHAs remain
  reachable from `main` after merge, so episode JSONL / phase-state /
  Slack citations stay valid indefinitely.
- **Positive — graph-visible PR boundaries.** Each PR contributes one
  merge commit to `main`; `git log --first-parent main` gives a clean
  PR-level overview when wanted, and the full per-commit history is
  recoverable by dropping the flag.
- **Positive — clean `branch -d` after merge.** Because feature
  commits are reachable from `main` via the merge commit, plain
  `git branch -d <feature-branch>` works without force.
- **Negative — `main` accumulates one extra merge commit per PR.**
  Cosmetic only; trivially filtered with `--first-parent`.
- **Neutral — historical PRs (#46 merge-commit, #47 squash) stay
  as-is.** The convention applies to PRs merged on or after
  GJS-24; no rewrite of prior history.
