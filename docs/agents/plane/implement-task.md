# Plane Conventions: /implement-task

## 0. Purpose

This module is loaded by the **`/implement-task`** skill — the skill
that takes a single Work Item from `Backlog` to a merged PR. It
defines branch naming, Plane status transitions, comment templates,
and read contract specific to `/implement-task`.

Universal Plane conventions (workspace identity, bootstrap, state-name
resolution, general failure policy, comment prefix rule, subagent
rule) live in `universal.md` and are loaded alongside this file.

The full state machine is duplicated here so this file is
self-contained when loaded; `log-episode.md` references it for the
`Done` transition.

**Authority.** `architecture.md` § 3 > `universal.md` > this file >
`/plane-integration` skill.

## 1. Branch naming

Per CLAUDE.md `git` section, branch format is `<type>/<short-description>`.
`/implement-task` extends this to:

```
<type>/<short-description>-GJS-<sequence-id>
```

Components:

- `<type>` — Conventional Commits type (`feat`, `fix`, `refactor`,
  `chore`, `docs`, `test`)
- `<short-description>` — derived from the Work Item title, lowercase
  kebab-case, ≤ 5 words. NOT the feature slug — branches are
  short-lived and don't need the date prefix
- `<sequence-id>` — the numeric id Plane assigns the WI (visible as
  `GJS-<n>`; `GJS` is the project identifier from `universal.md` § 1)

Set during step 0 of the `/implement-task` internal pipeline.

Example: `feat/greenhouse-backoff-GJS-12`.

## 2. Status state machine

State is owned by Plane. Transitions automated by `/implement-task`
are listed below; transitions handled by other skills (`/tasks`,
`/log-episode`) are shown for context.

| Transition                | From             | To              | Trigger / actor                                |
|---------------------------|------------------|-----------------|------------------------------------------------|
| WI created                | (new)            | `Backlog`       | `/tasks` (see `tasks.md`)                      |
| Implementation starts     | `Backlog`/`Todo` | `In Progress`   | **`/implement-task` step 0**                   |
| PR opened                 | `In Progress`    | `In Review`     | **`/implement-task` step 6**                   |
| PR merged                 | `In Review`      | `Done`          | `/log-episode` (see `log-episode.md`)          |
| Cancelled                 | any              | `Cancelled`     | manual (user) or `/tasks` reconcile            |

State name resolution rule (call `mcp__plane__list_states`, no
hardcoded UUIDs) lives in `universal.md` § 5.

## 3. Transition guards

Each transition `/implement-task` writes checks the current state
before writing.

**Step 0 (Implementation starts):**

- Expects `Backlog` or `Todo`.
- If already `In Progress`: log a warning and continue (likely a
  re-run after crash).
- If `In Review`, `Done`, or `Cancelled`: abort with
  `"WI <code> is already past Backlog (state: <name>)"`.

**Step 6 (PR opened):**

- Expects `In Progress`. Otherwise abort.

Failed guards are surfaced to the user; skills do not silently
overwrite mismatched states.

## 4. Comment templates

`/implement-task`-authored comments. Prefix rule
(`[<skill> step <N>]`) lives in `universal.md` § 6.

| Trigger                                 | Comment text                                                                                              |
|-----------------------------------------|-----------------------------------------------------------------------------------------------------------|
| Step 0 (start)                          | `` [implement-task step 0] Implementation started on branch `<branch>` ``                                  |
| Step 6 (PR opened)                      | `[implement-task step 6] PR opened: <pr-url>`                                                             |
| MCP failure (graceful, recoverable)     | `[implement-task] WARN: <op> failed (<error>); state may drift — manual fix or skill rerun required`      |

## 5. Read contract

`/implement-task` step 0 reads:

- **Work Item**: `id`, `name`, `state`, `description_html`,
  `external_id`, `parent`, `labels`, `sequence_id`
- **Work Item relations** — `blocked_by` only — verifies all blockers
  are in `Done` state; aborts with `"WI <code> is blocked by <list>"`
  if any blocker is open
- Does NOT read: `comments`, `links`, work-item history, attachments

**Response shaping.** Pass `fields=` and `expand=` parameters to MCP
`retrieve_work_item` and `list_work_item_relations` to keep payloads
small. Follow `/plane-integration` skill guidance.

## 6. Failure recovery

Per-operation rules for `/implement-task`. General logging and
notification policy lives in `universal.md` § 8.

| Operation                            | On failure                                                                              |
|--------------------------------------|-----------------------------------------------------------------------------------------|
| Blocker check (read relations)       | Abort (cannot proceed if blockers cannot be verified)                                   |
| State update step 0                  | Continue (work happens; drift logged in PR description)                                 |
| State update step 6                  | Continue (PR is the canonical record); drift logged                                     |
| Comment posting                      | Continue (comments are convenience; absence is non-fatal)                               |
| Bootstrap validation                 | Abort with `"Bootstrap incomplete: <reason>; see plane/universal.md § 3"`               |
