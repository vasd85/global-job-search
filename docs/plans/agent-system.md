# Implementation Plan: Agent System

## 0. Context

This is the implementation plan for the agent system defined in
`docs/agents/architecture.md`. It bootstraps the very pipeline it
describes: while the new skills (`/research`, `/prd`, `/design`,
`/plan`, `/tasks`, `/implement-task`, `/feature`, `/log-episode`) are
not yet built, this plan is written manually following the structure
that `/plan` will eventually produce automatically.

**Reference:** `docs/agents/architecture.md` — constitution, tier
rules, phase model, evaluator-optimizer pattern, episode log schema.
The plan does not duplicate those decisions; it sequences and grounds
them.

## 1. Goals

- Replace the current monolithic `/implement` and standalone
  `/product-research` with a phase-isolated pipeline aligned with the
  architecture.
- Establish Tier 2 canonical storage (`docs/episodes/<YYYY-MM>.jsonl`)
  with a working `/log-episode`.
- Wire Plane.so as the execution surface for atomic Work Items, with
  status lifecycle automated via MCP.
- Keep old skills functional through migration; deprecate only when
  replacements are stable.

## 2. Non-goals

- Not implementing optional reviewers (`research-reviewer`,
  `design-reviewer`) in the first pass — they are added later if
  practice shows quality regressions.
- Not building Stage 3 episode log aggregation (`/promote-pattern`)
  until ~30-50 episodes accumulate.
- Not switching to the new pipeline for in-flight work; existing
  feature branches finish under `/implement`.

## 3. Dependency DAG

After **Step 1** (foundation), two independent build chains start in
parallel.

**Planning chain** (sequential — each step's output is the next step's
input):

- Step 2 (`/research`)
- → Step 3 (`/prd` + `prd-reviewer`)
- → Step 4 (`/design`, conditional)
- → Step 5 (`/plan` + `plan-reviewer`)
- → Step 6 (`/tasks`)
- → Step 8 (`/feature` orchestrator chains 2-6)

**Implementation chain:**

- Step 7 (`/implement-task`)
- → Step 9 (`/log-episode` — integrates as `/implement-task` finale,
  editing the SKILL.md produced by step 7; depends strictly on step 7)

Both chains converge at:

- Step 10 — deprecate `/product-research` and `/implement`

Deferred until enough episodes accumulate (require live episode log
data; not on the critical path):

- Step 11 (~15-20 episodes)
- Step 12 (~30-50 episodes)

**Parallelisation opportunities:**

- Step 2 (`/research`) and Step 7 (`/implement-task`) can be built in
  parallel after step 1 — they have no shared subagent contracts and
  no overlapping file edits.
- Within each chain, steps are sequential because each reads the
  previous step's artefact contract.

## 4. Implementation phases

### Step 1 — Foundation directories and templates

**Goal.** Make the locations declared in the architecture exist, with
the schemas they require.

**Outputs:**
- `docs/specs/.gitkeep` — placeholder (PRDs go here via `/prd`)
- `docs/designs/.gitkeep`
- `docs/plans/agent-system.md` (this file)
- `docs/adr/0000-template.md` — ADR template
- `docs/adr/0001-record-architecture-decisions.md` — first ADR
  declaring that we use ADRs (Michael Nygard format)
- `docs/episodes/schema.json` — JSON Schema describing one episode log
  entry, sourced from architecture.md §9.1
- `docs/episodes/.gitkeep` — placeholder until first month file
- `docs/agents/phase-state-schema.md` — minimum schema each skill must
  write to `.claude/scratchpads/<slug>/phase-state.md`. Initial fields:
  `phase` (string, current phase name), `started_at` / `ended_at`
  (ISO timestamps), `status` (`in-progress` / `complete` / `failed`),
  `next_phase` (optional pointer for orchestrators), `cycles`
  (integer, for evaluator-loop counts). Refined by step 2 once the
  first skill writes one.

