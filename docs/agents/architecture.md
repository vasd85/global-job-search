# Agent System Architecture

## 0. Purpose

This document describes the target architecture for the agent system that
supports development of `global-job-search` across the full SDLC — from
idea capture through implementation to post-merge knowledge persistence.

It is the **constitution** for agents and slash-skills operating in this
repository. Skills, subagents, and hooks must align with the principles
and tier rules below; deviations require updating this document first.

The architecture is grounded in the principles laid out in
`~/Documents/Notes/AI/sdlc_agent_system_baseline.md` (two-axis information
hierarchy, Truth vs Acceleration, promotion gates, sub-agent isolation).
This document is the project-specific compilation of that framework, not
a restatement of it.

## 1. Load-bearing principles

The system holds the following invariants. They are not optimisations —
breaking any of them defeats the design.

1. **Tier-based memory.** Every artefact is classified as Tier 1 (project
  canon, high-precision), Tier 2 (working derivatives, lower-precision)
   or Tier 3 (external references, high-precision but outside our scope).
   Untiered artefacts are invisible to the system.
2. **Workflow before agent.** SDLC phases are predefined and run as a
  prompt-chain. Dynamic orchestrator-workers decomposition is not used:
   it is more expensive, harder to debug, and the SDLC phase sequence is
   stable.
3. **Sub-agents only for context isolation.** A sub-agent is spawned when
  one workflow's noise would poison another's reasoning (research vs
   spec-writing, implement vs review). Not for division of labour.
4. **Evaluator-optimizer on critical phases.** Every load-bearing
  artefact (PRD, plan, code) is reviewed by a separate subagent in a
   fresh context. Writers do not self-review.
5. **Truth vs Acceleration is enforced.** Canonical stores are git
  (documents, code) and Plane (work items). Scratchpads, indexes and
   per-session caches are derived and fully rebuildable.
6. **One canonical writer per Tier 1 store.** Each Tier 1 store has
  a designated write mechanism: git documents and code are written
   through PR review only; Plane work items are written by exactly
   three skills (`/tasks`, `/implement-task`, `/log-episode`) per
   the lifecycle in § 3. Tier 2 (episode log) is written by a skill's
   finale or by `/log-episode`, never silently by hooks. Tier 3 is
   read-only.
7. **Promotion is explicit.** Nothing moves from Tier 2 to Tier 1
  automatically. ADRs, rule updates and CLAUDE.md changes go through
   PRs with human approval.
8. **Code-write operations always go through PR.** No agent commits to
  `main`. No agent edits files outside its branch.
9. **Parallel execution is first-class.** The plan phase emits a DAG of
  chunks; independent chunks run in parallel as separate
   `/implement-task` sessions in worktrees. Sequential coupling is the
   exception, not the default.
10. **Per-skill module loading.** Reference documents consumed by
  multiple skills are split into a universal core and per-skill
    modules. Each skill loads only the universal core plus its own
    module, not the full reference. This bounds context cost as the
    number of skills grows and keeps each skill's working set small.
    First instance: `docs/agents/plane/` (see § 3).

## 2. Tier map

### Tier 1 — project canon

Two stores with different write mechanisms — git (via PR review)
and Plane (via the three Plane-writing skills). Both are canonical;
neither is reduced to "external" or "read-only".


| Artefact                           | Store     | Location / access                                   | Lifecycle                                  |
| ---------------------------------- | --------- | --------------------------------------------------- | ------------------------------------------ |
| Root constitution                  | git       | `CLAUDE.md`                                         | rare, deliberate updates                   |
| Project conventions / module rules | git       | `.claude/rules/*.md`                                | per-module, rare updates                   |
| Product Requirements Documents     | git       | `docs/product/<slug>.md`                            | one per feature, locked after PR           |
| Technical designs                  | git       | `docs/designs/<slug>.md`                            | one per feature (when needed)              |
| Implementation plans               | git       | `docs/plans/<slug>.md`                              | one per feature, derived from PRD + design |
| Architecture Decision Records      | git       | `docs/adr/<NNNN>-<slug>.md`                         | append-only, status moves only             |
| This architecture document         | git       | `docs/agents/architecture.md`                       | edited as the system evolves               |
| Plane work items + comments        | Plane     | workspace `gjs` via `mcp__plane__*`                 | created by `/tasks`; transitioned by `/implement-task` and `/log-episode` per § 3 |


The three feature-specific document types — PRD, design, plan — answer
different questions and have different lifecycles:

- **PRD** (`docs/product/`) — *what* and *why*, business level. Audience:
downstream agents and the user. Stable once approved.
- **Design** (`docs/designs/`) — *how technically*, architecture, data
models, API contracts, rejected alternatives. Audience: planner and
implementer. Survives implementation refactors. Optional for trivial
features.
- **Plan** (`docs/plans/`) — *in what order*, decomposition into chunks
with explicit dependency DAG, files touched, test strategy. Audience:
the `/tasks` skill and implementer. Specific to the current iteration.

### Tier 2 — working derivatives


| Artefact                           | Location                                               | Lifecycle                     |
| ---------------------------------- | ------------------------------------------------------ | ----------------------------- |
| Per-feature working scratchpad     | `.claude/scratchpads/<feature-slug>/`*                 | ephemeral, per session        |
| Per-task implementation scratchpad | `.claude/scratchpads/<feature-slug>/tasks/<task-id>/*` | ephemeral, per task           |
| Episode log (canonical)            | `docs/episodes/<YYYY-MM>.jsonl`                        | append-only, monthly rotation |


The episode log is the **only Tier 2 artefact that is canonical and
append-only**. Everything in `.claude/scratchpads/` is ephemeral and
gitignored.

### Tier 3 — external references (read-only, on-demand)


| Reference                         | Access                               |
| --------------------------------- | ------------------------------------ |
| Own codebase                      | `Read` / `Glob` / `Grep` tools       |
| Project database                  | `mcp__postgres__execute_sql` (dbhub) |
| Browser automation (verification) | `mcp__claude-in-chrome__*`           |
| Personal Drive (occasional notes) | `mcp__claude_ai_Google_Drive__*`     |
| Framework / library docs          | (future) Context7 or equivalent MCP  |


