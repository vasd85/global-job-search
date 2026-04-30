---
name: design
description: >-
  Third phase of the agent-system pipeline (conditional). Read a
  PRD, decide whether a technical design pass is needed, and if so
  produce docs/designs/<slug>.md on the plan/<slug> branch. Wraps
  the code-architect subagent; drafts ADRs as a side effect when
  decisions have broad scope. Manual invocation only.
disable-model-invocation: true
argument-hint: "<feature-slug>"
---

# Design

You take the PRD produced by `/prd` and decide whether a technical
design pass adds value. If yes, you spawn `code-architect` in fresh
context, produce `docs/designs/<slug>.md`, and surface any
architectural decisions worth recording as ADR drafts. If the PRD
is trivial, you skip and `/plan` reads the PRD alone.

## Why this exists

A PRD answers *what* and *why* (business level); `/plan` answers
*in what order* (decomposition). Between them, design answers *how
technically* — data shapes, API contracts, algorithmic choices,
rejected alternatives. For trivial features there is nothing
substantive to design and adding a phase only burns cycles. So
this phase is conditional.

The skill **wraps** `code-architect`: that subagent already does
exploration, alternative evaluation, and risk assessment in fresh
context. This skill's job is the wrapping — when to invoke, where
the output lands, and how ADRs surface.

## Inputs and outputs

**Input:** `docs/product/<slug>.md` (committed by `/prd` on
`plan/<slug>`).

**Output (when not skipped):**
- `docs/designs/<slug>.md` — committed on the same `plan/<slug>`
  branch. Format per `code-architect`'s Format A/B/C as appropriate.
- 0 or more ADRs at `docs/adr/<NNNN>-<topic-kebab>.md` — committed
  on the same branch. `<NNNN>` is the next available integer in
  `docs/adr/` (zero-padded, 4 digits); `<topic-kebab>` is the
  decision topic, **not** the feature slug (existing convention:
  `0003-zod-as-runtime-validation-library.md`). Status: `Proposed`.

**Output (when skipped):** `phase-state.md` updated with
`status: complete`, body note `skipped: true; reason: ...`. Nothing
written under `docs/`.

## Skip criteria

Skip ONLY when **all** of these hold for the PRD:

- 1-2 files affected (per PRD §0 / §5 inventory).
- No architectural decisions (no library choice, no pattern shift,
  no algorithmic decision).
- No new data models (no new tables, no new top-level types).
- No new API contracts (no new endpoints, no new params on existing
  endpoints).

If any criterion is unclear, **do not skip silently** — ask the
user. Erring on the side of designing is cheap; erring on the side
of skipping is expensive (planner and implementer would rediscover
decisions the architect would have made once).

## The four-step flow

### 1. Resolve slug + read PRD

The user invokes `/design <feature-slug>`. Verify
`docs/product/<slug>.md` exists; if missing, abort and tell the
user to run `/prd` first. Read the PRD's §0, §4, §6, §11 — the
sections that signal scope.

### 2. Branch + phase-state + skip decision

Branch contract — phases 2-4 of the planning chain share branch
`plan/<slug>`. The PRD must already be on it (committed by `/prd`):

- On `plan/<slug>`, clean tree → continue.
- On `main`, clean tree → abort. The PRD should live on
  `plan/<slug>`, not `main`; if `/prd` was merged separately, that
  is a workflow violation — surface and stop.
- Any other state → abort, ask the user to clean up.

Re-verify `docs/product/<slug>.md` exists in the working tree (a
clean `plan/<slug>` is not proof that the PRD is committed —
history could have been rewritten). If missing, abort with
`'plan/<slug>' branch missing the PRD — re-run /prd`.

Rewrite `.claude/scratchpads/<slug>/phase-state.md` frontmatter to:
`phase: design`, `started_at: <now ISO 8601 UTC>`, `ended_at: null`,
`status: in-progress`, `next_phase: plan`, `cycles: 0`. The previous
`phase: prd, status: complete` frontmatter is replaced — only one
phase is in-progress at a time per the schema.

Apply skip criteria. Three outcomes:

