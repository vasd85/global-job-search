---
name: implement
description: >-
  Full implementation pipeline — orchestrates plan, code, tests, and review.
  Use for any feature, bug fix, or refactoring that touches multiple files
  or benefits from structured workflow. Coordinates thinker agents (architect,
  test-scenario-designer, code-reviewer) and doer agents (developer,
  test-writer) through file-based context passing.
disable-model-invocation: true
argument-hint: "<task description or issue URL>"
---

ultrathink

# Implementation Pipeline

You are the orchestrator. You coordinate thinker and doer agents through
a structured pipeline, passing context between them via files in
`.claude/scratchpads/`.

**Your responsibilities:**
- Assess task complexity and choose the right pipeline path
- Break work into chunks that fit within agent context windows
- Relay context between agents via scratchpad files
- Keep the user informed and in control at decision points
- Monitor quality — don't proceed if a phase fails

**You do NOT:** write code, write tests, or review code yourself.
You delegate to specialized agents.

## Setup

1. Derive a short kebab-case task name from `$ARGUMENTS` (e.g.,
   `add-pagination`, `fix-auth-bug`).
2. Create the scratchpad directory:
   ```bash
   mkdir -p .claude/scratchpads/<task-name>
   ```
3. Save the full task description to a file (single source of truth
   for all agents and session recovery):
   ```bash
   # Write $ARGUMENTS and any user-provided context to task.md
   ```
   File: `.claude/scratchpads/<task-name>/task.md`
4. Create a branch if not already on a feature branch:
   ```bash
   git checkout -b <type>/<task-name>
   ```
5. Capture the absolute scratchpad path (worktree agents need it —
   `.claude/scratchpads/` is gitignored and invisible in worktrees):
   ```bash
   SCRATCHPAD=$(realpath .claude/scratchpads/<task-name>)
   ```
   Use `$SCRATCHPAD` in all prompts to worktree agents.

## Phase Tracking

At the start of each phase, update the phase state file:

```bash
echo "phase: <N> — <phase-name>" > .claude/scratchpads/<task-name>/phase-state.md
echo "status: in-progress" >> .claude/scratchpads/<task-name>/phase-state.md
echo "started: $(date -Iseconds)" >> .claude/scratchpads/<task-name>/phase-state.md
```

This enables session recovery — a new session can read `phase-state.md`
to know where to resume without inspecting every scratchpad file.

## Phase 1: Assess Complexity

Read the task description. Estimate scope:

- **Small** (1-2 files, clear approach): skip Phase 2, go to Phase 3.
- **Medium/Large** (3+ files, architectural decisions, new patterns):
  run full pipeline starting from Phase 2.

Tell the user which path you chose and why.

## Phase 2: Plan (medium/large only)

Spawn the **code-architect** agent:

```
Read the task description and design an implementation plan.

Task file: .claude/scratchpads/<task-name>/task.md

Write your plan to: .claude/scratchpads/<task-name>/plan.md
```

After the architect finishes:
1. Read the `## Summary` and `## Implementation Steps` sections of
   `.claude/scratchpads/<task-name>/plan.md` (use `offset`/`limit` to
   avoid loading the full file — you only need enough to present to the
   user and chunk the work in Phase 3).
2. Present a summary to the user.
3. **Wait for user approval.** Do not proceed until the user confirms.
4. If the user requests changes, either adjust the plan yourself or
   re-spawn the architect with feedback.

## Phase 3: Implement

Choose the right prompt variant based on whether Phase 2 ran.

### Small tasks (Phase 2 was skipped — no plan.md exists)

Spawn a single **developer** agent with the task description as context:

```
Implement the changes described in the task file.

Task file: .claude/scratchpads/<task-name>/task.md

After completing, write progress to:
.claude/scratchpads/<task-name>/dev-progress.md
```

### Medium/large tasks (plan.md exists)

**Chunk the work:** if the plan has more than 3-4 files or ~200 lines
of changes, split into chunks. Each chunk should be a coherent set of
changes that leaves the codebase in a compilable state.

Analyze the plan's dependency graph to classify chunks:
- **Dependent chunks** (one builds on another's output — e.g., schema
  change → API that uses new schema): must run **sequentially**.
- **Independent chunks** (different modules, no shared imports): can
  run **in parallel**. Example: `packages/ats-core` and
  `apps/web/src/components` can run simultaneously.

When in doubt, check if chunk B imports or references files from
chunk A — if not, they're independent.