Code is special: writing it makes it Tier 1, reading it is Tier 3. The
boundary is the PR. Plane reads by skills outside the three writers
(e.g., a future read-only summarisation skill) follow the same
boundary — Tier 1 only when the skill is one of the canonical
writers performing its designated transitions.

### Non-normative reference

`docs/archive/` holds historical documents — legacy domain notes,
superseded research, archived PRDs. These are **not** Tier 1: they are
not authoritative, may be stale, and reflect prior states of the
project rather than current intent. Skills and agents do **not** read
`docs/archive/` automatically; it is only consulted when a human
explicitly references a specific archived document. Treat as Tier 3 for
the purpose of read access (on-demand, read-only), but with the
explicit caveat that the content is internal-and-stale rather than
external-and-current.

## 3. Plane positioning

Plane stores **only** Work Items (atomic tasks) and their organising
parent Epics. It does **not** store documents. Modules and Cycles
exist in Plane's data model but are unused per `plane/tasks.md § 1`.

- PRDs, designs, plans, ADRs all live in git under `docs/`.
- Work Items reference git documents via `main`-branch URLs.
- Work Items are created **only after** the planning PR is merged. This
prevents 404 links from un-merged branches.
- Work Item description contains: link to plan in `main`, link to parent
Epic, brief acceptance criteria.
- **Dependencies between Work Items** are encoded as Plane
work-item-relations of type `blocked_by`. The `/tasks` skill creates
these from the DAG declared in the plan.

This creates a single directional flow: **git is the source of truth,
Plane is the execution surface.** Plane never writes back to git.

### Work Item status lifecycle

Status is owned by Plane (not derived from git). Most transitions
happen automatically through skills calling Plane MCP; some are left
manual on purpose, because automating them would only mask user
intent.


| Trigger                              | Actor                    | Status transition                      | Side effect (comment in Work Item)            |
| ------------------------------------ | ------------------------ | -------------------------------------- | --------------------------------------------- |
| Work Item created from plan DAG      | `/tasks`                 | initial state (Plane default: Backlog) | none                                          |
| `/implement-task <wi-code>` invoked  | `/implement-task` step 0 | → `In Progress`                        | "Implementation started on branch `<branch>`" |
| `gh pr create` succeeds              | `/implement-task` step 6 | → `In Review`                          | "PR opened: `<pr-url>`"                       |
| PR merged into `main`                | `/log-episode <pr-url>`  | → `Done`                               | "Merged: `<pr-url>` (commit `<sha>`)"         |
| Plan rerun removes chunk             | `/tasks` reconcile       | → `Cancelled`                          | "Chunk removed from plan in `<commit-sha>`"   |
| Feature cancelled / Work Item killed | user (Plane UI)          | → `Cancelled`                          | manual                                        |
| Backlog grooming (re-priority, etc.) | user (Plane UI)          | within Plane workflow                  | manual                                        |


**State name caveat.** Plane allows custom workflow states per project.
The names above (`Backlog`, `In Progress`, `In Review`, `Done`,
`Cancelled`) are the assumed default. Skills must read project state
list at startup (`mcp__plane__list_states`) and map to the closest
existing state, not assume hardcoded names.

**Failure mode.** If a Plane MCP call fails (server down, rate-limit,
auth), the skill must **not** silently continue — it logs the failure
to scratchpad and reports to the user. Status drift between git and
Plane is acceptable temporarily; silent drift is not.

### Operational conventions

The operational rules for working with the project's Plane workspace
are split per § 1 invariant 10 (per-skill module loading) into:

- `docs/agents/plane/universal.md` — workspace identity, feature
slug, state-name resolution, general failure policy, comment prefix
rule, subagent rule. Loaded by every Plane-using skill.
- `docs/agents/plane/tasks.md` — entity scope, hierarchy, naming,
Epic and Work Item schemas, labels, relations. Loaded only by
`/tasks`.
- `docs/agents/plane/implement-task.md` — branch naming, status
transitions, comment templates, read contract. Loaded only by
`/implement-task`.
- `docs/agents/plane/log-episode.md` — `Done` transition, comment
templates, read contract. Loaded only by `/log-episode`.
- `docs/agents/plane/bootstrap.md` — one-time workspace setup
checklist (feature flags, required states, demo cleanup). **Not
loaded by any skill** — consulted manually during project setup or
when an MCP failure suggests a misconfiguration.

This document (§ 3) defines *what* Plane is for and the public
contracts (link policy, work-item-relation use, status lifecycle
overview); the modules above define *how* skills carry it out.

## 4. Pipeline phases

The SDLC pipeline has **two distinct levels** that must not be
conflated:

- **Per-feature workflow** (phases 1-5) — a one-shot chain executed
once per feature. Produces planning artefacts and a list of Work
Items in Plane. Orchestrated by `/feature`.
- **Per-task loop** (phases 6-7) — repeated for each Work Item, often
in parallel for independent tasks. Each iteration produces one PR
and one episode log entry. Triggered manually per Work Item.

Plus one **standalone periodic activity** (phase 8 — Promotion).

### 4.1 Per-feature workflow (one-shot, /feature orchestrates)


| #   | Phase    | Skill       | Input            | Output                              | Gate before next                          | Required reviewer |
| --- | -------- | ----------- | ---------------- | ----------------------------------- | ----------------------------------------- | ----------------- |
| 1   | Research | `/research` | topic / question | `scratchpads/<slug>/research.md`    | human approval (no commit)                | optional          |
| 2   | PRD      | `/prd`      | research note    | `docs/product/<slug>.md` (commit)   | reviewer pass + commit on planning branch | **prd-reviewer**  |
| 3   | Design   | `/design`   | PRD              | `docs/designs/<slug>.md` (commit)   | reviewer pass + commit on planning branch | optional          |
| 4   | Plan     | `/plan`     | PRD + design     | `docs/plans/<slug>.md` (commit)     | reviewer pass + **PR-merge to main**      | **plan-reviewer** |
| 5   | Tasks    | `/tasks`    | merged plan      | Plane Epic + Work Items + relations | none (mechanical)                         | none              |