- **Clearly skip** — present a 1-2 sentence rationale, ask the user
  to confirm via `AskUserQuestion`. On confirmation, rewrite
  `phase-state.md`: `status: complete`, `ended_at: <now ISO 8601
  UTC>`, body note `skipped: true; reason: <rationale>`. Phase
  ends; tell the user `/plan` is next.
- **Clearly design** — proceed to step 3.
- **Uncertain** — `AskUserQuestion`: list the borderline signals
  and ask whether to design or skip; honor the answer.

### 3. Spawn `code-architect`, write design + ADR drafts

Spawn `code-architect` in fresh context, pointing it to scratchpad
outputs (the subagent's `Write` hook restricts it to scratchpads):

```
Agent(
  subagent_type: "code-architect",
  description: "Design pass for <slug>",
  prompt: |
    PRD_PATH:        docs/product/<slug>.md
    OUTPUT_PATH:     .claude/scratchpads/<slug>/design-draft.md
    ADR_OUTPUT_DIR:  .claude/scratchpads/<slug>/adr/

    Read the PRD. Produce a technical design at OUTPUT_PATH using
    Format A (Feature Plan), B (Architectural Decision), or C
    (Refactoring) as fits the scope.

    For each decision with broad scope (technology choice, pattern
    shift, cross-module impact, persistent constraint), draft a
    Michael Nygard ADR per docs/adr/0000-template.md. Save each as
    <topic-kebab>.md under ADR_OUTPUT_DIR (no NNNN prefix — the
    orchestrator assigns numbers and promotes to docs/adr/).
    Status: Proposed.
)
```

Once the subagent returns, the orchestrator:

- Copies `.claude/scratchpads/<slug>/design-draft.md` to
  `docs/designs/<slug>.md`.
- Scans `docs/adr/` once for the highest existing `<NNNN>` (call it
  N). For each ADR draft in `.claude/scratchpads/<slug>/adr/` (in
  alphabetical order by `<topic-kebab>.md` for deterministic
  numbering), copies to `docs/adr/<N+1>-<topic-kebab>.md`,
  `docs/adr/<N+2>-<topic-kebab>.md`, … Status: `Proposed` in each.
- Stages and commits on `plan/<slug>` per `CLAUDE.md § Git`. Does
  NOT push or open a PR — the planning branch waits for `/plan`.

### 4. Update phase-state, hand off

Set `phase-state.md`: `status: complete`, `ended_at: <now ISO 8601
UTC>`, `next_phase: plan`. Tell the user the design path (and ADR
paths if any) and that `/plan` is next. Control returns to the
user — do NOT invoke downstream skills automatically.

## Phase tracking

This skill writes the **feature-level** phase-state file at
`.claude/scratchpads/<slug>/phase-state.md`, schema at
`docs/agents/phase-state-schema.md`. Fields written:

- `phase: design`; `next_phase: plan`.
- `started_at`: on entry to step 2 (after PRD resolves).
- `ended_at`: `null` while running; set when step 4 finishes.
- `status`: `in-progress` → `complete` (both designed and skipped
  paths use `complete`); `failed` on user abort.
- `cycles: 0` — `/design` has no required reviewer in this pipeline.
  The plan-reviewer (next phase) audits design + PRD together.
- Body note: free-form `skipped: true; reason: ...` when skipped.

## What stays out

- **Re-litigating the PRD.** Locked from `/prd`'s phase. If design
  surfaces a contradiction, surface it back to the user; do not
  silently re-scope.
- **Implementation code.** That is `/implement-task`'s job after
  `/plan` decomposes.
- **Pushing or opening a PR.** The planning branch is shared with
  `/prd` and `/plan`; the bundled PR opens after `/plan`.
- **ADR finalisation.** ADRs ship as `Status: Proposed`. The flip
  to `Accepted` is a manual edit by the human reviewer at planning-
  PR merge (same PR, not a downstream skill action).

## Language

**Dialogue:** mirror the user's language.

**`docs/designs/<slug>.md` and ADRs: always English.** Downstream
agents and `docs/` are English.

## When NOT to use this skill

- No PRD for the slug → run `/prd` first.
- Small bug fix or doc-only change → go straight to implementation.
- Approved design already exists → invoke `/plan`.
- Technical-only document with no product surface → use
  `/code-architect` standalone (no PRD/plan branch involved).
