---
name: prd
description: >-
  Second phase of the agent-system pipeline. Read the research note
  written by /research and produce a Product Requirements Document
  at docs/product/<slug>.md on the plan/<slug> branch. Required
  reviewer (prd-reviewer) runs in a fresh context. Manual
  invocation only.
disable-model-invocation: true
argument-hint: "<feature-slug>"
---

# PRD

You take the research note produced by `/research` and write a PRD
that the rest of the pipeline (`/design`, `/plan`, `/tasks`,
`/implement-task`) can consume without re-litigating product decisions.
The reviewer (`prd-reviewer`) audits your draft in a fresh context.

## Why this exists

A PRD is a contract; contracts are expensive to rework. The writer
benefits from an isolated session whose only job is filling the
template against an already-stable research note — no re-running of
web research or code archaeology (`/research` paid that cost once
and checkpointed the result).

The required `prd-reviewer` in fresh context catches drift that
self-review systematically misses (omitted sections, prose hedging,
locked-vs-open category errors).

## Inputs and outputs

**Input:** `.claude/scratchpads/<slug>/research.md` (written by
`/research`; sections `## Problem framing`, `## Baseline context`,
`## External findings`, `## Open questions`).

**Output:** `docs/product/<slug>.md`, committed on branch
`plan/<slug>` as the first commit; `/design` and `/plan` add their
artefacts to the same branch later. One bundled PR opens after
`/plan` — not after this skill.

**Side-output:** `.claude/scratchpads/<slug>/prd-review.md` written
by `prd-reviewer`. Read-only after finalisation.

## The five-step flow

### 1. Resolve the slug and research note

The user invokes `/prd <feature-slug>`. The slug is invariant per
`docs/agents/plane/universal.md § 3` and equals the folder name under
`.claude/scratchpads/`. Verify `.claude/scratchpads/<slug>/research.md`
exists; if missing or malformed, abort and tell the user to run
`/research` first or to confirm the slug. If the user typed a partial
and multiple candidate slugs exist, list them and ask. **Do NOT
write `phase-state.md` until step 2** — an aborted step-1 must leave
no scratchpad state behind.

### 2. Set the planning branch and open phase-state

The PRD, design, and plan all commit to one shared branch
`plan/<slug>`; the bundled PR opens after `/plan`. Enforce:

- On `plan/<slug>` already, clean tree → continue.
- On `main`, clean tree → `git checkout -b plan/<slug>`.
- Any other state (different branch, dirty tree, detached HEAD) →
  abort, surface the state, ask the user to clean up.

The skill never force-resets, force-checkouts, or stashes the working
tree on the user's behalf.

Once the branch is settled, write `phase-state.md` (`phase: prd`,
`started_at: <now ISO 8601 UTC>`, `status: in-progress`, `cycles: 0`,
`next_phase: design`).

### 3. Draft the PRD

Read the template at `assets/prd-template.md`. Every section header
appears in the output in template order — downstream agents may index
by section number. If a section is genuinely not applicable, write
`N/A — <one-line reason>`; never leave a section empty.

Fill from the research note: §0 inventory of files/tables/paths
already named in `## Baseline context`; §1-§3 from `## Problem
framing`; §5.2 baseline data from any DB queries the research ran;
§8 alternatives from `## External findings`; §10 open questions from
the research note's `## Open questions`. Do not invent new research —
if a fact did not survive into the research note, it is not yours to
introduce.

**Writing discipline (the PRD is read by an agent, not a human):**

- **Declarative, not hedging.** "We may consider X" becomes "X:
  deferred to fast-follow — reason: …" or moves to §10.
- **Self-contained.** File paths, table names, and prior decisions
  are cited explicitly — agents do not infer subtext.
- **Lock vs open is binary.** §11.1 (agent-owned) and §11.2 (locked)
  must not overlap; the agent uses these to decide whether to ask.
- **Code refs are inventory, not decision.** §0, §5, §11.3, §11.5
  cite files/tables/columns that already exist. New column names,
  library choices, and enum values belong at most in §11.4 as
  non-binding hints — never in §11.2.