**Branch strategy for the planning phase.** Phases 2-4 all commit to
**one** branch — `plan/<slug>` — sequentially. There is no PR between
PRD and Design, or between Design and Plan; the reviewer subagent at
each phase provides the quality gate, not a separate PR. After phase 4
finishes (plan written, plan-reviewer passes), `/feature` (or the user)
opens a single PR closing the entire planning phase. After this PR
merges to `main`, phase 5 (`/tasks`) runs against `main` and creates
Plane Work Items with stable `main`-branch URLs.

This results in **one PR per feature for planning** (phases 2-4
together), and **N PRs per feature for implementation** (one per Work
Item, phase 6).

**Conditional /design.** Phase 3 is skipped for trivial features (1-2
files, no architectural decisions, no new data models, no new API
contracts). The orchestrator decides based on the PRD's complexity
signals; if uncertain, it asks the user. When skipped, `/plan` reads
only the PRD.

`/feature <topic>` chains phases 1-5 in a single session. After phase 5,
the orchestrator hands control back to the user with the list of Work
Item ids. The chain does **not** continue into phases 6-7 because
implementation spans multiple sessions and blocks on PR merge cycles.

**Partial-failure recovery.** If `/feature` is interrupted mid-chain
(crash, rate-limit, manual abort), re-invoking `/feature <slug>` resumes
from the most recent sub-skill's `phase-state.md` rather than restarting
or handing off. Each sub-skill rewrites `phase-state.md` for its phase;
the orchestrator reads `(status, next_phase)` and dispatches to the next
step. Resume contract details live in `.claude/skills/feature/SKILL.md`.

### 4.2 Per-task loop (parallel-capable, manually triggered)

For each Work Item (in dependency-respecting order, possibly in
parallel):


| #   | Phase     | Skill             | Input        | Output                                    | Gate                     | Required reviewer |
| --- | --------- | ----------------- | ------------ | ----------------------------------------- | ------------------------ | ----------------- |
| 6   | Implement | `/implement-task` | Work Item id | branch + PR + tests                       | PR-merge + reviewer pass | **code-reviewer** |
| 7   | Episode   | `/log-episode`    | PR url       | append to `docs/episodes/<YYYY-MM>.jsonl` | none (manual approval)   | none              |


**Two distinct levels of parallelism.** The architecture distinguishes
parallelism *within* a Work Item from parallelism *across* Work Items.
They use different mechanisms, have different lifecycle owners, and
produce a different number of PRs. Conflating them led to design
errors in earlier drafts of this document — keep them separate.


| Aspect             | Across Work Items (new)                           | Within one Work Item (reused)                      |
| ------------------ | ------------------------------------------------- | -------------------------------------------------- |
| Use case           | many WIs in flight simultaneously                 | a single WI's chunks parallelised internally       |
| Mechanism          | concurrent top-level Claude Code sessions         | `Agent({ isolation: "worktree" })` subagents       |
| Top-level sessions | N (one per WI)                                    | 1 (orchestrator)                                   |
| Worktree owner     | user (created before launching `claude` in it)    | Agent tool (created automatically by `isolation`)  |
| Lifecycle owner    | user (manual launch and cleanup)                  | orchestrator skill (worktree disposable on return) |
| Branches and PRs   | N branches → N PRs → N merges                     | 1 branch, 1 PR, 1 merge (subagent branches merge locally first) |
| Provenance         | new in this architecture; no prior precedent here | reused unchanged from current `/implement` Phase 3 |


The within-WI mechanism is the existing `/implement` Phase 3 pattern
(see `.claude/skills/implement/SKILL.md` "Parallel chunks") and is
carried forward as-is for any subagent parallelism a future skill
needs. It does *not* produce multiple PRs — subagent branches merge
into a single feature branch before the PR is opened. The across-WI
mechanism is genuinely new for this project; it is not "proven by"
the within-WI pattern, only conceptually adjacent.

In practice each Work Item is meant to be atomic
(`docs/agents/plane/tasks.md § 2`), so within-WI subagent parallelism
is an available tool but not the expected default — most parallelism
happens across WIs.

**Across-WI: who creates the worktree.** The skill never invokes
`git worktree add` — it cannot meaningfully `cd` into a tree from
inside an already-running session. The user creates the worktree
manually before launching the parallel session in it:

```bash
# From any existing terminal — detached HEAD at main's tip:
git worktree add --detach .claude/worktrees/<wi-code> main
cd .claude/worktrees/<wi-code>
claude
# In the new session:
/implement-task <wi-code>
```

`--detach` is intentional: it leaves the worktree on a detached HEAD
so `/implement-task` step 0 can `git checkout -b <branch>` cleanly
without colliding with a default branch git would otherwise create.
See § 6.1 step 0 for the contract the skill enforces.

**File-overlap policy.** Independent Work Items must touch disjoint
files; this is enforced **upstream by `/plan`**. When emitting the
chunk DAG, `/plan` detects file overlap and adds `blocked_by`
relations between chunks that share files, so they cannot be picked
up in parallel. If `/plan` misses an overlap and two parallel
branches end up touching the same file, the conflict surfaces at
PR-merge time — whichever PR merges second must rebase. This falls
back to ordinary git merge semantics; skills implement no
synchronisation primitives, locks, or cross-session coordination.

**Worktree cleanup.** Cleanup after a merged PR (`git worktree
remove .claude/worktrees/<wi-code>` and branch deletion) is a manual
post-merge step. `/log-episode` may surface a reminder; the cleanup
policy under multiple concurrent sessions is the open question
specifically about parallel worktrees — see § 13.

