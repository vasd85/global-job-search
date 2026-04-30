# Phase-state schema

This document specifies the minimum shape every skill must write to its
`phase-state.md` file. The file is the per-session checkpoint that lets
orchestrators resume after interruption and lets `/log-episode` populate
`phases_run` and `duration_min_by_phase` when `events.jsonl` is missing
(see `architecture.md § 9.6`).

## Locations

Per `architecture.md § 5` skill contracts:

- **Feature-level** —
  `.claude/scratchpads/<feature-slug>/phase-state.md`. Used by the
  sequential planning skills (`/research`, `/prd`, `/design`, `/plan`,
  `/tasks`). Only one writer at a time, so a single file is safe.
- **Per-task** —
  `.claude/scratchpads/<feature-slug>/tasks/<wi-code>/phase-state.md`.
  Used by `/implement-task` and `/log-episode`, since multiple parallel
  sessions across Work Items would race on a shared file.

## Format

The file uses **YAML frontmatter** (between two `---` fences) holding
the structured fields, optionally followed by free-form markdown notes
that the skill or user can append. YAML is chosen over JSON because the
file is human-readable and occasionally human-edited; over a markdown
table because frontmatter survives ad-hoc reordering and parses with
trivial libraries; over a single-document YAML file because the trailing
markdown body is a useful escape hatch for breadcrumbs.

## Fields

All fields live inside the frontmatter block.

- **`phase`** — string, required. Current phase name. Examples:
  `research`, `prd`, `design`, `plan`, `tasks`, `implement-task` (or
  one of its internal sub-phases such as `code`, `test-design`,
  `test-write`, `review`, `fix`), `log-episode`. The exact vocabulary
  is owned by each skill's SKILL.md.
- **`started_at`** — ISO 8601 UTC timestamp, required. When the current
  phase began. Set on entry; never rewritten while the phase is in
  progress.
- **`ended_at`** — ISO 8601 UTC timestamp, nullable. `null` while the
  phase is still in progress; set when `status` transitions to
  `complete` or `failed`.
- **`status`** — enum, required. One of:
  - `in-progress` — phase is currently running.
  - `complete` — phase finished successfully; ready for the next phase.
  - `failed` — phase aborted (max review cycles exceeded, subagent
    error, user abort). The skill must surface failure to the user;
    orchestrators must not silently advance past `failed`.
- **`next_phase`** — string, optional. Pointer for orchestrators
  (`/feature`, `/implement-task`) so they can decide where to resume
  after interruption. Omitted when no next phase applies (terminal
  states such as `tasks` or `log-episode`).
- **`cycles`** — integer, required (default `0`). Number of
  evaluator-loop cycles spent on the current phase. Incremented each
  time a writer subagent re-runs after `changes-required`. Capped at 2
  per `architecture.md § 8.2`; if a phase tries to push it past 2, the
  skill must pause for user direction.

Skills may add extra frontmatter keys for their own bookkeeping (e.g.
`token_budget`, `pr_url`); those are not required by this schema and
are not consumed by `/log-episode`'s auto-extraction. Treat them as
skill-private state.

## Worked example

A `phase-state.md` snapshot taken mid-`/plan` review, after one
`changes-required` cycle:

```markdown
---
phase: plan
started_at: 2026-04-30T14:02:11Z
ended_at: null
status: in-progress
next_phase: tasks
cycles: 1
---

# Notes

- plan-reviewer flagged 2 Critical findings on cycle 1: missing DAG
  ids for chunks 3 and 4, and overlapping file ownership between
  chunks 5 and 6.
- writer skill is rewriting the affected sections; reviewer will be
  re-spawned next.
```

When the phase finishes successfully, the skill rewrites the frontmatter
to:

```yaml
phase: plan
started_at: 2026-04-30T14:02:11Z
ended_at: 2026-04-30T14:38:42Z
status: complete
next_phase: tasks
cycles: 2
```

## Per-skill contract

Every skill's SKILL.md must cite this file in its phase-tracking
section and state explicitly:

1. Which `phase` value(s) it writes — including any internal
   sub-phases.
2. Whether it writes the feature-level or the per-task file.
3. When it transitions `status` from `in-progress` to `complete` or
   `failed`, and what its evaluator-loop counts toward `cycles`.

The cross-cutting acceptance check at every later step of
`docs/plans/agent-system.md` is: open the new SKILL.md, confirm it
references this schema and that its declared writes match the fields
above.

## Per-task variant

`/implement-task` writes its phase-state file under
`.claude/scratchpads/<feature-slug>/tasks/<wi-code>/phase-state.md`.
The schema is identical; only the location changes. Two parallel
`/implement-task` sessions across two Work Items therefore write to
two distinct files and never share frontmatter — this is what
`architecture.md § 5` calls out when it says "multiple parallel
sessions would race on a shared file".

`/log-episode`, when invoked as the finale of `/implement-task` or
standalone with `<pr-url>`, writes to the same per-task path so its
own progress (drafting decisions, awaiting user approval, appending
to JSONL) is checkpointed in the same place.
