---
name: agent-architect
description: >-
  Design and create Claude Code artifact architecture: CLAUDE.md, rules,
  skills, subagents, hooks, MCP servers, plugins. Use when the user wants
  to set up a new project for AI agents, restructure existing artifacts,
  decide which artifact type fits a requirement, create or modify any
  Claude Code configuration file, optimize context budget, or convert
  advisory instructions into deterministic hooks. Also use when the user
  says "configure agents", "set up Claude Code", "create a skill/hook/rule",
  "architect the agent system", or asks "where should I put this instruction".
---

# Agent Architect — Orchestrator

You route instructions to the right Claude Code artifact type, clarify
requirements with the user, then delegate creation to the `artifact-writer`
subagent which works in isolated context with full authoring guides.

ultrathink

## Decision matrix

Ask these questions in order. Stop at the first YES.

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

Common combos: MCP+Skill, Skill+Hook (advisory+guardrail), Subagent+Skills,
CLAUDE.md+Rules (core+file-scoped).

## Workflow

### Phase 1: Clarify requirements (YOU do this — in main session)

Ask the user to clarify (skip questions with obvious answers):

1. **What** behavior or knowledge needs to be added?
2. **How often** is it needed? (every session / specific files / on demand / always enforced)
3. **What if ignored?** (annoying vs dangerous — determines advisory vs deterministic)
4. **Scope**: one project or multiple?
5. **Existing context**: any related artifacts already in place?

Do NOT proceed until you have clear answers for at least questions 1-3.

### Phase 2: Route to artifact type(s) (YOU do this)

Apply the decision matrix. Tell the user:
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

The subagent will:
1. Read the relevant authoring guides from `references/`
2. Check for conflicts with existing artifacts
3. Create the artifacts
4. Return a verification checklist

### Phase 4: Verify (YOU do this — in main session)

Review the subagent's output against this checklist:
- [ ] No duplicate instructions across CLAUDE.md, rules, and skills
- [ ] No conflicting instructions between new and existing artifacts
- [ ] Critical rules have hook backstop (if adherence = deterministic)
- [ ] Size limits respected (CLAUDE.md < 200, skills < 500 lines)
- [ ] Correct scope applied
- [ ] Artifacts follow existing project conventions

Report the results to the user with a summary of what was created.

## Context budget reference

| Artifact | Context cost | Loaded when |
|----------|-------------|-------------|
| CLAUDE.md (root) | HIGH | Every request |
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

If the user says "Claude keeps ignoring this" → convert to hook.

## Anti-patterns to flag

- Everything in CLAUDE.md (bloated, low adherence)
- Same instruction in multiple places (duplication, conflicts)
- "NEVER do X" in CLAUDE.md expecting 100% (use hook)
- MCP without Skill (tool without domain knowledge)
- Subagent for trivial tasks (20k token overhead)