**Episode log timing.** `/log-episode` runs after PR merge. It can be
invoked as the finale of a `/implement-task` session that survived
through merge, or standalone as `/log-episode <pr-url>` if the merge
happened later or in a different session.

### 4.3 Standalone (periodic, manual)


| #   | Phase     | Skill                       | Trigger                         | Output                                  |
| --- | --------- | --------------------------- | ------------------------------- | --------------------------------------- |
| 8   | Promotion | (future) `/promote-pattern` | Pattern observed in 3+ episodes | PR updating CLAUDE.md / rules / new ADR |


Phase 8 is not part of the per-feature or per-task workflow. It runs
periodically (e.g., monthly) when the episode log accumulates enough
data to surface patterns. See § 10 (Promotion gate).

## 5. Skills

Target skill inventory. Status column shows current state.


| Skill                 | Status           | Replaces                                  | Notes                                                                |
| --------------------- | ---------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `/research`           | TO BUILD         | (extracted from `/product-research`)      | Discovery + external research; isolated context                      |
| `/prd`                | TO BUILD         | (extracted from `/product-research`)      | Reads research, writes PRD; reviewer required                        |
| `/design`             | TO BUILD         | (extracted from `/code-architect`)        | Conditional; reads PRD, writes design + ADRs                         |
| `/plan`               | TO BUILD         | (extracted from `/implement` Phase 2)     | Reads PRD + design, writes plan with DAG                             |
| `/tasks`              | TO BUILD         | (new)                                     | Plan → Plane Epic + Work Items + relations                           |
| `/feature`            | TO BUILD         | (replaces `/implement` chain)             | Chain orchestrator phases 1-5                                        |
| `/implement-task`     | TO BUILD         | (extracted from `/implement` Phase 3-7)   | One Work Item → branch + PR                                          |
| `/log-episode`        | TO BUILD         | (new)                                     | Standalone episode log writer (also finale of `/implement-task`)     |
| `/promote-pattern`    | TO BUILD (later) | (new)                                     | Surfaces patterns from episode log; drafts promotion PR              |
| `/product-research`   | DEPRECATE        | →`/research` + `/prd`                     | Keep working until both replacements ready                           |
| `/implement`          | DEPRECATE        | →`/plan` + `/implement-task` + `/feature` | Keep working until all replacements ready                            |
| `/plane-integration`  | KEEP             | —                                         | Reference map, used by `/tasks`                                      |
| `/pre-pr`             | KEEP             | —                                         | Lightweight quality gate for ad-hoc commits                          |
| `/code-architect`     | KEEP             | —                                         | Standalone architectural planning (also wrapped by `/design`)        |
| `/review`             | KEEP             | —                                         | Standalone code review                                               |
| `/analyze-skill-logs` | KEEP             | —                                         | Forensic drill-down into skill-logs; not part of pipeline (see §9.6) |


### Skill contracts

Every skill follows the same interface contract:

- **Input**: explicit file path or Plane id, never free-form prose where
a structured reference exists.
- **Output**: a single artefact at a known location (file path or Plane
entity id).
- **Phase tracking**: writes start/end timestamps and status to a
`phase-state.md` file for session recovery and episode log
telemetry. Path is feature-level
(`.claude/scratchpads/<feature-slug>/phase-state.md`) for the
sequential planning skills (`/research`, `/prd`, `/design`,
`/plan`, `/tasks`); per-task
(`.claude/scratchpads/<feature-slug>/tasks/<wi-code>/phase-state.md`)
for `/implement-task` and `/log-episode`, since multiple parallel
sessions would race on a shared file.
- **Context budget**: the skill's SKILL.md declares which tiers it reads
(T1 / T2 / T3) and its expected token budget. This is documentation,
not enforcement.

## 6. Skill internal pipelines

### 6.1 `/implement-task` internal steps

`/implement-task <work-item-id>` runs the following sequence inside one
session, in one worktree (or main directory if not parallel):


| #   | Step        | Subagent                 | Output                                                                                       |
| --- | ----------- | ------------------------ | -------------------------------------------------------------------------------------------- |
| 0   | Setup       | (orchestrator)           | Verify WI not blocked; ensure correct working directory and branch (see "Worktree contract"); mark WI `In Progress` in Plane (per §3 lifecycle) |
| 1   | Code        | `developer`              | Implementation commits on feature branch                                                     |
| 2   | Test design | `test-scenario-designer` | `tasks/<task-id>/test-scenarios.md`                                                          |
| 3   | Test write  | `test-writer`            | Test commits on feature branch                                                               |
| 4   | Review      | `code-reviewer`          | `tasks/<task-id>/code-review.md`                                                             |
| 5   | Fix cycle   | `developer` (re-spawned) | Fix commits; loop back to step 4 (max 2 cycles)                                              |
| 6   | PR          | (orchestrator)           | `gh pr create`; pre-pr-checks hook gates; mark WI `In Review` in Plane + comment with PR URL |


**Worktree contract (step 0).** `/implement-task` always runs in an
existing working directory — it never invokes `git worktree add`
itself. There are exactly two supported launch modes; the skill
detects which by comparing `git rev-parse --show-toplevel` to the
repo root:


| Mode                   | Expected pre-launch state                                                                | Step 0 actions                                |
| ---------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| Sequential (default)   | session in the repo's main checkout, on `main`, clean working tree                       | `git checkout -b <branch>` from `main`        |
| Parallel (across-WIs)  | session in `.claude/worktrees/<wi-code>`, detached HEAD at `main`'s tip, clean tree      | `git checkout -b <branch>` from current HEAD  |


Branch name follows `docs/agents/plane/implement-task.md § 1`. The
skill aborts (rather than silently overwrites) if it finds an
unexpected starting state — non-`main` branch with uncommitted
changes, attached HEAD on an unrelated branch in a worktree, or any
diverged state — and asks the user to clean up. See § 4.2 for the
across-WI parallelism workflow that produces the parallel mode in
the first place.

