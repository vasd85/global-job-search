---
name: plan
description: >-
  Fourth phase of the agent-system pipeline. Read the PRD (and optional
  design) on plan/<slug>, produce docs/plans/<slug>.md with a
  machine-readable chunk DAG. Required reviewer (plan-reviewer) runs
  in fresh context. Manual invocation only.
disable-model-invocation: true
argument-hint: "<feature-slug>"
---

# Plan

You take the PRD from `/prd` (and the design from `/design`, if
present) and write an implementation plan that decomposes the work
into atomic chunks with a machine-readable dependency DAG. The
reviewer (`plan-reviewer`) audits your draft in fresh context. The
downstream `/tasks` skill parses your output to create Plane Epic +
Work Items, so the chunk metadata is a contract.

## Why this exists

A plan converts a PRD's *what* into an ordered, parallelisable *how
much, in what order*. Plan errors propagate downstream into Work
Items and code — catching them late is expensive. The plan is read
by an agent (`/tasks`, then `/implement-task`), so it is declarative,
file-paths-resolved, and binary in its acceptance criteria. Each
chunk is one logical change → one Work Item → one PR.

## Inputs and outputs

**Required input:** `docs/product/<slug>.md` (committed by `/prd` on
`plan/<slug>`). **Optional input:** `docs/designs/<slug>.md` on the
same branch — detect, read if present, proceed without if absent.
Cited ADRs at `docs/adr/<NNNN>-*.md` are read only when the design
references them.

**Output:** `docs/plans/<slug>.md`, committed on `plan/<slug>`. The
branch is then ready for the single planning PR (PRD + optional
design + plan together). `/plan` does NOT push or open the PR.

**Side-output:** `.claude/scratchpads/<slug>/plan-review.md` written
by `plan-reviewer`. Read-only after finalisation.

## The five-step flow

### 1. Resolve the slug and inputs

The user invokes `/plan <feature-slug>`. Verify
`docs/product/<slug>.md` exists; if missing, abort and tell the user
to run `/prd` first or to confirm the slug. Detect
`docs/designs/<slug>.md`. Do NOT write `phase-state.md` until step 2 —
an aborted step 1 must leave no scratchpad state behind.

### 2. Set the planning branch and open phase-state

PRD, design, and plan all commit to shared branch `plan/<slug>`.
Enforce:

- On `plan/<slug>`, clean tree → continue.
- On `main` → abort. The PRD must already live on `plan/<slug>`; if
  not, this is a workflow violation.
- Any other state (different branch, dirty tree, detached HEAD) →
  abort, surface the state, ask the user to clean up.

The skill never force-resets, force-checkouts, or stashes the working
tree on the user's behalf.

After the branch check, **re-verify** that `docs/product/<slug>.md`
exists in the working tree (a clean `plan/<slug>` is not proof;
history could have been rewritten). If missing, abort with
`'plan/<slug>' branch missing the PRD — re-run /prd`. Re-verify
`docs/designs/<slug>.md` if it was detected.

Rewrite `.claude/scratchpads/<slug>/phase-state.md` frontmatter to:
`phase: plan`, `started_at: <now ISO 8601 UTC>`, `ended_at: null`,
`status: in-progress`, `next_phase: tasks`, `cycles: 0`. The previous
`phase: design` (or `phase: prd` if design was skipped) is replaced —
only one phase is in-progress at a time.

### 3. Draft the plan

Read the template at `assets/plan-template.md`. Every section header
appears in the output in template order. If a section is genuinely
not applicable, write `N/A — <one-line reason>`; never leave a
section empty.

Read PRD §0, §3, §11.2, §11.3, §11.5. If a design exists, read its
full body — it is the technical contract. ADRs cited by the design
are read in full.

**Drafting discipline (the plan is read by an agent):**

- **Each chunk is atomic.** One logical change per chunk = one Work
  Item = one PR. If a chunk reads as "do A, then do B in a follow-up
  PR", split into two chunks.
