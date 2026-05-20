---
name: tasks
description: >-
  Fifth phase of the agent-system pipeline. Mirror the merged plan
  at docs/plans/<slug>.md (on main) into Plane: one Epic, N Work
  Items per chunk DAG, blocked_by relations encoding dependencies.
  Mechanical and idempotent — no reviewer subagent. Manual
  invocation only.
disable-model-invocation: true
argument-hint: "<feature-slug>"
---

# Tasks

Mirror the merged plan at `docs/plans/<slug>.md` (on `main`) into
Plane: one Epic per feature, one Work Item per chunk, `blocked_by`
relations per chunk DAG, labels per convention. Mechanical — no
reviewer, no judgement, no subagent. Plan in git = source of truth;
Plane = mirror. Idempotent — a plan-amendment rerun reconciles, never
duplicates. After this skill, user invokes `/implement-task <wi-code>`
for each chunk.

## Inputs and outputs

**Input:** `docs/plans/<slug>.md` reachable from `main` (planning PR
merged); read in the working tree. **Contracts loaded at startup**
(cited below by section, not paraphrased):

- `docs/agents/plane/universal.md` — workspace facts, slug rule, state
  resolution, comment prefix, failure-logging policy.
- `docs/agents/plane/tasks.md` — schemas (§ 4.1 Epic, § 4.2 WI),
  relations (§ 5), labels (§ 6), comments (§ 7), failure recovery (§ 8).

**Output:** Plane state (one Epic, N WIs, M `blocked_by` relations,
labels). No git writes. `phase-state.md` updated; failures appended to
`plane-failures.jsonl` per `universal.md § 7`.

## The four-step flow

### 1. Resolve slug, load contracts, parse plan

User invokes `/tasks <feature-slug>`. Read both contract files in
full, then call the parse helper:

```bash
PARSED=$(bash scripts/tasks/parse-plan.sh <feature-slug>)
EPIC=$(echo "$PARSED" | jq -c .epic)
CHUNKS=$(echo "$PARSED" | jq -c '.chunks[]')
```

Helper validates plan presence, chunk DAG, labels, and required body
sections; emits pre-rendered `description_html` per `tasks.md § 4.1
+ 4.2`. Exit ≠ 0 (single stderr line) → surface and abort with
"re-run `/plan`". Missing PRD does not abort.

### 2. Branch contract + phase-state

Plan must be on `main` for Plane-side GitHub blob links to resolve.
On `main` with clean tree → continue; any other state (branch, dirty
tree, detached HEAD) → abort, ask user to merge the planning PR.

Rewrite `.claude/scratchpads/<slug>/phase-state.md` frontmatter to:
`phase: tasks`, `started_at: <now ISO 8601 UTC>`, `ended_at: null`,
`status: in-progress`, `next_phase: implement-task`, `cycles: 0`.
Capture the current `main` HEAD SHA — used in step 3.5.

### 3. Reconcile Plane

Each sub-step is idempotent and matches the order in `tasks.md`.

#### 3.1 Resolve states

Per `universal.md § 4`: call `mcp__plane__list_states`, resolve
`Backlog`, `In Progress`, `In Review`, `Done`, `Cancelled` ids by
case-insensitive name match. Cache for the run. Missing state →
abort, name it, point user to `bootstrap.md § 2`. `Backlog` is the
create-time state (`tasks.md § 4.1`, § 4.2).

#### 3.2 Reconcile labels

Collect every label string referenced by any chunk plus
`feature:<slug>`. Call `mcp__plane__list_labels` once; for any missing
label, `mcp__plane__create_label` per `tasks.md § 6`. Cache the
name → id map.

#### 3.3 Reconcile Epic

Look up by `external_source = gjs-tasks-skill` AND
`external_id = $EPIC.external_id` via `mcp__plane__list_epics`. Found
→ `mcp__plane__update_epic` with `$EPIC.name`, `$EPIC.description_html`,
`$EPIC.labels`. Not found → `mcp__plane__create_epic` with the same
fields. Cache the Epic id.

#### 3.4 Reconcile Work Items

Iterate `$CHUNKS` in plan order. For each chunk, look up by
`external_source = gjs-tasks-skill` AND `external_id = chunk.external_id`
via `mcp__plane__list_work_items`.

