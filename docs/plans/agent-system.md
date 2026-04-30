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

- Step 2 (`/research`) and Step 7 (`/implement-task`) can be **built**
  in parallel after step 1 — they have no shared subagent contracts
  and no overlapping file edits.
- Within each chain, steps are sequential because each reads the
  previous step's artefact contract.

**Buildable vs validatable.** Step 7 can be built in parallel with
the planning chain, but its end-to-end **validation** depends on
Step 6 (`/tasks`) being live: `/implement-task` reads a Plane WI
that only exists after `/tasks` has run. The build-only edge is
`step 1 → step 7`; the validation edge is
`step 6 → step 7 (e2e validation)`. Step 7 may be partially
validated earlier with a mocked WI fixture (sequential mode only);
the full smoke test waits on step 6.

## 4. Implementation phases

### Step 1 — Foundation directories and templates

**Goal.** Make the locations declared in the architecture exist, with
the schemas they require.

**Outputs:**
- `docs/product/.gitkeep` — placeholder (PRDs go here via `/prd`)
- `docs/designs/.gitkeep`
- `docs/plans/agent-system.md` (this file)
- `docs/adr/0000-template.md` — ADR template
- `docs/adr/0001-record-architecture-decisions.md` — first ADR
  declaring that we use ADRs (Michael Nygard format)
- `docs/episodes/schema.json` — JSON Schema describing one episode log
  entry, sourced from architecture.md §9.1, **including
  `schema_version: 1`** (required from day one per § 6 cross-cutting
  risks)
- `docs/episodes/.gitkeep` — placeholder until first month file
- `docs/agents/phase-state-schema.md` — minimum schema each skill must
  write to `.claude/scratchpads/<slug>/phase-state.md` (or its
  per-task variant per architecture § 5). Initial fields: `phase`
  (string, current phase name), `started_at` / `ended_at` (ISO
  timestamps), `status` (`in-progress` / `complete` / `failed`),
  `next_phase` (optional pointer for orchestrators), `cycles`
  (integer, for evaluator-loop counts). Refined by step 2 once the
  first skill writes one.

**Acceptance criteria:**
- All directories exist and are tracked by git via `.gitkeep`
  placeholders
- ADR template has sections: Context, Decision, Status, Consequences
- Episode schema validates the GJS-42 example in architecture.md §9.1
  including `schema_version`
- `phase-state-schema.md` exists with the listed fields and a worked
  example. Cross-cutting requirement (verified at each later step):
  every new skill's SKILL.md must cite this schema in its phase
  tracking section.

**Effort:** 30-45 min.

**Validation:** `git ls-files docs/` shows all four directories
tracked; `node -e "require('ajv').default()(require('./docs/episodes/schema.json'))(...)" `
or equivalent jsonschema check passes against the architecture § 9.1
example.

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

**Validation:** run `/research` against a fixture topic (e.g.
"caching strategy for ATS extractor"); verify the produced
`research.md` has all four sections, no `docs/` writes happened, and
external research came from a subagent log entry rather than the
main session.

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

**Validation:** run `/prd` on the fixture research from step 2's
validation; verify it produces a PRD on `plan/<slug>` branch, the
reviewer fires and writes its verdict, and a deliberately-broken
PRD draft (missing required section) triggers `changes-required`
and the cycle counter increments.

**Risks:**
- Reviewer may be too lenient or too strict on first pass. Mitigation:
  empirical tuning over the first 5 PRDs; track `reviews.prd.cycles`
  in the episode log to spot drift (telemetry available after step 9).

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

**Validation:** run `/design` against the fixture PRD; verify
`docs/designs/<slug>.md` lands on `plan/<slug>` branch. Run a second
time against a deliberately trivial PRD; verify the skip heuristic
triggers and asks the user.

**Risks:**
- Skip heuristic too eager → important design phases skipped.
  Mitigation: when in doubt, ask user. Track `phases_run`
  skipped-design episodes manually until step 9 lands and the
  episode log can do this automatically.

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

**Validation:** run `/plan` against the fixture PRD + design; verify
the plan emits a machine-parseable DAG (each chunk has `id` and
`depends_on`), the reviewer runs in fresh context (no PRD-writer
notes leak), and the planning branch is ready for the single
planning PR.