**Why tests come before code review, not after.** The `code-reviewer`
sees code **with** tests in one pass — it understands intent through
test cases and catches code/test mismatches. Code-review-before-tests
would force the reviewer to read code in a vacuum.

**Why no separate test-reviewer.** Tests are reviewed inside the
combined review at step 4. The two-stage test pipeline
(`test-scenario-designer` → `test-writer`) already provides separation:
scenarios are a spec for tests, and the writer implements the spec.

**Fix cycle limits.** Step 5 loops back to step 4 (review) up to
**2 cycles**. After 2 unresolved review cycles, the skill flags the
user with the remaining findings and pauses for direction.

### 6.2 Other skills

Internal pipelines for `/research`, `/prd`, `/design`, `/plan`,
`/tasks`, `/feature`, `/log-episode` are described in their respective
SKILL.md files when built. The general pattern is: writer skill → write
artefact → spawn reviewer subagent → loop on findings (max 2) → finalise.
See section 8 for the evaluator-optimizer template.

## 7. Subagents

The system uses subagents for **context isolation**, never for division
of labour. Existing subagents are reused unchanged; two new reviewers
are added.


| Subagent                 | Status   | Purpose                                       | Spawned by                                      |
| ------------------------ | -------- | --------------------------------------------- | ----------------------------------------------- |
| `code-architect`         | EXISTING | Standalone implementation planning            | `/plan`, `/code-architect`, `/design` (wrapper) |
| `developer`              | EXISTING | Code implementation                           | `/implement-task` steps 1, 5                    |
| `test-scenario-designer` | EXISTING | Test case design (read-only)                  | `/implement-task` step 2                        |
| `test-writer`            | EXISTING | Test code implementation                      | `/implement-task` step 3                        |
| `code-reviewer`          | EXISTING | Read-only code review                         | `/implement-task` step 4, `/review`             |
| `artifact-writer`        | EXISTING | Claude Code artefact creation (skills/hooks)  | `agent-architect` skill                         |
| `artifact-reviewer`      | EXISTING | Read-only audit of Claude Code artefacts      | `agent-architect` skill                         |
| `prd-reviewer`           | TO BUILD | Read-only review of PRD against research note | `/prd`                                          |
| `plan-reviewer`          | TO BUILD | Read-only review of plan against PRD + design | `/plan`                                         |
| `design-reviewer`        | OPTIONAL | Read-only review of design against PRD        | `/design` (when implemented)                    |
| `research-reviewer`      | OPTIONAL | Read-only review of research note             | `/research` (when complexity demands)           |


## 8. Evaluator-optimizer pattern

### 8.1 Required vs optional reviewers

Reviewing every phase is overhead that does not pay back equally
everywhere. The required/optional split:


| Phase     | Reviewer          | Status       | Rationale                                              |
| --------- | ----------------- | ------------ | ------------------------------------------------------ |
| Research  | research-reviewer | OPTIONAL     | Output is ephemeral; cost of review > cost of redoing  |
| PRD       | prd-reviewer      | **REQUIRED** | PRD is the foundation of everything downstream         |
| Design    | design-reviewer   | OPTIONAL     | Caught by plan-reviewer (which sees both)              |
| Plan      | plan-reviewer     | **REQUIRED** | Plan errors propagate into Work Items and code         |
| Tasks     | (none)            | NOT NEEDED   | Mechanical conversion plan→Plane; no judgment involved |
| Implement | code-reviewer     | **REQUIRED** | Existing; works                                        |


Optional reviewers are added later if practice shows quality regressions
without them.

### 8.2 General template

Every writer skill that has a required reviewer follows this loop:

1. **Write** the artefact to its known location.
2. **Spawn reviewer subagent** in fresh context. Pass file paths only,
   not content. Reviewer reads input(s) + the artefact independently.
3. **Reviewer writes verdict** to `<slug>/<phase>-review.md`:
   - `### Verdict` — the verdict token (`approved` or
     `changes-required`) is the **first non-empty line** under this
     heading; an optional 1-2 sentence summary may follow.
   - `### Findings` (optional block) — `#### Critical` sub-section
     appears only on `changes-required`; `#### Warning` sub-section
     appears on either verdict when warnings exist; the whole
     `### Findings` block is omitted when there are zero Criticals
     **and** zero Warnings. Each finding: `**[file:line or §X.Y]**
     — issue — why — fix`.
4. **Writer skill reads `### Verdict` first**, then descends into
   `### Findings` only when needed:
   - `approved` with no `### Findings` block → phase complete.
   - `approved` with `### Findings` (Warning-only) → surface each
     Warning to the user with three choices: fix now, defer to
     follow-up, or skip with rationale. Then phase complete.
   - `changes-required` → read the full `### Findings` block; revise
     the artefact on Critical, re-spawn reviewer. Cycle counter
     increments.
5. **Maximum 2 cycles.** After 2 cycles still `changes-required`, the
   skill pauses and asks the user how to proceed (override, defer,
   abort).

### 8.3 Review file layout

Scratchpad holds **review files and ephemeral working state only**.
Canonical PRD / design / plan artefacts live at their git locations
(`docs/product/`, `docs/designs/`, `docs/plans/`); reviewers read
from there. Research is the exception — it is not promoted to git
and stays in scratchpad as `research.md`. `phase-state.md` exists
at two levels: feature-level for the planning phases (one writer at
a time), and per-task under `tasks/<wi-code>/` for `/implement-task`
sessions, since multiple parallel sessions would race on a single
file.

```
.claude/scratchpads/<feature-slug>/
├── phase-state.md                     # feature-level — planning phases only
├── research.md                        # canonical (not committed to git)
├── (research-review.md)               # if research-reviewer ran
├── prd-review.md                      # required (PRD itself in docs/product/)
├── (design-review.md)                 # if design-reviewer ran (design in docs/designs/)
├── plan-review.md                     # required (plan in docs/plans/)
├── plane-failures.jsonl               # accumulated MCP errors per universal.md § 7
└── tasks/
    └── <wi-code>/
        ├── phase-state.md             # per-task; written by /implement-task
        ├── test-scenarios.md
        ├── code-review.md
        └── ...
```