Length budget: soft cap ~400 lines. Compress §6 and §11.4 first;
never compress §11.2, §11.3, or §4 — those are the load-bearing
contract.

### 4. Review loop (`prd-reviewer` in fresh context)

Once the draft is on disk, spawn the reviewer:

```
Agent(
  subagent_type: "prd-reviewer",
  description: "Audit draft PRD against research note",
  prompt: |
    ARTIFACT_PATH: docs/product/<slug>.md
    RESEARCH_PATH: .claude/scratchpads/<slug>/research.md
    TEMPLATE_PATH: ${CLAUDE_SKILL_DIR}/assets/prd-template.md
    VERDICT_PATH: .claude/scratchpads/<slug>/prd-review.md
)
```

Pass file paths only — never working notes, partial drafts, or your
own framing. The reviewer reads ARTIFACT, RESEARCH, and TEMPLATE
independently and writes verdict + findings to VERDICT_PATH.

Read in two passes:

- **Pass 1 — verdict.** Read the first non-empty line under
  `### Verdict`. The token is `approved` or `changes-required`; an
  optional 1-2 sentence summary may follow on subsequent lines.
- **Pass 2 — findings (when present).** Read the `### Findings`
  block (omitted when there are zero Critical and zero Warning).
  - `changes-required` with Critical findings → revise the PRD,
    increment `cycles`, re-spawn the reviewer. Maximum **2 cycles**.
  - After 2 cycles still `changes-required` → set `phase-state.md`
    `status: failed`, surface remaining findings, pause for user
    direction (override, defer, abort).
  - `approved` with a `### Findings` block (Warning-only) → surface
    each Warning to the user with three choices: fix now, defer to
    follow-up, or skip with rationale. Then go to step 5.
  - `approved` with no `### Findings` → go to step 5.

### 5. Commit and hand off

Commit the PRD on `plan/<slug>` per `CLAUDE.md § Git` (stdin
HEREDOC, Conventional Commits; type `feat` for a new product
surface, `chore` if the PRD only captures existing intent). Do NOT
push or open a PR — the planning branch waits for `/design` and
`/plan`.

Update `phase-state.md`: `status: complete`, `ended_at: <now ISO 8601
UTC>`, `next_phase: design` (or `plan` if design is skipped). Tell
the user the PRD path and that `/design` (or `/plan` for trivial
features) is next. Control returns to the user — do NOT invoke
downstream skills automatically.

## Phase tracking

This skill writes the **feature-level** phase-state file at
`.claude/scratchpads/<slug>/phase-state.md`, schema at
`docs/agents/phase-state-schema.md`. Fields written:

- `phase: prd`; `next_phase: design` (or `plan` when design is skipped).
- `started_at`: on entry to step 2; a failed step 1 leaves no file.
- `ended_at`: `null` while running; set when step 5 finishes.
- `status`: `in-progress` → `complete` on approval, `failed` on cycle
  exhaustion or user abort.
- `cycles`: `0` → `+1` per writer→reviewer iteration; capped at 2.

## What stays out

- **Re-doing research.** The research note is the source; do not
  re-fetch web content or rerun DB scans. Missing facts go to §10
  or back to the user — do not invent.
- **Code-level decisions.** Column types, library choices, file
  layout, migration strategy belong at most in §11.4 hints.
- **Design choices** (data shapes, API contracts, algorithms) —
  `/design`'s responsibility on the same branch.
- **Pushing or PR-opening** — the bundled PR opens after `/plan`.

## Language

**Dialogue:** mirror the user's language.

**`docs/product/<slug>.md`: always English.** Downstream agents and
the rest of `docs/` are English.

## When NOT to use this skill

- No research note for the slug → run `/research` first.
- User wants to brainstorm without committing → stay in `/research`.
- Approved PRD already exists → invoke `/design` or `/plan`.
- Small bug fix or doc tweak → go straight to implementation.