**Risks:**
- Plan reviewer needs both PRD and design in fresh context — risk of
  context bloat for large features. Mitigation: reviewer reads only
  declared sections via offset/limit.

### Step 6 — `/tasks` skill

**Goal.** Convert the merged plan into Plane Epic + Work Items with
`blocked_by` relations.

**Outputs:**
- `.claude/skills/tasks/SKILL.md`
- Primary contract: `docs/agents/plane/universal.md` +
  `docs/agents/plane/tasks.md`. The existing `/plane-integration`
  skill is consulted only as a fallback technical reference for
  generic MCP shape questions, per the authority chain in
  `universal.md § 0`.

**Acceptance criteria:**
- Reads `docs/agents/plane/universal.md` and
  `docs/agents/plane/tasks.md` at startup
- Reads `docs/plans/<slug>.md` from `main` (after planning PR merge)
- Creates one Plane Epic per `tasks.md § 4.1` (idempotent via
  `external_id`)
- Creates one Plane Work Item per chunk per `tasks.md § 4.2`
- Encodes plan DAG via `mcp__plane__create_work_item_relation` with
  type `blocked_by` per `tasks.md § 5`
- Applies labels per `tasks.md § 6`
- Idempotent: re-run reconciles via `external_id` lookup; chunks
  removed from plan transition WIs to `Cancelled` per `tasks.md § 4.2`
- Failure recovery follows `tasks.md § 8`. No bootstrap-time
  validation — if the workspace is misconfigured, MCP failure surfaces
  per `universal.md § 7` and the failure message points the user to
  `plane/bootstrap.md`.

**Effort:** 3-4 h.

**Validation:** dry-run `/tasks` against this very plan
(`docs/plans/agent-system.md`) — it should reconcile against the
existing Epic GJS-8 and WIs GJS-9..GJS-18 by `external_id` and
produce zero new entities. A second dry-run against a small fixture
plan verifies the create path.

**Risks:**
- Plane MCP rate limits. Mitigation: batch where API allows; back
  off on 429 per `universal.md § 7` (the convention does not pin a
  specific request-per-minute number; that is left to runtime
  observation).
- Skill SKILL.md should not duplicate content from `plane/tasks.md`
  — it consumes the conventions, does not redefine them. Mitigation:
  per § 6 skill bloat guard.

### Step 7 — `/implement-task` skill

**Goal.** Implement one Work Item. Internal pipeline of 6+1 steps as
defined in architecture §6.1.

**Outputs:**
- `.claude/skills/implement-task/SKILL.md`
- Reuses existing `developer`, `test-scenario-designer`,
  `test-writer`, `code-reviewer` subagents unchanged

**Acceptance criteria:**
- Reads `docs/agents/plane/universal.md` and
  `docs/agents/plane/implement-task.md` at startup
- Takes a Plane Work Item id, verifies not blocked per
  `implement-task.md § 5`
- Creates branch per `implement-task.md § 1`
- Marks WI `In Progress` per `implement-task.md § 2-3`, comments per
  `implement-task.md § 4`
- Runs internal pipeline: Code → Test design → Test write → Review →
  (Fix cycle ≤ 2) → PR
- Marks WI `In Review` after `gh pr create`, comments with PR URL
- Implements the worktree contract from architecture § 6.1 step 0:
  detects sequential vs parallel mode, creates branch from current
  HEAD, never invokes `git worktree add` itself
- The skill is the orchestrator for steps 0 (setup) and 6 (PR
  creation + Plane status); subagents are spawned only for steps
  1-5 (Code, Test design, Test write, Review, Fix cycle). Plane
  writes happen exclusively from the orchestrator, per `universal.md`
  § 6 (subagents do not call Plane).
- Failure recovery follows `implement-task.md § 6`

**Effort:** 6-10 h (supersedes the 4-6 h estimate in architecture
§ 11; reasons: the worktree contract and parallel-mode validation
were added after the architecture roadmap was first drafted).
Largest step. May be split into 7a (single-task path: steps 0-4 of
internal pipeline, sequential mode only) and 7b (parallel-mode
worktree contract + Plane status integration) if 7a needs to land
independently for validation.