## 9. Episode log

The episode log is `docs/episodes/<YYYY-MM>.jsonl` — append-only, one
JSON object per line, one file per month for natural rotation. One
entry corresponds to one Work Item / one PR / one merge.

It serves two distinct purposes:

1. **Pipeline observability.** Counts, durations, retry cycles per phase
  — tells you how the agent system itself is behaving over time.
2. **Persistent reasoning trace.** Decisions, blockers, dead ends,
  learnings — preserves the *why* layer that git log and PR
   descriptions don't capture.

It is **not** a memory for retrieval-augmented generation. Reads happen
explicitly during `/research`, `/prd` and `/plan` via grep, and only
when the calling skill decides past episodes are relevant.

### 9.1 Schema

```json
{
  "schema_version": 1,
  "episode_id": "2026-04-28-fix-greenhouse-rate-limit-GJS-42",
  "feature_slug": "fix-greenhouse-rate-limit",
  "task_id": "GJS-42",
  "task_type": "fix",
  "status": "merged",
  "started_at": "2026-04-28T10:15:00Z",
  "completed_at": "2026-04-28T11:42:00Z",

  "branch": "fix/greenhouse-backoff-GJS-42",
  "pr_url": "https://github.com/vasd85/global-job-search/pull/123",
  "plane_work_item_id": "GJS-42",
  "plane_epic_id": "GJS-40",
  "prd_link": "docs/product/fix-greenhouse-rate-limit.md",
  "design_link": null,
  "plan_link": "docs/plans/fix-greenhouse-rate-limit.md",
  "session_ids": ["1124e18f-3963-43d3-93ce-424420a57222"],

  "phases_run": ["research", "prd", "plan", "tasks", "implement", "review"],
  "parallel_with": ["GJS-43"],

  "reviews": {
    "prd":  { "cycles": 1, "verdict": "approved" },
    "plan": { "cycles": 2, "verdict": "approved", "critical_findings_addressed": 3 },
    "code": { "cycles": 1, "verdict": "approved" }
  },

  "duration_min_total": 87,
  "duration_min_by_phase": {
    "research": 12,
    "prd": 18,
    "plan": 22,
    "implement": 30,
    "review": 5
  },
  "files_touched_count": 4,
  "test_count_added": 6,

  "decisions": [
    {
      "what": "exponential backoff with 5 max retries, jitter 100-500ms",
      "why": "3 retries miss 4xx storms in production; jitter prevents thundering herd",
      "rejected": ["circuit breaker — overkill for this scope", "fixed delay — uneven load"],
      "confidence": "verified"
    }
  ],
  "blockers": [
    {
      "what": "Greenhouse 429 responses lack standard Retry-After header",
      "resolution": "extracted from response body via vendor wrapper",
      "duration_min": 25,
      "tag": "external-api"
    }
  ],
  "dead_ends": [
    {
      "tried": "react-query default retry config",
      "why_failed": "doesn't expose Retry-After header to caller code"
    }
  ],
  "learnings": [
    "Greenhouse 429s lack standard headers — extractor needs vendor-specific wrapper"
  ],
  "tags": ["extractor", "greenhouse", "rate-limit"]
}
```

### 9.2 Field categories

**Auto-extracted** (no human input needed):

- `episode_id`, `feature_slug`, `task_id`, `task_type`, `status`
- `started_at`, `completed_at`
- `branch`, `pr_url`, `plane_work_item_id`, `plane_epic_id`
- `prd_link`, `design_link`, `plan_link`
- `session_ids` (from `meta.json` of skill-log runs under
`.claude/logs/<skill>/<run-dir>/`; machine-local pointers — see §9.6)
- `phases_run` (from `events.jsonl` `skill_start` records when
available, else from `phase-state.md`)
- `reviews` (cycles and verdicts from `*-review.md` artefacts; counts
cross-checked against subagent-spawn events in `events.jsonl` when
available)
- `duration_min_total`, `duration_min_by_phase` (from `events.jsonl`
timestamps when available, else from `phase-state.md`)
- `files_touched_count`, `test_count_added` (from `git diff`)

**Human-curated, agent-drafted** (require approval):

- `decisions`, `blockers`, `dead_ends`, `learnings`, `tags`
- `parallel_with` — sibling Work Item ids that were running in
parallel with this one. Auto-detection across worktree-isolated
sessions has no good prior art and adds infrastructure cost not
justified at solo-project scale; `/log-episode` instead prompts
the user during draft approval ("any sibling WIs running in
parallel? e.g. `GJS-43, GJS-44`"). User memory degrades fast over
days, so the prompt fires near merge time, not when the standalone
mode runs against an old PR. See § 13 open question for the
auto-extraction roadmap if scale changes.

The agent (in `/log-episode`) drafts these from scratchpads and PR
diff, then presents the draft for the user to edit and approve before
appending to the JSONL file. **No silent writes.**

### 9.3 Recommended tag vocabularies

These are not enforced (free strings) but are the recommended common
keys, so grep across episodes finds related cases.

`blocker.tag`:

- `external-api` — third-party service behaved unexpectedly
- `tooling` — IDE / CI / package-manager issue
- `requirement-unclear` — spec didn't cover the case encountered
- `flaky-test` — non-deterministic test failure
- `env-config` — local environment diverged from production
- `local-context-mismatch` — agent couldn't find relevant context (T3
retrieval failure)
- `over-decomposition` — task too small, overhead exceeded value

`decision.confidence`:

- `verified` — backed by tests or production metric
- `provisional` — works, but not proven optimal

`task_type` (matches the Conventional Commits types in CLAUDE.md
"Git" section and the `type:*` labels in `plane/tasks.md § 6`; the
three sources must stay in sync):

