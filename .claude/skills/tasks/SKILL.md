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
reviewer, no judgement, no subagent. After this skill, the user
invokes `/implement-task <wi-code>` for each chunk.

## Why this exists

Plan in git = source of truth for the chunk DAG; Plane = execution
mirror. Concentrating Plane writes here (plus `/implement-task`,
`/log-episode`) keeps planning skills git-only. Idempotency is
load-bearing — rerunning after a plan amendment must reconcile, not
duplicate.

## Inputs and outputs

**Input:** `docs/plans/<slug>.md` reachable from `main` (planning PR
merged); read in the working tree. **Contracts loaded at startup**
(cited below by section, not paraphrased):

- `docs/agents/plane/universal.md` — workspace facts, slug rule, state
  resolution, comment prefix, failure-logging policy.
- `docs/agents/plane/tasks.md` — schemas (§ 4.1 Epic, § 4.2 WI),
  relations (§ 5), labels (§ 6), comments (§ 7), failure recovery (§ 8).

**Output:** Plane state (one Epic, N WIs, M `blocked_by` relations,
labels). No git writes. `phase-state.md` updated;
`plane-failures.jsonl` appended on MCP failure per `universal.md § 7`.

## The four-step flow

### 1. Resolve slug, load contracts, parse plan

User invokes `/tasks <feature-slug>`. Verify `docs/plans/<slug>.md`
exists; if missing, abort (ask user to confirm slug or merge the
planning PR). Read both contract files in full.

Parse the chunk inventory. Each chunk is a `### Chunk <id> — <title>`
heading followed by a fenced YAML block (`id`, `depends_on` (possibly
`[]`), `labels` — exactly one `type:*` plus `feature:<slug>`), then
`**Goal.**`, `**Files.**`, `**Acceptance criteria.**` body sections.
Extract all of these plus the title (after em-dash).

Validate: every chunk has its YAML block; every `depends_on` id
resolves to another chunk's `id`; DAG is acyclic; required labels
present. Any failure aborts with "re-run `/plan`" — `plan-reviewer`
would have caught these, so failure here implies a hand-edited plan.

### 2. Branch contract + phase-state

Plane-only writes; never force-reset or stash. The plan must be on
`main` for Plane-side GitHub blob links to resolve. On `main` with
clean tree → continue; any other state (branch, dirty tree, detached
HEAD) → abort, ask user to merge the planning PR and rerun.

Rewrite `.claude/scratchpads/<slug>/phase-state.md` frontmatter to:
`phase: tasks`, `started_at: <now ISO 8601 UTC>`, `ended_at: null`,
`status: in-progress`, `next_phase: implement-task`, `cycles: 0`.
Capture the current `main` HEAD SHA — used in step 3.5 for
cancellation comments.

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

Look up via `mcp__plane__list_epics` filtered by
`external_source = gjs-tasks-skill` AND
`external_id = gjs:epic:<feature-slug>`. Found →
`mcp__plane__update_epic` refreshing `name`, `description_html`,
`labels` per `tasks.md § 4.1`; not found → `mcp__plane__create_epic`
per `tasks.md § 4.1`. Cache the Epic id.

#### 3.4 Reconcile Work Items

For each chunk in plan order, look up via
`mcp__plane__list_work_items` filtered by
`external_source = gjs-tasks-skill` AND
`external_id = gjs:wi:<feature-slug>:<chunk-id>`.

- Found → `mcp__plane__update_work_item` refreshing `name`,
  `description_html`, `labels`, `parent` (Epic id from 3.3). Per
  `tasks.md § 4.2`, do NOT modify `state`, `priority`, `assignees`,
  `start_date`, `target_date`, `estimate_point` — those belong to the
  user or `/implement-task`.
- Not found → `mcp__plane__create_work_item` per `tasks.md § 4.2`
  with `parent` = Epic id.

Track WI ids for chunks in the plan.

#### 3.5 Cancel orphaned Work Items

List WIs under this Epic with `external_source = gjs-tasks-skill`
whose `external_id` is not in the chunk inventory. For each orphan:
state `Done`/`Cancelled` → skip (never regress closed work);
otherwise → `mcp__plane__update_work_item` to `Cancelled`, then
`mcp__plane__create_work_item_comment` with the `tasks.md § 7`
template: `[tasks] Chunk removed from plan in <commit-sha>; moved
to Cancelled`. `<commit-sha>` is the `main` HEAD from step 2.

#### 3.6 Reconcile relations

For each chunk, read current edges via
`mcp__plane__list_work_item_relations`. For every blocker id in
`depends_on`, ensure a `blocked_by` edge exists on the chunk's WI
pointing at the blocker WI (create via
`mcp__plane__create_work_item_relation`). Existing `blocked_by` whose
target is no longer in `depends_on` →
`mcp__plane__remove_work_item_relation`. Per `tasks.md § 5`, leave
non-`blocked_by` relations untouched.

### 4. Report and hand off

Print: Epic code (e.g. `GJS-8`) and title; WI
created/updated/cancelled counts; failure count and
`plane-failures.jsonl` path if any. Update `phase-state.md`:
`status: complete`, `ended_at: <now ISO 8601 UTC>`,
`next_phase: implement-task`. Tell the user `/implement-task <wi-code>`
is the next manual step.

## Phase tracking

Writes the **feature-level** phase-state file at
`.claude/scratchpads/<slug>/phase-state.md`, schema at
`docs/agents/phase-state-schema.md`. `phase: tasks`,
`next_phase: implement-task`; `started_at` set in step 2, `ended_at`
when step 4 finishes; `status: in-progress` → `complete` on success,
`failed` on user abort or unrecoverable Plane error per `tasks.md
§ 8` (Epic create). `cycles: 0` — no reviewer subagent; mechanical
conversion has no evaluator loop, so this counter never moves.

## Failure handling

Logging and notification follow `universal.md § 7`
(`plane-failures.jsonl` append, user notification, bounded retries
with backoff on `429`). Per-operation rules from `tasks.md § 8`:

| Operation         | On failure                                                              |
|-------------------|-------------------------------------------------------------------------|
| Epic create       | Abort entire run; user reruns after triage                              |
| Work Item create  | Continue with remaining WIs; report partial; rerun reconciles via § 4.2 |
| Relation create   | Continue; missing relations logged; rerun reconciles                    |
| Label create      | Continue without that label; comment on first affected WI               |

No bootstrap-time validation: a misconfigured workspace surfaces via the
failing MCP call's error message pointing to `bootstrap.md` per `universal.md § 7`.

## What stays out

- **Git writes.** No branching, commits, or PR — the plan in git stays untouched.
- **Plan editing.** Amend by re-running `/plan` on a new branch and re-merging.
- **State transitions beyond `Backlog` and the orphan→`Cancelled`
  move** (and auto-invoking `/implement-task`). `/implement-task` and
  `/log-episode` own the rest of the WI lifecycle; hand-off is manual.
- **Reviewer subagent / review loop.** Mechanical conversion has no
  judgement layer, so `cycles` stays at 0.

## Language

**Dialogue:** mirror the user's language. **Plane content (Epic and
WI name/description, comments): always English** — Plane is read by
downstream agents and the rest of `docs/` is English.

## When NOT to use this skill

- Plan not yet merged to `main` → wait for the planning PR.
- No plan exists for the slug → run `/plan` first.
- Small bug fix or doc-only change → no plan, no Epic; implement directly.
- Surgical Plane edit (single WI rename, label fix) → edit in Plane UI.