- Found → `mcp__plane__update_work_item` with `chunk.name`,
  `chunk.description_html`, `chunk.labels`, `parent` = Epic id from 3.3.
  Per `tasks.md § 4.2`, do NOT touch `state`, `priority`, `assignees`,
  `start_date`, `target_date`, `estimate_point` — owned by the user or
  `/implement-task`.
- Not found → `mcp__plane__create_work_item` with the same fields plus
  `parent` = Epic id.

Track WI ids for chunks in the plan.

#### 3.5 Cancel orphaned Work Items

List WIs under this Epic with `external_source = gjs-tasks-skill`
whose `external_id` is not in the chunk inventory. State
`Done`/`Cancelled` → skip (never regress closed work); otherwise →
`mcp__plane__update_work_item` to `Cancelled`, then
`mcp__plane__create_work_item_comment` per `tasks.md § 7`:
`[tasks] Chunk removed from plan in <commit-sha>; moved to Cancelled`
(commit-sha is `main` HEAD from step 2).

#### 3.6 Reconcile relations

For each chunk, read edges via `mcp__plane__list_work_item_relations`.
For every blocker id in `depends_on`, ensure a `blocked_by` edge exists
on the chunk's WI pointing at the blocker WI
(`mcp__plane__create_work_item_relation`). Existing `blocked_by` whose
target is no longer in `depends_on` →
`mcp__plane__remove_work_item_relation`. Per `tasks.md § 5`, leave
non-`blocked_by` relations untouched.

### 4. Report and hand off

Print: Epic code (e.g. `GJS-8`) and title; WI
created/updated/cancelled counts; failure count and
`plane-failures.jsonl` path if any.

Derive **unblocked WI codes** — chunks whose `depends_on` is empty.
These are the parallel-safe entry points. Update `phase-state.md`:
`status: complete`, `ended_at: <now ISO 8601 UTC>`,
`next_phase: implement-task`. Print the exact next command for the
user to copy (one or many, depending on how many DAG roots there are):

```
Run next (any unblocked WI; multiple may run in parallel worktrees):

  /implement-task GJS-<n>     # <wi-name>
  /implement-task GJS-<m>     # <wi-name>
  ...
```

Control returns to the user — do NOT invoke `/implement-task`
automatically.

## Phase tracking

Writes the **feature-level** phase-state file at
`.claude/scratchpads/<slug>/phase-state.md`
(`docs/agents/phase-state-schema.md`). `phase: tasks`,
`next_phase: implement-task`; `started_at` set in step 2, `ended_at`
when step 4 finishes; `status: in-progress` → `complete` on success,
`failed` on user abort or unrecoverable Plane error per `tasks.md
§ 8` (Epic create). `cycles: 0` — no reviewer subagent.

## Failure handling

Logging + notification follow `universal.md § 7` (`plane-failures.jsonl`
append, bounded retries with backoff on `429`). Per-operation:

| Operation              | On failure                                                  |
|------------------------|-------------------------------------------------------------|
| Epic create            | Abort entire run; user reruns after triage                  |
| Work Item create       | Continue with remaining WIs; rerun reconciles via § 4.2     |
| Relation create        | Continue; missing relations logged; rerun reconciles        |
| Label create           | Continue without that label; comment on first affected WI   |
| MCP failure (graceful) | Post WARN per `tasks.md § 7`; rerun reconciles              |

No bootstrap-time validation: a misconfigured workspace surfaces via the
failing MCP call's error pointing to `bootstrap.md` (`universal.md § 7`).

## What stays out

- **Git writes.** No branching, commits, or PR — plan stays untouched.
- **Plan editing.** Amend via `/plan` on a new branch + re-merge.
- **State transitions beyond `Backlog` and the orphan→`Cancelled`
  move** (and auto-invoking `/implement-task`). `/implement-task` and
  `/log-episode` own the rest of the WI lifecycle; hand-off is manual.
- **Reviewer subagent / review loop.** Mechanical conversion has no
  judgement layer.

## Language

**Dialogue:** mirror the user. **Plane content (Epic/WI names,
descriptions, comments): always English.**

## When NOT to use this skill

- Plan not yet merged to `main` → wait for the planning PR.
- No plan exists → run `/plan` first.
- Small bug-fix or doc-only change → no plan, no Epic; implement directly.
- Surgical Plane edit (single WI rename, label fix) → edit in Plane UI.