- `feat` — new functionality
- `fix` — bug fix
- `refactor` — non-functional restructuring
- `chore` — tooling, dependencies, infrastructure
- `docs` — documentation-only
- `test` — test-only change

### 9.4 Use cases (read-side)

The log is justified only if these queries become useful. Track whether
they are over time.

- "Which modules touch each other most often in single features?"
→ coupling signal, candidate for shared package extraction
- "Average `reviews.code.cycles` for feat-typed tasks last quarter?"
→ if > 1.5, `/plan` prompt under-specifies and creates rework
- "Average `reviews.prd.cycles`?" → if > 1, `/prd` prompt needs tightening
- "Episodes where `blocker.tag = external-api` and `duration_min > 30`?"
→ vendor-specific friction, candidate for ATS-extractor refactor
- "Episodes where `phases_run` skipped `design`?"
→ trivial-task path; check that quality didn't drop
- "What % of work items ran in parallel?" → measure actual concurrency
vs declared DAG independence
- "Has approach X been tried before? When and why was it rejected?"
→ grep `dead_ends[].tried`

### 9.5 Evolution roadmap


| Stage | Trigger         | Action                                                                                                           |
| ----- | --------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0     | initial         | infrastructure only; nobody reads                                                                                |
| 1     | ~10 episodes    | manual grep when topic feels familiar                                                                            |
| 2     | ~15-20 episodes | `/plan` and `/prd` grep past 90 days for the slug topic, summarise in 200 words                                  |
| 3     | ~30-50 episodes | aggregation script: blocker frequency, review-cycle distribution, suggest CLAUDE.md / rules / ADR updates via PR |
| 4+    | not planned     | (insight graphs, vector retrieval) — only if Stage 2-3 prove insufficient, which is unlikely                     |


### 9.6 Relation to skill-logs

The episode log and the skill-logger infrastructure
(`.claude/logs/<skill>/<run-dir>/`) are **two different layers** with
different lifecycles, audiences, and trust levels. They are
complementary, not redundant.


| Aspect          | skill-logs (existing)                        | episode log (this section)                       |
| --------------- | -------------------------------------------- | ------------------------------------------------ |
| Granularity     | every tool call, every message               | one entry per Work Item / per PR                 |
| Curation        | automatic, real-time, no human               | human-approved draft via `/log-episode`          |
| Persistence     | ephemeral, gitignored, machine-local         | canonical T2, git-tracked                        |
| Lifecycle       | session-scoped (may be cleaned up)           | append-only, kept indefinitely                   |
| Audience        | forensic debugging via `/analyze-skill-logs` | grep in `/plan`, `/prd`; aggregate analytics     |
| Privacy         | local — contains raw reasoning, prompts      | public — distilled, curated only                 |
| Source-of-truth | yes, primary record of what the agent did    | derived summary; never the only copy of anything |


**Cross-reference, not duplication.** Episode log entries carry
`session_ids` as pointers into the skill-log layer for forensic
drill-down. The skill-log itself is never copied into the episode log
— that would mix Truth and Acceleration (per §1 invariants) and
duplicate ephemeral content into a canonical store.

**Auto-extraction at log time.** When `/log-episode` runs, it reads the
relevant `events.jsonl` files (resolved through `session_ids`) to
populate `phases_run`, `duration_min_`*, `reviews.*.cycles`, and
similar telemetry fields. If the skill-log is unavailable (run was
crash-killed before hooks fired, retention has cleaned it, or the
session ran on another machine), these fields fall back to
`phase-state.md` data, and the episode is still written. **Reasoning
trace fields (`decisions`, `blockers`, `dead_ends`, `learnings`) never
depend on skill-logs** — they come from scratchpads + PR diff and are
self-contained.

`**session_ids` are machine-local pointers.** They resolve to files
under `~/.claude/projects/<encoded-path>/sessions/<session-id>.jsonl`
on the machine that ran the skill. On other machines, or after the
skill-log is cleaned up, the file may not exist; in that case
drill-down via `/analyze-skill-logs` is unavailable, but the episode
entry's reasoning trace remains accessible and answers the typical
"why did we do X" question without the raw transcript.

**Graceful miss on drill-down.** When `/analyze-skill-logs` is invoked
on a `session_id` that does not resolve locally, it must fail gracefully
with a clear "session log not available on this machine" message and
suggest the caller fall back to the reasoning-trace fields in the
episode entry. No silent errors, no attempts to fabricate transcript
content.

`**/analyze-skill-logs` is not part of the per-feature or per-task
pipeline.** It is a standalone forensic tool, invoked manually when the
user wants to inspect *how* a particular run unfolded. The normal
workflow never reaches into it — it reads episode log fields directly.

## 10. Promotion gate

The transition from Tier 2 (episode log, scratchpads) to Tier 1
(CLAUDE.md, rules, ADRs) **never** happens automatically.

Three sources can trigger a promotion:

1. **Episode log pattern.** A pattern repeated in 3+ episodes (same
  `blocker.tag` 3 times, same kind of decision 3 times) becomes a
   candidate for a rule update. The aggregation script (Stage 3 in §9.5)
   flags candidates; a human writes the PR.
2. **Architectural decision.** Any decision with `confidence: verified`
  and broad scope (touches multiple modules) becomes an ADR candidate.
   `/design` already drafts ADRs as a side effect; promotion finalises
   them.
3. **Workflow regression.** If `reviews.<phase>.cycles > 2` repeatedly
  for the same kind of task, the responsible skill's SKILL.md needs
   updating.

The PR template for promotion includes:

- Reference to source episodes (episode_ids)
- Quote from the relevant `decisions` / `blockers` / `learnings` field
- Statement of which Tier 1 file is changing and why

This makes Tier 1 changes auditable, prevents memory poisoning
(precedent → directive without intent), and keeps the canon free of
provisional rules.

## 11. Migration roadmap

The new architecture is built incrementally. Each step ships a working
state and closes one observable gap. Old skills (`/implement`,
`/product-research`) keep working until their replacements are stable.