**Sequential chunks** — run in the main working directory, one at a
time, verifying each compiles before starting the next:

```
Implement the following changes from the plan.

Task file: .claude/scratchpads/<task-name>/task.md
Plan file: .claude/scratchpads/<task-name>/plan.md
Your chunk: <specific steps or files to implement>

After completing, write progress to:
.claude/scratchpads/<task-name>/dev-progress.md
```

**Parallel chunks** — spawn each developer agent with
`isolation: "worktree"`. Use absolute scratchpad paths (`$SCRATCHPAD`
from Setup step 5) because `.claude/scratchpads/` is gitignored and
invisible in worktrees:

```
Implement the following changes from the plan.

Context files (absolute paths — you are in a worktree):
- Task: $SCRATCHPAD/task.md
- Plan: $SCRATCHPAD/plan.md
Your chunk: <specific steps or files to implement>

After completing, write progress to:
$SCRATCHPAD/dev-progress-<chunk-name>.md
```

**After parallel worktree agents complete — merge step:**
1. Collect the branch name from each agent's result.
2. Merge each branch into the feature branch:
   ```bash
   git merge <worktree-branch> --no-edit
   ```
3. If merge conflicts occur (unexpected for independent chunks),
   attempt auto-resolution. If that fails, report to user.
4. Run `pnpm typecheck` to verify the merged result compiles.

**Wait for ALL development commits to be done before proceeding.**

## Phase 4: Design Tests

Before spawning, assess how many modules were changed:

```bash
git diff main...HEAD --stat
```

**Small diff** (1-2 modules, ≤~200 lines changed): spawn a single
**test-scenario-designer** agent covering everything.

**Large diff** (3+ modules or ~200+ lines): split by module and spawn
multiple **test-scenario-designer** agents **in parallel**. Each agent
focuses on one module and writes to its own scenarios file.

For each module/chunk, spawn a **test-scenario-designer** agent:

```
Design test scenarios for the <module-name> changes on this branch.

Context files (read these first):
- Task description: .claude/scratchpads/<task-name>/task.md
- Implementation plan: .claude/scratchpads/<task-name>/plan.md
- Dev progress: .claude/scratchpads/<task-name>/dev-progress*.md (read all matching files)

Your scope: only changes in <module-path> (e.g., packages/ats-core/src/extractors/).
Run `git diff main...HEAD -- <module-path>` for your scoped diff.
Read the changed source files for full context.

Write scenarios to: .claude/scratchpads/<task-name>/test-scenarios-<module>.md
```

When using a single agent for a small diff, write to
`test-scenarios.md` (no module suffix).

After designer(s) finish:
1. Read only the `## Conclusion` or `## Summary` section of each
   `test-scenarios*.md` file (not the full file — scenarios are for the
   test-writer, not you).
2. If every designer concluded "existing coverage sufficient", inform
   the user and skip Phase 5.
3. Pass only the relevant scenarios file path to each test-writer in
   Phase 5 — do not paste scenario content into the prompt.

## Phase 5: Write Tests

Match test-writer agents 1:1 with scenarios files from Phase 4.

**Single scenarios file:** spawn one **test-writer** agent in the main
working directory:

```
Implement the test scenarios described in the scenarios file.

Context files:
- Task description: .claude/scratchpads/<task-name>/task.md
- Scenarios: .claude/scratchpads/<task-name>/test-scenarios.md

Follow the scenarios faithfully. If a scenario is infeasible, explain
why in your output.

After completing, write a progress summary to:
.claude/scratchpads/<task-name>/test-progress.md
```

**Multiple scenarios files:** spawn test-writer agents **in parallel**
with `isolation: "worktree"`. Use absolute scratchpad paths:

```
Implement the test scenarios described in the scenarios file.

Context files (absolute paths — you are in a worktree):
- Task description: $SCRATCHPAD/task.md
- Scenarios: $SCRATCHPAD/test-scenarios-<module>.md

Follow the scenarios faithfully. If a scenario is infeasible, explain
why in your output.

After completing, write a progress summary to:
$SCRATCHPAD/test-progress-<module>.md
```

**After parallel worktree agents complete — merge step:**
1. Merge each worktree branch into the feature branch (same procedure
   as Phase 3).
2. Run tests on the merged result:
   ```bash
   pnpm test
   ```
3. If tests fail, identify which module's tests broke and re-spawn
   that test-writer in the main directory to fix.

## Phase 6: Review