**Acceptance criteria:**
- All directories exist and are tracked by git
- ADR template has sections: Context, Decision, Status, Consequences
- Episode schema validates the example in architecture.md §9.1
- `phase-state-schema.md` is referenced from skill contracts (every
  future skill's SKILL.md cites it) and lists fields concretely enough
  that two reviewers would write compatible files

**Effort:** 30-45 min.

**Risks:** none meaningful.

### Step 2 — `/research` skill

**Goal.** Extract phases 1-3 of the existing `/product-research` into
a standalone skill that produces a research note in scratchpads
without writing to `docs/`.

**Outputs:**
- `.claude/skills/research/SKILL.md`
- `.claude/skills/research/references/lenses.md` (moved or copied
  from `/product-research`)
- A research note schema documented inside SKILL.md

**Acceptance criteria:**
- Runs against a test topic and produces
  `.claude/scratchpads/<slug>/research.md` with sections: Problem
  framing, Baseline context, External findings, Open questions
- Delegates external research to a subagent (no direct web fetch in
  main context)
- Does not touch `docs/`

**Effort:** 2-3 h.

**Risks:**
- Tempting to dump everything from `/product-research` Phases 1-3.
  Mitigation: keep SKILL.md under 200 lines; what does not fit goes
  to `references/`.

### Step 3 — `/prd` skill + `prd-reviewer` subagent

**Goal.** Take a research note, produce a PRD on a planning branch.
Required reviewer in fresh context.

**Outputs:**
- `.claude/skills/prd/SKILL.md`
- `.claude/skills/prd/assets/prd-template.md` (moved from
  `/product-research`)
- `.claude/agents/prd-reviewer.md`

**Acceptance criteria:**
- Reads `scratchpads/<slug>/research.md`, writes
  `docs/product/<slug>.md` on `plan/<slug>` branch
- Spawns `prd-reviewer` after writing; reviewer writes verdict to
  `scratchpads/<slug>/prd-review.md`
- Loops up to 2 cycles on Critical findings; pauses on cycle exhaustion
- Reviewer reads PRD + research note in fresh context, never sees
  writer's working notes

**Effort:** 3-4 h.

**Risks:**
- Reviewer may be too lenient or too strict on first pass. Mitigation:
  empirical tuning over the first 5 PRDs; track `reviews.prd.cycles`
  in the episode log to spot drift.

### Step 4 — `/design` skill (conditional)

**Goal.** Wrap existing `code-architect` subagent in a slash-skill
that writes technical design to `docs/designs/<slug>.md`. Skipped for
trivial features.

**Outputs:**
- `.claude/skills/design/SKILL.md`
- Skip-criteria documented inside SKILL.md (1-2 files, no architectural
  decisions, no new data models, no new API contracts)

**Acceptance criteria:**
- Reads `docs/product/<slug>.md`, writes
  `docs/designs/<slug>.md` on the same `plan/<slug>` branch
- Asks user when uncertain about skip
- Drafts ADRs as a side effect when design contains decisions with
  broad scope (writes them to `docs/adr/<NNNN>-<slug>.md` on the
  same branch)

**Effort:** 3-4 h.

**Risks:**
- Skip heuristic too eager → important design phases skipped.
  Mitigation: when in doubt, ask user; track `phases_run` skipped-design
  episodes for review.

### Step 5 — `/plan` skill + `plan-reviewer` subagent

**Goal.** Take PRD (and design if present), produce an implementation
plan with explicit DAG of chunks.

**Outputs:**
- `.claude/skills/plan/SKILL.md`
- `.claude/skills/plan/assets/plan-template.md` — section structure:
  Context, Constraints, Chunks (with `depends_on`), Files, Test
  strategy, Risks
- `.claude/agents/plan-reviewer.md`

**Acceptance criteria:**
- Reads PRD + optional design, writes `docs/plans/<slug>.md` on the
  `plan/<slug>` branch with explicit DAG
- DAG is machine-readable (each chunk has `id` and `depends_on: [ids]`)
- Reviewer subagent verifies plan against PRD; loops up to 2 cycles
- After reviewer approval, the planning branch is ready for the
  single planning PR (PRD + design + plan together)

**Effort:** 3-4 h.

**Risks:**
- Plan reviewer needs both PRD and design in fresh context — risk of
  context bloat for large features. Mitigation: reviewer reads only
  declared sections via offset/limit.

### Step 6 — `/tasks` skill

**Goal.** Convert the merged plan into Plane Epic + Work Items with
`blocked_by` relations.

**Outputs:**
- `.claude/skills/tasks/SKILL.md`
- Reuses existing `/plane-integration` skill as reference

**Acceptance criteria:**
- Reads `docs/plans/<slug>.md` from `main` (after planning PR merge)
- Creates one Plane Epic with `@`-mention back-link to plan in `main`
- Creates one Plane Work Item per chunk, with description containing:
  link to plan, parent Epic, brief acceptance criteria
- Encodes DAG via `mcp__plane__create_work_item_relation` with type
  `blocked_by`
- Idempotent: running twice on the same plan does not duplicate Epic
  or Work Items (looks up by slug or feature_slug tag first)

**Effort:** 3-4 h.

**Risks:**
- Plane MCP rate limit (60 req/min). Mitigation: batch where API
  allows; back off on 429.
- Plane state names not standard (`Backlog` vs `Todo`). Mitigation:
  call `list_states` at start, map to closest existing.

### Step 7 — `/implement-task` skill

**Goal.** Implement one Work Item. Internal pipeline of 6+1 steps as
defined in architecture §6.1.

**Outputs:**
- `.claude/skills/implement-task/SKILL.md`
- Reuses existing `developer`, `test-scenario-designer`,
  `test-writer`, `code-reviewer` subagents unchanged

**Acceptance criteria:**
- Takes a Plane Work Item id, verifies not blocked
- Marks WI `In Progress` in Plane via MCP, comments with branch name
- Runs internal pipeline: Code → Test design → Test write → Review →
  (Fix cycle ≤ 2) → PR
- Marks WI `In Review` after `gh pr create`, comments with PR URL
- Supports `isolation: "worktree"` for parallel sessions on
  independent Work Items

**Effort:** 6-10 h. Largest step. May be split into 7a (single-task
path: steps 0-4 of internal pipeline) and 7b (worktree concurrency +
Plane status integration) if 7a needs to land independently for
validation.

**Risks:**
- Migrating Phases 3-7 logic from existing `/implement` while keeping
  it working is the main complexity. Mitigation: build new skill
  alongside old one; do not delete old until step 10.
- Worktree concurrency may surface stale-state bugs. Mitigation: test
  with two simultaneous Work Items before committing.

### Step 8 — `/feature` chain orchestrator

**Goal.** Chain phases 1-5 in one session for new features.

**Outputs:**
- `.claude/skills/feature/SKILL.md`

**Acceptance criteria:**
- Takes a topic, runs `/research` → `/prd` → `/design` (conditional)
  → `/plan` → `/tasks` sequentially
- Hands control back to user after `/tasks`, listing Work Item ids
- Resumes from `phase-state.md` if interrupted mid-chain
- Decides skip-design heuristic; asks user when uncertain

**Effort:** 2-3 h.

**Risks:**
- Orchestrator becomes a place that grows complexity. Mitigation: it
  must stay under 150 lines; logic lives inside individual skills.

### Step 9 — `/log-episode` skill + `/implement-task` finale integration

**Goal.** Append per-task entries to `docs/episodes/<YYYY-MM>.jsonl`.
Two invocation modes: as `/implement-task` finale (after PR merge in
the same session), or standalone with `<pr-url>` argument.

**Outputs:**
- `.claude/skills/log-episode/SKILL.md`
- Integration hook in `/implement-task` SKILL.md (final step)

**Acceptance criteria:**
- Auto-extracts metadata from `phase-state.md`, `events.jsonl` (when
  available), `git diff`, PR API
- Drafts `decisions`, `blockers`, `dead_ends`, `learnings` from
  scratchpad notes; presents draft for user approval
- Never silent-writes — user always edits or approves before append
- Validates against `docs/episodes/schema.json` before append
- Includes `session_ids` populated from `meta.json` of all skill-log
  runs that contributed to this Work Item

**Effort:** 3-4 h.

**Risks:**
- Auto-extraction depends on `phase-state.md` discipline being
  consistent across skills. Mitigation: define `phase-state.md` schema
  in step 1 (foundation), enforce in each skill's contract.

### Step 10 — Deprecate `/product-research` and `/implement`

**Goal.** Remove the old monolithic skills now that the new pipeline
is functional and battle-tested.

**Outputs:**
- Deletion of `.claude/skills/product-research/` and
  `.claude/skills/implement/`
- Update of `CLAUDE.md` references and `docs/agents/architecture.md`
  Skill inventory (status: REMOVED instead of DEPRECATE)

**Acceptance criteria:**
- At least 2 features have been delivered through the new pipeline
  end-to-end without falling back to old skills
- No remaining doc or skill references the old slash-commands

**Effort:** 1 h (mostly mechanical; the validation runs in step 9
and earlier).

**Risks:**
- Removing too early — new skills have undiscovered bugs. Mitigation:
  the 2-feature gate above.

### Step 11 (deferred) — Episode log Stage 2 reads

**Goal.** Add grep-based past-episode lookup to `/plan` and `/prd`.

**Trigger:** ~15-20 episodes accumulated.

**Effort:** 1-2 h when triggered.

### Step 12 (deferred) — Episode log Stage 3 aggregation

**Goal.** Build `/promote-pattern` skill that surfaces 3+ repeated
patterns from the episode log and drafts promotion PRs.

**Trigger:** ~30-50 episodes accumulated.

**Effort:** 4-6 h when triggered.

## 5. Validation strategy

### Bootstrapping with one small feature

After step 7 (`/implement-task`) lands, before step 8 (`/feature`)
chains everything, the new pipeline must be validated end-to-end on
**one truly trivial real feature** of the codebase. The candidate
must be small enough that `/design` is honestly skippable, so all
phases (including the conditional skip-decision) get exercised.

Suitable candidates: a single-config-flag toggle in
`packages/ats-core/`, a copy or label adjustment in `apps/web/`, or
a CSS / Tailwind-class fix. **Not** suitable: extractor logic,
schema changes, or anything that introduces a new shape or
contract — those should run through `/design` and need a separate
validation pass once `/design` is built.

The validation run uses the new skills *manually* in sequence:
`/research` → `/prd` → `/plan` → (planning PR) → `/tasks` →
`/implement-task` → `/log-episode`. If any step has a contract
mismatch, fix before building `/feature`. A second validation run
through a feature that *does* require `/design` is recommended once
step 4 lands and before step 8.

### Migration period

Old skills (`/product-research`, `/implement`) remain functional and
documented during steps 2-9. Any in-flight feature continues under
the old pipeline until it merges. New features after step 8 use the
new pipeline. After two end-to-end successful new-pipeline features,
step 10 deprecates the old skills.

## 6. Risks and mitigations (cross-cutting)

- **Skill bloat.** Each new SKILL.md must stay under 200 lines.
  Reference material goes to `references/`. Re-check on every PR.
- **Subagent contract drift.** When two skills consume the same
  subagent (e.g. `code-architect` used by both `/code-architect` and
  `/design`), a change in one prompt can break the other. Mitigation:
  document subagent inputs/outputs in `architecture.md §7`; treat
  subagent contracts as Tier 1.
- **Plane MCP instability.** Three skills write to Plane —
  `/tasks` (creates Epic and Work Items, step 6), `/implement-task`
  (status transitions to `In Progress` / `In Review`, step 7), and
  `/log-episode` (closes WI to `Done` on merge, step 9). All Plane
  writes must be wrapped with explicit error handling and graceful
  user notification. Silent retries are not acceptable; status drift
  between git and Plane is acceptable temporarily, but only when
  explicitly surfaced to the user.
- **Episode log schema evolution.** Add `schema_version` field to each
  entry from day one. When the schema changes, write a migration
  script that updates older entries; never break grep contracts.
- **Recursive bootstrapping risk.** This very plan is being written
  manually because `/plan` does not exist yet. Once `/plan` lands at
  step 5, this file should not be regenerated — it is grandfathered
  in. Future plans go through the skill.

## 7. Open questions for implementation time

These are decisions intentionally deferred until the relevant step
starts. They are local to this plan; questions already deferred in
`docs/agents/architecture.md §13` (worktree cleanup policy, per-phase
token budgets) are not duplicated here — see the architecture for
those.

- **Conditional `/design` heuristic concrete rules.** Drafted in
  step 4; tightened after first 5 features.
- **Reviewer prompt templates.** Each reviewer subagent has its own
  prompt; tuned empirically over first 5 reviews.

## 8. Tracking

Progress against this plan is tracked in two stages:

- **Steps 1-5: git-only.** These steps land before `/tasks` exists,
  so they are tracked solely via `git log` on their respective
  branches. No Plane mirror is created retroactively — the plan-side
  cost of retro-creating Work Items for already-merged work is not
  worth the consistency benefit.
- **Steps 6 onward: Plane Epic + git.** Once step 6 (`/tasks`) lands,
  it is exercised on this very plan to create a Plane Epic
  `agent-system-implementation` with Work Items for steps 6-10.
  Steps 11-12 are added later when their triggers fire. From this
  point on, Plane is the canonical execution surface for remaining
  implementation work, and episode log entries (after step 9 lands)
  retrospectively annotate completed steps.