| #   | Step                                                                                                               | Effort | Closes gap                              |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------ | --------------------------------------- |
| 1   | Create `docs/designs/`, `docs/plans/`, `docs/adr/`, `docs/episodes/`; commit ADR template and episode JSONL schema | 30 min | Locations exist                         |
| 2   | Build `/research` (extracted from `/product-research` Phases 1-3)                                                  | 2-3 h  | Research isolated                       |
| 3   | Build `/prd` + `prd-reviewer` subagent (extracted from `/product-research` Phases 4-5)                             | 3-4 h  | PRD phase + required reviewer           |
| 4   | Build `/design` wrapping `code-architect` (conditional skip logic)                                                 | 3-4 h  | Technical design phase                  |
| 5   | Build `/plan` + `plan-reviewer` subagent (extracted from `/implement` Phase 2; emits DAG)                          | 3-4 h  | Plan phase with dependencies + reviewer |
| 6   | Build `/tasks` (plan DAG → Plane Epic + Work Items + relations)                                                    | 3-4 h  | Plane wiring automated                  |
| 7   | Build `/implement-task` (extracted from `/implement` Phases 3-7)                                                   | 4-6 h  | Atomic implementation skill             |
| 8   | Build `/feature` chain orchestrator (phases 1-5)                                                                   | 2-3 h  | Per-feature workflow tied together      |
| 9   | Build `/log-episode` + `/implement-task` finale integration                                                        | 3-4 h  | Episode log foundation (Stage 0)        |
| 10  | Deprecate `/product-research` and `/implement`                                                                     | 1 h    | Single canonical pipeline               |
| 11  | (later) Stage 2 of episode log: grep in `/plan` and `/prd`                                                         | 1-2 h  | Episode log earns its keep              |
| 12  | (later) Stage 3 of episode log: aggregation + `/promote-pattern` skill                                             | 4-6 h  | Promotion gate operational              |


Steps 11-12 are deferred until enough episodes accumulate (~15-20 for
step 11, ~30-50 for step 12).

## 12. Out of scope

Decisions that are **not** part of this architecture and will not be
introduced opportunistically. Reopening any of these requires
documented justification.

- **Vector / RAG over scratchpads or episodes.** Plain grep is
sufficient at this scale and avoids the canonical-vs-derived split.
- **Multi-agent shared memory.** The system is single-writer per tier.
Multi-agent coherence protocols are an unsolved problem; we do not
pretend to have solved it.
- **Dynamic orchestrator-workers.** SDLC phases are stable; chaining is
enough.
- **Insight graphs / G-Memory style hierarchical memory.** Premature for
the episode count we will see.
- **Cross-project agent memory.** This system is scoped to
`global-job-search` only.
- **Plane as document store.** Plane stores work items only.
- **Test-reviewer as separate subagent.** Test review is part of the
combined code-review at step 4 of `/implement-task`.

## 13. Open questions

Items that are not yet decided. Each will be resolved when a step
that depends on it begins.

- **Conditional `/design` criteria.** Heuristics for when `/feature`
skips phase 3. First draft: skip if PRD Section 4 (scope) is ≤ 2
files and §11.2 (locked product concepts) has no architectural items.
Validate empirically as features are run.
- **Token budgets per phase.** Will be set when each skill is built,
based on observed context size. Tracked in `phase-state.md`.
- **Episode log retention.** Currently no retention policy — JSONL files
are kept indefinitely. Revisit when total log size exceeds 5 MB.
- **Context7 (or equivalent) MCP.** Will be added when framework
documentation lookup becomes a recurring blocker (`blocker.tag = local-context-mismatch` repeats).
- **Episode log read-mode trigger.** Stage 2 says "after ~15-20
episodes", but the heuristic should be revisited in practice.
- **Worktree cleanup policy for parallel `/implement-task` sessions.**
Creation is settled (user creates manually before launching the
session — see § 4.2), and the skill's worktree contract is in
§ 6.1 step 0. What remains open is the cleanup story: when a PR
merges, who removes the worktree and prunes the branch —
`/log-episode`, a separate `/cleanup-worktree` skill, or the user
manually? Decide when episode count makes manual cleanup tedious;
until then, manual is fine.
- **Auto-extracting `parallel_with`.** Currently human-curated
(§ 9.2): `/log-episode` prompts the user for sibling WI ids during
draft approval. This works while parallelism is small (solo project,
2-3 concurrent sessions) and recall is fresh (prompt fires near
merge time). Trigger to automate: peak concurrent sessions ≥ 4
sustained for several weeks, or a re-read of episodes shows
consistently empty `parallel_with` on weeks where parallel work
clearly happened. Concrete approach when triggered, derived from a
survey of prior art (Sidekiq `WorkSet`, Claude Code Agent Teams
shared-state, OpenTelemetry span links — none directly fit, all
suggest the same shape):
  1. `/implement-task` step 0 writes a marker file
  `<main-repo>/.claude/sessions/active/<session-id>.json` with
   `{session_id, work_item_id, worktree_path, started_at}`.
  2. `/implement-task` end-of-task (or `/log-episode` finale)
  removes the marker.
  3. `/log-episode` populates `parallel_with` by listing markers
  whose `started_at`-to-now window overlaps this WI's
   `[started_at, completed_at]`, excluding self.
  4. Resolve `<main-repo>` from inside any worktree via
  `git worktree list --porcelain` (first record is the primary
   checkout).
  5. Stale-purge by `started_at` TTL (24 h) on each read — simpler
  and more portable than PID liveness checks.
  6. Use a **directory of marker files** rather than a single shared
  JSON file: avoids merge-contention without locks, stale-purge
   becomes `find -mtime +1 -delete`. Same shape as Claude Code
   Agent Teams shared-state.
  7. Where to mint `<session-id>` is its own sub-question — Claude
  Code does record session ids under
   `~/.claude/projects/<encoded>/sessions/`, but accessing that from
   inside the running session requires confirming the runtime API.
   If unavailable, mint a UUID at step 0 instead.

