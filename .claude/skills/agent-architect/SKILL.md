---
name: agent-architect
description: >-
  Design, create, review, and audit Claude Code artifact architecture:
  CLAUDE.md, rules, skills, subagents, hooks, MCP servers, plugins.
  Use when the user wants to set up a new project for AI agents,
  restructure existing artifacts, decide which artifact type fits a
  requirement, create or modify any Claude Code configuration file,
  review or audit existing artifacts for quality and conformance,
  optimize context budget, or convert advisory instructions into
  deterministic hooks. Also use when the user says "configure agents",
  "set up Claude Code", "create a skill/hook/rule", "review my rules",
  "audit this hook", "check my CLAUDE.md", "architect the agent system",
  or asks "where should I put this instruction".
argument-hint: "<create|review|modify> <description>"
---

# Agent Architect — Orchestrator

You route instructions to the right Claude Code artifact type, clarify
requirements with the user, then delegate to specialized subagents:
- `artifact-writer` — creates and modifies artifacts (has Write/Edit tools)
- `artifact-reviewer` — reviews and audits artifacts (read-only)

ultrathink

## Task type detection

Before starting, determine the task type:

- **Create**: user wants a new artifact → use Creation workflow (Phases 1-4)
- **Review/Audit**: user wants to evaluate an existing artifact → use Review workflow
- **Modify**: user wants to change an existing artifact → use Modify workflow
- **Escalate**: user reports that Claude keeps ignoring an advisory instruction →
  the instruction needs deterministic enforcement, not just advisory guidance.
  Jump to Creation workflow with artifact type = Hook. Check whether the advisory
  artifact (rule/skill/CLAUDE.md) should be kept as companion documentation
  alongside the new hook.

If ambiguous, ask the user.

## Complexity assessment

Before spawning subagents, gauge the change size:

- **Trivial** (typo fix, one-line addition, single field change): act directly
  in the main session — read the relevant authoring guide yourself, make the
  edit, verify. No subagent needed, avoiding ~20k tokens of overhead per spawn.
- **Standard** (new artifact, multi-field changes, cross-artifact impact):
  delegate to the appropriate subagent as described in the workflows below.
- **Complex** (combo artifacts, ecosystem-wide restructuring): delegate with
  multiple subagent spawns as needed.

## Decision matrix

Ask these questions in order to identify the **primary** artifact type.

| # | Question | → Artifact | Adherence |
|---|----------|------------|-----------|
| 1 | Must execute 100% of the time, no exceptions? | **Hook** | deterministic |
| 2 | Needs an external service (DB, Jira, Slack, API)? | **MCP server** (+ Skill) | advisory |
| 3 | Should run in isolated context with own tools/model? | **Subagent** | advisory |
| 4 | Only when working with specific files/dirs? | **Rule** with `paths:` | advisory |
| 5 | Needed every session, standalone topic? | **Rule** (no paths) | advisory |
| 6 | Needed every session, core project context? | **CLAUDE.md** | advisory |
| 7 | Needed sometimes, on demand or by context match? | **Skill** | advisory |
| 8 | Should be shared across projects/teams? | **Plugin** | advisory |

Stop at the first YES — that's your **primary** artifact type.

**Then scan for companions.** Common combos exist because a single artifact
type rarely covers both enforcement and understanding:

- Primary is **Hook** → also create advisory companion (Skill or Rule) to explain
  the WHY behind the hook — Claude follows advisory guidance better when it
  understands intent, not just the block message.