Spawn the **code-reviewer** agent:

```
Review all changes on this branch against main.

Context files (read these first to understand the intent):
- Task description: .claude/scratchpads/<task-name>/task.md
- Implementation plan: .claude/scratchpads/<task-name>/plan.md  (may not exist for small tasks)
- Test progress: .claude/scratchpads/<task-name>/test-progress*.md (scenarios implemented, skipped, bugs found)

Then review the diff:
- Run `git diff main...HEAD` for the full diff.
- Run `git log main..HEAD --oneline` for commit history.

Verify that the implementation fulfills the task description and follows
the plan. Flag deviations as findings.

Write your review to: .claude/scratchpads/<task-name>/review.md
```

After the reviewer finishes:
1. Read the `### Verdict` section of
   `.claude/scratchpads/<task-name>/review.md` first. Only read
   `### Findings` if the verdict requires fixes — avoid loading the full
   review into your context when the code is clean.
2. If verdict is "Ready to open PR" — proceed to Phase 7.
3. If **Critical** findings:
   - Spawn the **developer** with:
     ```
     Fix the critical issues listed in the review report.

     Context files:
     - Review report: .claude/scratchpads/<task-name>/review.md
     - Original plan: .claude/scratchpads/<task-name>/plan.md
     - Dev progress: .claude/scratchpads/<task-name>/dev-progress*.md
       (read all matching files — they contain implementation decisions
       you should respect when fixing)

     Fix only the items marked Critical. Commit each fix separately.
     ```
   - After fixes, go back to **Phase 4** (test-scenario-designer) to
     check if tests need adjustment for the fixes.
4. If only **Warning** findings:
   - Present each finding to the user.
   - Ask the user what to do: fix now, defer to follow-up, or skip.
   - If user chooses to fix, spawn developer with the review report
     path and specific items to fix, then back to Phase 4.

**Max review cycles:** 2. If still failing after 2 cycles, present the
remaining issues to the user and ask how to proceed.

## Phase 7: PR

1. Rebase on main:
   ```bash
   git fetch origin main && git rebase origin/main
   ```
   Resolve conflicts if any.

2. Ask the user for confirmation to create the PR.

3. Create the PR:
   ```bash
   gh pr create --title "<title>" --body "<body>"
   ```
   The `pre-pr-checks.sh` hook automatically runs `pnpm typecheck &&
   pnpm test` before `gh pr create` executes. No need to run checks
   manually here — the hook is the single deterministic gate.

   The `pre-pr-checks.sh` hook runs typecheck + tests as a final
   deterministic backstop.

## Error Handling

- If any agent fails (crashes, infinite loop, no output): report the
  failure to the user, do not retry automatically. Let the user decide.
- If `pnpm typecheck` or `pnpm test` fails between phases: fix before
  proceeding. Never pass broken code to the next phase.
- If the user wants to stop mid-pipeline: that's fine. The scratchpad
  files preserve all context for resuming later.

## Session Recovery

All intermediate artifacts live in `.claude/scratchpads/<task-name>/`.
If a session is interrupted, a new session can resume by:

1. Reading `phase-state.md` to identify the last active phase.
2. Cross-checking with `git log` and `git status` for implementation
   progress (commits may have landed after `phase-state.md` was written).
3. Picking up from the last completed phase. If `phase-state.md` says
   "in-progress", re-run that phase — partial results are not guaranteed.

## Scratchpad Files

| File | Written by | Read by |
|------|-----------|---------|
| `task.md` | orchestrator | all agents |
| `plan.md` | code-architect | developer, test-scenario-designer, orchestrator |
| `dev-progress[-<chunk>].md` | developer | test-scenario-designer, developer (fix cycle), orchestrator |
| `test-scenarios[-<module>].md` | test-scenario-designer | test-writer |
| `test-progress[-<module>].md` | test-writer | code-reviewer, orchestrator |
| `review.md` | code-reviewer | developer (fix cycle), orchestrator |
| `phase-state.md` | orchestrator | orchestrator (session recovery) |

**Read dependencies by agent:**
- code-architect → `task.md`
- developer → `task.md` + `plan.md` (medium/large) or `task.md` only (small)
- developer (fix cycle) → `review.md` + `plan.md` + `dev-progress*.md`
- test-scenario-designer → `task.md` + `plan.md` + `dev-progress*.md`
- test-writer → `task.md` + `test-scenarios[-<module>].md`
- code-reviewer → `task.md` + `plan.md` + git diff
