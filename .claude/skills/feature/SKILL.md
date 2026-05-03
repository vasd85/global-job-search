---
name: feature
description: >-
  Chain orchestrator for the per-feature planning workflow. Takes a
  topic and runs /research → /prd → /design (conditional) → /plan
  sequentially in one session, then opens the single planning PR
  and pauses. Resumes from sub-skills' phase-state when interrupted.
  Manual invocation only.
disable-model-invocation: true
argument-hint: "<topic>"
---

# Feature

You sequence the planning sub-skills (`/research`, `/prd`, `/design`,
`/plan`) into one session and open the planning PR. You are a thin
runbook: each phase's behaviour lives in its own SKILL.md. Your only
jobs are ordering, the skip-design heuristic, and pause points.

## Why this exists

Running the four planning skills by hand means juggling slugs, branch
state, and remembering which phase is next after a coffee break.
`/feature` removes that friction without absorbing per-phase logic.

## Inputs and outputs

**Input:** either `<topic>` (free text — fresh start) or
`<feature-slug>` (resume an interrupted chain). Distinguish by
checking whether `.claude/scratchpads/<arg>/` exists.

**Outputs (cumulative across the chain, all written by sub-skills):**
- `.claude/scratchpads/<slug>/research.md`
- `docs/product/<slug>.md` on `plan/<slug>`
- `docs/designs/<slug>.md` + 0+ ADRs (when not skipped)
- `docs/plans/<slug>.md` on `plan/<slug>`
- One pushed `plan/<slug>` branch + opened planning PR

This skill writes nothing under `docs/` directly — it delegates.

## The five-step flow

### 1. Resolve mode and slug

- **Fresh** — `/feature <topic>`. Skip to step 2; the slug is created
  by `/research`.
- **Resume** — `/feature <slug>` where
  `.claude/scratchpads/<slug>/phase-state.md` already exists. Read it
  and apply the resume contract.

If unclear, list candidate slugs under `.claude/scratchpads/` and ask.

### 2. Run `/research` (fresh start only)

Invoke `Skill(skill="research", args="<topic>")`. Sub-skills run in
the same conversation, not as subagents. `/research` echoes the slug
on return and writes it into `research.md`'s metadata — capture it
from there. The slug is invariant from this point.

### 3. Run `/prd <slug>`

Invoke `Skill(skill="prd", args="<slug>")`. The PRD-writer creates
`plan/<slug>` and runs `prd-reviewer` internally. On return, read
`.claude/scratchpads/<slug>/phase-state.md`; on `status: failed`,
apply the failure rule (see resume contract).

### 4. Apply skip-design heuristic, then `/design <slug>` if needed

Read `docs/product/<slug>.md` § 4 (scope) and § 11.2 (locked product
concepts). **Skip iff** § 4 lists ≤ 2 files AND § 11.2 has no
architectural items (no library choice, no pattern shift, no data
model, no API contract).

If unsure, `AskUserQuestion` — erring on designing is cheap; erring
on skipping forces a rediscovery cost.

When designing, invoke `Skill(skill="design", args="<slug>")`; on
`status: failed`, apply the failure rule. When skipping, log the
decision in dialogue (no scratchpad write) and proceed to step 5;
`/plan` reads only the PRD.

### 5. Run `/plan`, push, open the planning PR, pause

Invoke `Skill(skill="plan", args="<slug>")`. On `status: failed`,
apply the failure rule. On `status: complete`:

1. `git push -u origin plan/<slug>`.
2. `gh pr create` with title `chore(<slug>): planning bundle (PRD +
   design + plan)` and a body listing the PRD / design (if any) /
   plan paths. The `pre-pr-checks` hook gates the push.
3. Print the PR URL and the literal instruction:
   `Run /tasks <slug> manually after merging this planning PR to main.`
4. Stop. Control returns to the user.

`/feature` does NOT call `/tasks` — `/tasks` reads plan from `main`,
and that URL only exists post-merge.

## Resume contract

`/feature <slug>` reads `.claude/scratchpads/<slug>/phase-state.md`
and branches on the frontmatter:

- `status: complete`, `next_phase: prd` → step 3.
- `status: complete`, `next_phase: design` → step 4 (skip-design
  check + optional `/design`), then step 5.
- `status: complete`, `next_phase: plan` → design is settled (done
  or pre-skipped); jump to step 5 (run `/plan`, push + PR).
- `status: complete`, `next_phase: tasks` → plan is done; jump to
  step 5 sub-steps 1-4 (push + PR). If the PR already exists, print
  its URL and stop.
- `status: in-progress` → previous run was killed mid-phase. Surface
  the phase name and ask whether to resume (re-invoke that sub-skill)
  or abort.
- `status: failed` → max review cycles exceeded, subagent error, or
  user abort. Surface the failing phase and review file
  (`prd-review.md` / `plan-review.md`) to the user and pause. Do NOT
  auto-retry. Do NOT advance. The user fixes the artefact on
  `plan/<slug>` (or overrides) and re-invokes `/feature <slug>`.

Sub-skills own and rewrite `phase-state.md`. `/feature` only reads it.

## Phase tracking

`/feature` does NOT write its own phase-state. Each sub-skill
rewrites `.claude/scratchpads/<slug>/phase-state.md` per
`docs/agents/phase-state-schema.md`; the orchestrator reads only.

## What stays out

- **`/tasks`** (phase 5) — invoked manually after planning-PR merge.
- **`/implement-task`** (phase 6) — separate sessions per Work Item.
- **`/log-episode`** (phase 7) — finale of each `/implement-task`.
- **The planning PR's merge** — human reviewer does that.
- **Per-phase logic** (slug discipline, branch enforcement, reviewer
  loops, ADR drafting) — owned by sub-skills; never duplicated here.

## Language

**Dialogue:** mirror the user. **PR title, PR body, sub-skill
arguments, artefact text: always English** — downstream agents read
them.

## When NOT to use this skill

- Work Item already in Plane → `/implement-task`.
- Small bug fix or doc-only change → straight to implementation.
- Just drafting a research note → invoke `/research` directly.
- Planning PR already merged → invoke `/tasks <slug>` directly.