- Primary is **MCP** → always pair with a **Skill** — a tool without domain
  knowledge is an anti-pattern (Claude won't know when or how to use it well).
- Primary is **Subagent** → check if **Skills** should be injected via `skills:`
  field — subagents don't inherit skills automatically.
- Primary is **Rule** or **CLAUDE.md** → check if the instruction is critical
  enough to also need a **Hook** backstop for deterministic enforcement.

Tell the user both the primary and any companion artifacts.

## Review workflow (for review/audit tasks)

When the task is to review, audit, or evaluate an existing artifact:

### Step 1: Identify artifact type(s) and files (YOU do this)

Determine which artifact type(s) are being reviewed and locate all relevant files
(the artifact itself, companion hooks, referenced subagents, supporting files).

For combo artifacts (e.g., a Skill that delegates to Subagents, or a Hook with
a companion Rule), identify ALL types involved — each needs separate evaluation
against its own authoring guide.

### Step 2: Delegate review to artifact-reviewer (SUBAGENT does this)

**Single-type artifact**: spawn one `artifact-reviewer` subagent:

```
ARTIFACT_TYPE: <type being reviewed>
ARTIFACT_PATH: <path to the artifact file(s)>
CONTEXT: <what the user wants evaluated, any specific concerns>
```

**Multi-type artifact** (e.g., Skill + Subagents): spawn one reviewer per type,
each evaluating against its own authoring guide. This ensures each component
is checked against the correct standard rather than being evaluated only
through the lens of the primary type.

The subagent will:
1. Read the relevant authoring guide from `references/`
2. Read the artifact being reviewed
3. Evaluate conformance against the authoring guide
4. Return: conformance, issues (with guide references), suggestions

### Step 3: Verify and report (YOU do this)

Review the subagent's conformance report, issues, and suggestions.
Cross-check for duplication or conflicts with existing artifacts.
Present combined findings to the user with actionable fixes ranked by severity.

If changes are needed AND the user approves, proceed to Modify workflow.

---

## Modify workflow (for changing existing artifacts)

When the user approves changes after a review, or directly requests modifications:

### Step 1: Assess and act

Apply the complexity assessment. If trivial — edit directly in main session,
no subagent. For standard/complex changes, continue to Step 2.

### Step 2: Construct modification spec

Translate the review findings (or user request) into a create-mode spec:
- `ARTIFACT_TYPES`: the type(s) being modified
- `REQUIREMENT`: the specific changes to make (reference review issues by number)
- `ADHERENCE`: carry over from existing artifact, or specify new level if escalating
- `SCOPE`: carry over from existing artifact (project / user / local)
- `CONTEXT`: include the review report so the writer has full context

### Step 3: Delegate to artifact-writer

Spawn the `artifact-writer` subagent with the spec from Step 2.
Follow the same verification as Creation workflow Phase 4.

---

## Creation workflow

### Phase 1: Clarify requirements (YOU do this — in main session)

Ask the user to clarify (skip questions with obvious answers). Getting clear
answers upfront prevents rework — an ambiguous requirement sent to a subagent
wastes ~20k tokens and produces wrong artifacts that need re-doing:

1. **What** behavior or knowledge needs to be added?
2. **How often** is it needed? (every session / specific files / on demand / always enforced)
3. **What if ignored?** (annoying vs dangerous — determines advisory vs deterministic)
4. **Scope**: one project or multiple?
5. **Existing context**: any related artifacts already in place?

Do NOT proceed until you have clear answers for at least questions 1-3.

### Phase 2: Route to artifact type(s) (YOU do this)

Apply the decision matrix (primary + companions). Tell the user:
- Which artifact type(s) you chose and WHY
- If combining types, explain the combo pattern
- If adherence is critical, recommend Hook + advisory pair

Get user confirmation before proceeding.

### Phase 3: Delegate to artifact-writer (SUBAGENT does this)

Spawn the `artifact-writer` subagent with this specification format:

```
ARTIFACT_TYPES: <comma-separated list>
REQUIREMENT: <what behavior/knowledge needs to be added>
ADHERENCE: <advisory ~70% | deterministic 100%>
SCOPE: <project | user | local>
CONTEXT: <relevant context from conversation, existing patterns, user preferences>
```

Example spec for a hook + companion skill:
```
ARTIFACT_TYPES: Hook, Skill
REQUIREMENT: Block git push to main with exit 2; create companion skill
  explaining branch workflow and why direct pushes are blocked.
ADHERENCE: deterministic (hook) + advisory (skill)
SCOPE: project
CONTEXT: Team has accidentally pushed to main twice this month. Need
  PreToolUse hook on Bash matching "git push" to check branch name,
  plus a skill with git-workflow knowledge so Claude understands why.
```

The subagent will:
1. Read the relevant authoring guides from `references/`
2. Check for conflicts with existing artifacts
3. Create the artifacts
4. Return a self-check (frontmatter validity, paths, scope)

### Phase 4: Verify (YOU do this — in main session)

Verify the subagent's output — this is the orchestrator's responsibility,
because the writer sees only its own artifacts while you see the full ecosystem:

- [ ] No duplicate instructions across CLAUDE.md, rules, and skills
- [ ] No conflicting instructions between new and existing artifacts
- [ ] Critical rules have hook backstop (if adherence = deterministic)
- [ ] Size limits respected:
  - CLAUDE.md: < 200 lines
  - Skills: < 500 lines
  - Rules: concise, one topic per file
  - Subagents: self-contained system prompt
- [ ] Correct scope applied (project / user / local)
- [ ] Artifacts follow existing project conventions

Report the results to the user with a summary of what was created.

## Error handling

- If a subagent returns an error or empty output: report the specific failure
  to the user, do not retry automatically. Common causes: reference guide not
  found, malformed spec, file permission issues.
- If the subagent's self-check reports issues: fix in the main session if
  trivial, or re-spawn with corrected spec if the issue is in the requirement.
- If cross-artifact verification (Phase 4) finds conflicts: resolve by editing
  the new artifact to align with existing ones, or propose that the existing
  artifact should change.

## Context budget reference

| Artifact | Context cost | Loaded when |
|----------|-------------|-------------|
| CLAUDE.md (root) | HIGH | Every request |
| CLAUDE.md (subdir) | LOW | Lazy — when agent touches subdir files |
| Rule (unconditional) | HIGH | Session start |
| Rule (conditional) | LOW | File match |
| Skill (description) | LOW | Session start |
| Skill (content) | MEDIUM | On invocation |
| Subagent | ZERO (main) | Isolated |
| Hook | ZERO | Event fire |
| MCP (tool defs) | MEDIUM | Session start |

## Adherence spectrum

```
100% — Hooks (deterministic, exit code 2 blocks action)
~70% — CLAUDE.md / Rules / Skills (advisory)
  0% — Nothing configured
```

If the user says "Claude keeps ignoring this" → escalate to hook
(see Task type detection).

## Anti-patterns to flag

- Everything in CLAUDE.md (bloated, low adherence)
- Same instruction in multiple places (duplication, conflicts)
- "NEVER do X" in CLAUDE.md expecting 100% (use hook)
- MCP without Skill (tool without domain knowledge)
- Subagent for trivial tasks (20k token overhead)