**Validation:** 7a — sequential-mode dry run against a fixture WI
(small change touching one file) end-to-end through PR; verify
state transitions in Plane and the comment trail.
7b — two parallel `/implement-task` sessions in separate worktrees
on independent fixture WIs; verify no cross-session interference,
two distinct PRs opened, both transitioning to `In Review` correctly.

**Risks:**
- Migrating Phases 3-7 logic from existing `/implement` while keeping
  it working is the main complexity. Mitigation: build new skill
  alongside old one; do not delete old until step 10.
- Across-WI multi-session parallelism is genuinely new (not just a
  rename of `/implement` Phase 3 — see architecture § 4.2 for the
  distinction). Mitigation: test sequential mode first; add parallel
  mode only after the single-WI path is solid; manually validate two
  simultaneous WIs before declaring 7b done.

### Step 8 — `/feature` chain orchestrator

**Goal.** Chain phases 1-5 in one session for new features.

**Outputs:**
- `.claude/skills/feature/SKILL.md`

**Acceptance criteria:**
- Takes a topic, runs `/research` → `/prd` → `/design` (conditional)
  → `/plan` → `/tasks` sequentially
- Hands control back to user after `/tasks`, listing Work Item ids
- Resumes from `phase-state.md` if interrupted mid-chain (this
  decision **closes architecture § 13's open question** on
  `/feature` partial-failure behaviour: resume, not restart, not
  hand-off; record the closure when this step lands)
- Decides skip-design heuristic; asks user when uncertain
- After phase 4 (plan), opens a single planning PR and pauses;
  `/tasks` is invoked manually after the user merges the planning
  PR to `main` (so phase 5 reads the plan from `main`-branch URLs
  per architecture § 3 link policy)

**Effort:** 2-3 h.

**Validation:** dry-run on a small fixture topic; verify the chain
runs research → prd → design (or skip) → plan, opens the planning
PR, and stops. Then merge the planning PR by hand and run `/tasks`
to confirm the planning artefacts are reachable from `main`.

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
- Reads `docs/agents/plane/universal.md` and
  `docs/agents/plane/log-episode.md` at startup
- Auto-extracts metadata from `phase-state.md`, `events.jsonl` (when
  available), `git diff`, PR API
- Reads merge timestamp via `gh pr view --json mergedAt` (Plane has
  no flat `completed_at` field per `log-episode.md § 3`)
- Drafts `decisions`, `blockers`, `dead_ends`, `learnings` from
  scratchpad notes; presents draft for user approval
- Never silent-writes — user always edits or approves before append
- Validates against `docs/episodes/schema.json` before append,
  including the `schema_version` field
- Includes `session_ids` populated from `meta.json` of all skill-log
  runs that contributed to this Work Item. **Precondition:** the
  skill-logger emits `meta.json` per run (verify before this step
  starts; if missing, log entries fall back to "session_ids: []" and
  drill-down via `/analyze-skill-logs` is unavailable for that
  episode)
- Marks corresponding Plane WI `Done` per `log-episode.md § 1`,
  comments per `log-episode.md § 2`; episode log entry written
  regardless of Plane outcome per `log-episode.md § 4`
- Standalone-mode behaviour for old PRs (no surviving scratchpad):
  auto-extracted fields fall back to `null`; reasoning-trace fields
  are user-typed at draft time; episode is still appended

**Effort:** 3-4 h.

**Validation:** dry-run with a fresh test PR end-to-end (open PR,
merge, run `/log-episode`, confirm jsonl line appended and
schema-validates). Second run: standalone mode against a PR merged
days earlier (no scratchpad) — confirm fallback behaviour produces
a valid entry with nulls in auto-extracted fields.

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

**Validation:** `grep -r '/product-research\|/implement[^-]' docs/
.claude/ CLAUDE.md` returns no hits except in this plan and the
episode log. New `pnpm`-equivalent smoke command (manual runbook
check) lists no removed skill names.

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
- **Per-skill module loading** (architecture § 1 invariant 10).
  Reference docs consumed by multiple skills (currently
  `docs/agents/plane/`; later candidates: DB conventions, API
  conventions) are split into a universal core and per-skill modules.
  Skills load only the universal core plus their own module. When
  building each Plane-using skill (steps 6, 7, 9), confirm SKILL.md
  references the right two `plane/*.md` files and does not duplicate
  their content.
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