- **Binary acceptance criteria.** Checkboxes that are unambiguously
  testable. "well-tested" is not testable; "`pnpm test
  packages/ats-core` exits 0 with the new test file present" is.
- **DAG metadata is mandatory.** Every chunk header is followed by a
  YAML block with `id`, `depends_on`, `labels`. Ids are kebab-case,
  unique within the plan, stable across reruns (downstream Plane
  idempotency depends on this).
- **File-overlap → dependency edge.** If two chunks list the same
  file under `Files`, the later must declare `depends_on:
  [earlier-chunk-id]`. Parallel implementation will conflict.
- **Constraints carry forward.** PRD §11.2 locked decisions become
  hard constraints in §3 of the plan.
- **Code-level decisions are agent-owned.** The plan does not pick
  library names, column types, or algorithms unless the design did.
  Such items go to chunk-level "Hints" if surfaced — never as binding
  "must use X".

**Before spawning the reviewer**, verify mechanically: every `## N`
heading present in template order; no empty sections; every chunk
has its YAML block with `id` and `depends_on` populated; every
`depends_on` id resolves to another chunk's `id`; the DAG is acyclic.
These mechanical checks are yours — the reviewer is semantic.

### 4. Review loop (`plan-reviewer` in fresh context)

Once the draft is on disk, spawn the reviewer:

```
Agent(
  subagent_type: "plan-reviewer",
  description: "Audit draft plan against PRD (and design)",
  prompt: |
    PLAN_PATH:     docs/plans/<slug>.md
    PRD_PATH:      docs/product/<slug>.md
    DESIGN_PATH:   docs/designs/<slug>.md   # or empty string if design skipped
    VERDICT_PATH:  .claude/scratchpads/<slug>/plan-review.md
)
```

Pass file paths only. The reviewer reads inputs independently and
writes verdict + findings to VERDICT_PATH. Read in two passes:

- **Pass 1 — verdict.** First non-empty line under `### Verdict` is
  `approved` or `changes-required`; an optional 1-2 sentence summary
  may follow.
- **Pass 2 — findings (when present).** `### Findings` block is
  omitted when zero Critical AND zero Warning.
  - `changes-required` with Critical → revise, increment `cycles`,
    re-spawn. Maximum **2 cycles**.
  - After 2 cycles still `changes-required` → set `status: failed`,
    surface remaining findings, pause for user direction (override,
    defer, abort).
  - `approved` with Warnings → surface each Warning to the user
    (fix now / defer to follow-up / skip with rationale), then step 5.
  - `approved` with no `### Findings` → step 5.

### 5. Commit and hand off

Commit the plan on `plan/<slug>` per `CLAUDE.md § Git` (stdin
HEREDOC, Conventional Commits). Type `chore` if the plan only
sequences existing scope, `feat` if it introduces new product
surface. Do NOT push or open a PR — the branch is now ready for the
single planning PR (PRD + optional design + plan together), opened
by the user or by `/feature` later. Update `phase-state.md`:
`status: complete`, `ended_at: <now ISO 8601 UTC>`, `next_phase:
tasks`. Tell the user the plan path and that the planning PR is
ready to open; once it merges to `main`, `/tasks` runs against
`main`. Control returns to the user — do NOT invoke `/tasks`
automatically.

## Phase tracking

This skill writes the **feature-level** phase-state file at
`.claude/scratchpads/<slug>/phase-state.md`, schema at
`docs/agents/phase-state-schema.md`. Fields:

- `phase: plan`; `next_phase: tasks`.
- `started_at`: on entry to step 2; `ended_at`: `null` while running,
  set when step 5 finishes.
- `status`: `in-progress` → `complete` on approval; `failed` on cycle
  exhaustion or user abort.
- `cycles`: `0` → `+1` per writer→reviewer iteration; capped at 2.

## What stays out

- **Re-litigating the PRD or design.** Both are locked; surface
  contradictions back to the user.
- **Code-level decisions** not pinned by the design (library names,
  column types, algorithms) — at most chunk-level Hints.
- **Implementation code** — `/implement-task`'s job.
- **Pushing or opening a PR** — the planning PR opens after `/plan`,
  not from inside it.

## Language

**Dialogue:** mirror the user's language. **`docs/plans/<slug>.md`: always English.**

## When NOT to use this skill

- No PRD for the slug → run `/prd` first.
- Approved plan already exists → invoke `/tasks` after the planning
  PR merges to `main`.
- Small bug fix or doc-only change → go straight to implementation.
