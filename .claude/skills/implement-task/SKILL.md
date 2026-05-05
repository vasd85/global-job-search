---
name: implement-task
description: >-
  Per-task implementation skill. Take a Plane Work Item id (e.g.
  GJS-12), verify not blocked, branch from current HEAD, run the
  internal Code → Tests → Review pipeline (max 2 fix cycles),
  open a PR, and transition the WI to In Review. Sequential and
  across-WIs parallel launch modes. Manual invocation only.
disable-model-invocation: true
argument-hint: "<wi-code>"
---

# Implement-task

You take one Plane Work Item from `Backlog` to a merged-ready PR.
This is the per-task loop, not the planning chain: one branch, one
PR, one Plane state walk per invocation. The Code → Test design →
Test write → Review pipeline is fixed; fix cycles cap at 2.

## Why this exists

`/tasks` ends at the Plane Epic + Work Items; `/implement-task`
picks up single Work Items afterwards — often in parallel across
WIs. Concentrating the internal pipeline here keeps subagents
(`developer`, `test-scenario-designer`, `test-writer`,
`code-reviewer`) Plane-blind: they get WI fields as plain text and
never write Plane state.

## Inputs and outputs

**Input:** `<wi-code>` like `GJS-12` — a WI created by `/tasks`
(carries `external_id` like `gjs:wi:<feature-slug>:<chunk-id>`).
**Contracts loaded at startup** (cited below by section, not paraphrased):

- `docs/agents/plane/universal.md` — workspace facts, slug rule,
  state resolution (§ 4), comment prefix (§ 5), subagents-don't-call-Plane (§ 6), failure-logging (§ 7).
- `docs/agents/plane/implement-task.md` — branch naming (§ 1),
  state machine (§ 2), transition guards (§ 3), comments (§ 4), read contract (§ 5), failure recovery (§ 6).

**Output:** branch `<type>/<short-description>-GJS-<sequence-id>`
with implementation + test + (optional) fix commits; one open PR;
WI in `In Review`; `phase-state.md`, `test-scenarios.md`,
`code-review.md` under `.claude/scratchpads/<feature-slug>/tasks/<wi-code>/`;
`plane-failures.jsonl` appended on MCP failure per `universal.md § 7`.

## The seven-step flow

### 0. Setup

User invokes `/implement-task GJS-<n>`. Parse `<n>` as integer;
call `mcp__plane__retrieve_work_item_by_identifier(project_identifier="GJS",
issue_identifier=<n>, expand="state,labels")` per
`implement-task.md § 5`. Read both contract files in full. Derive
`<wi-code>` = `GJS-<n>`, `<wi-name>` = title, `<wi-state>` from
expanded state. Parse `external_id` matching
`gjs:wi:<feature-slug>:<chunk-id>` → `<feature-slug>`,
`<chunk-id>`. Null or non-matching `external_id` → abort: `WI
<code> was not created by /tasks (no agent-system external_id) —
manual workflow not supported`.

**Blocker check** per `implement-task.md § 5`. Call
`mcp__plane__list_work_item_relations(work_item_id=<id>)`; filter
`blocked_by`; resolve each blocker's state. Any blocker not in
`Done` → abort with `WI <code> is blocked by [<codes>] (states:
[<states>])`.

**Launch-mode + branch.** Detect mode by comparing
`git rev-parse --show-toplevel` to the repo root path:

| Mode                  | Pre-launch state                                                              | Step 0 branch action                          |
|-----------------------|-------------------------------------------------------------------------------|-----------------------------------------------|
| Sequential (default)  | session in repo root, on `main`, clean tree                                   | `git checkout -b <branch>` from `main`        |
| Parallel (across-WIs) | session in `.claude/worktrees/<wi-code>`, detached HEAD at `main`'s tip, clean | `git checkout -b <branch>` from current HEAD  |

Any other state (non-`main` branch, dirty tree, attached HEAD on
an unrelated branch in a worktree) → abort, surface the state, ask
the user to clean up. Never force-reset/force-checkout/stash; **never
invoke `git worktree add`** — the user creates worktrees before
launching `claude`. Branch name per `implement-task.md § 1`:
`<type>/<short-description>-GJS-<sequence-id>` — `<type>` from the
WI's `type:*` label; `<short-description>` from `<wi-name>` as
kebab-case ≤ 5 words. Suggest a default, confirm, then create.

**Plane In Progress** per `implement-task.md § 2-3`. Expects
`Backlog` or `Todo`; already `In Progress` → log warning and continue
(re-run after crash); `In Review`/`Done`/`Cancelled` → abort with
`WI <code> is already past Backlog (state: <name>)`. Resolve
`In Progress` id per `universal.md § 4` (`mcp__plane__list_states`,
case-insensitive name, cached). `mcp__plane__update_work_item(state=<id>)`,
then `mcp__plane__create_work_item_comment` per `implement-task.md § 4`
step-0: `` [implement-task step 0] Implementation started on branch `<branch>` ``.
Then rewrite the per-task `phase-state.md` frontmatter (see Phase tracking) — replace prior content on re-run, never append.

### 1. Code (`developer`)

Spawn `developer` in fresh context with WI name, description, files
(from the description's "Files (expected)" section), and acceptance
criteria as plain text per `universal.md § 6`. Subagent commits on
the current branch; no Plane access.

### 2. Test design (`test-scenario-designer`)

Spawn `test-scenario-designer` with the WI fields and the
implementation diff range. Output:
`.claude/scratchpads/<feature-slug>/tasks/<wi-code>/test-scenarios.md`.
Read-only — no commits.

### 3. Test write (`test-writer`)

Spawn `test-writer` with the test-scenarios path. Subagent writes
test commits on the current branch.

### 4. Review (`code-reviewer`)

Spawn `code-reviewer` with the diff range (current branch vs
`main`) and the WI's acceptance criteria. Output:
`.claude/scratchpads/<feature-slug>/tasks/<wi-code>/code-review.md`.
Read the verdict — first non-empty line under `### Verdict` is
`approved` or `changes-required`. `approved` → step 6;
`changes-required` → step 5.

### 5. Fix cycle (`developer` re-spawned, max 2)

Re-spawn `developer` in fresh context with the code-review file as
input. Subagent makes fix commits. Increment `cycles` in
phase-state. Loop back to step 4. Test design (step 2) is **not**
re-run — `code-reviewer` sees code with tests in one pass and
catches code/test mismatches; this ordering is deliberate.

Maximum **2 cycles**. After 2 cycles still `changes-required`:
surface remaining findings, set `phase-state.md` `status: failed`,
pause for user direction (override / defer / abort). Do not loop
unbounded.

### 6. PR + Plane In Review

Per `implement-task.md § 2-3` step-6 guard: WI must be
`In Progress`; otherwise abort. Open the PR with
`gh pr create --title "<conventional-commit-title>" --body "<auto-generated body>"`.
The pre-pr-checks hook gates this (typecheck + lint + tests); on
hook failure, surface and pause. **Never bypass with `--no-verify`**;
fix the underlying breakage.

After the PR opens:
`mcp__plane__update_work_item(state=<In Review id>)`, then
`mcp__plane__create_work_item_comment` per `implement-task.md § 4`
step-6: `[implement-task step 6] PR opened: <pr-url>`. Update
`phase-state.md`: `status: complete`,
`ended_at: <now ISO 8601 UTC>`. Tell the user the PR URL.
**Finale handoff:** if the user merges the PR in this same session,
invoke `/log-episode` (no argument — finale mode); otherwise the user
runs `/log-episode <pr-url>` later in a fresh session (standalone mode).
`/log-episode` is the only sanctioned auto-invocation.

## Phase tracking

Per-task path
`.claude/scratchpads/<feature-slug>/tasks/<wi-code>/phase-state.md`
(per-task, not feature-level, so sibling-WI sessions don't race),
schema at `docs/agents/phase-state-schema.md`. `phase: implement-task`,
`next_phase: log-episode`; `started_at` set in step 0, `ended_at`
when step 6 finishes; `status: in-progress` → `complete` on PR open,
`failed` on cycle exhaustion or user abort; `cycles: 0` → `+1` per
step-5 fix loop, capped at 2.

## Failure handling

Per `universal.md § 7` (`plane-failures.jsonl` append, user
notification, bounded retries with backoff on `429`). Per-operation
rules from `implement-task.md § 6`:

| Operation                       | On failure                                              |
|---------------------------------|---------------------------------------------------------|
| Blocker check (read relations)  | Abort                                                   |
| State update step 0             | Continue (work happens; drift logged in PR description) |
| State update step 6             | Continue (PR is the canonical record); drift logged     |
| Comment posting                 | Continue (comments are convenience; absence non-fatal)  |
| MCP failure (graceful)          | Post WARN per `implement-task.md § 4`; rerun if drift   |

No bootstrap-time validation: a misconfigured workspace surfaces
via the failing MCP call's error pointing to `bootstrap.md` per `universal.md § 7`.

## What stays out

- **WI / label / relation creation, orphan cancellation** — `/tasks` owns the Plane mirror.
- **`Done` transition and episode log** — `/log-episode` runs after PR merge.
- **PRD / design / plan editing** — re-run the planning skills on a new branch.
- **`git worktree add` and merging the PR** — user creates worktrees; skill ends at `In Review`.
- **`--no-verify`** or other pre-pr-checks bypass — fix the breakage; never skip the gate.

## Language

**Dialogue:** mirror the user's language. **Plane comments and PR
title/body: always English** — read by downstream agents.

## When NOT to use this skill

- WI not created by `/tasks` (no `gjs:wi:...` `external_id`) → implement directly.
- Multi-PR scope → split via `/plan` rerun + `/tasks` rerun first.
- Ad-hoc fix with no Plane WI → branch and PR per `CLAUDE.md § Git`.
