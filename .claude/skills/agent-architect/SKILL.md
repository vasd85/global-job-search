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

# System Architect

You design artifact architectures for Claude Code projects. Your job is to
figure out which artifact types solve the user's problem, then create them
following the authoring guides in `references/`.

ultrathink

## Core principle

Every instruction has exactly one best home. Putting it in the wrong place
either wastes context tokens (too broad) or fails silently (too narrow).
Your job is to route each instruction to the right artifact type.

## Quick decision matrix

Ask these questions in order. Stop at the first YES.

| # | Question | YES -> artifact | Reference |
|---|----------|-----------------|-----------|
| 1 | Must this execute 100% of the time, no exceptions? | **Hook** | references/hooks.md |
| 2 | Does this need an external service (DB, Jira, Slack, API)? | **MCP server** (+ Skill to teach usage) | references/mcp.md |
| 3 | Should this run in isolated context with its own tools/model? | **Subagent** | references/subagents.md |
| 4 | Is this needed only when working with specific files/dirs? | **Rule** with `paths:` | references/rules.md |
| 5 | Is this needed every session but is a standalone topic? | **Rule** without `paths:` | references/rules.md |
| 6 | Is this needed every session and is core project context? | **CLAUDE.md** | references/claudemd.md |
| 7 | Is this needed sometimes, on demand or by context match? | **Skill** | references/skills.md |
| 8 | Should this be shared across projects/teams? | **Plugin** (wraps other artifacts) | references/plugins.md |

When multiple artifacts are needed, combine them. Common combos:
- MCP server + Skill (tool + knowledge of how to use it)
- Skill + Hook (advisory guide + deterministic guard)
- Subagent + Skills (isolated executor + injected knowledge)
- CLAUDE.md + Rules (core context + file-scoped details)

## Workflow

### Step 1: Understand the requirement

Clarify with the user:
- What behavior or knowledge needs to be added?
- How often is it needed? (every session / specific files / on demand / always enforced)
- What happens if the agent ignores it? (annoying vs dangerous)
- Is this for one project or multiple?

### Step 2: Route to artifact type(s)

Use the decision matrix above. If unsure between two types, consider:
- **Adherence requirement**: ~70% is OK -> CLAUDE.md/rules/skills. Must be 100% -> hook.
- **Context cost**: High (always loaded) -> CLAUDE.md, rules. Low (on demand) -> skills. Zero -> hooks (unless they return output).
- **Isolation need**: Shared context -> skill (inline). Own context -> subagent or skill with `context: fork`.

### Step 3: Read the authoring guide

Before creating any artifact, read the relevant reference file:

- `references/claudemd.md` - Structure, limits, @imports, progressive disclosure
- `references/rules.md` - Conditional/unconditional rules, glob patterns, organization
- `references/skills.md` - Frontmatter, invocation control, progressive disclosure, $ARGUMENTS
- `references/subagents.md` - Frontmatter, tool control, memory, isolation, system prompts
- `references/hooks.md` - Event types, stdin/stdout/exit codes, command/prompt/agent hooks
- `references/mcp.md` - Transports, scopes, .mcp.json, env vars, enterprise managed MCP
- `references/plugins.md` - Plugin structure, manifest, namespace, marketplaces, conversion

Read the FULL reference before writing. Do not rely on memory.

### Step 4: Create the artifacts

Follow the authoring guide from the reference file. Key principles:
- Be specific and verifiable in instructions ("Use 2-space indentation" not "Format code properly")
- Use progressive disclosure (essential info up front, details in separate files)
- Test the artifact after creation
- Validate YAML frontmatter syntax

### Step 5: Verify the architecture

After creating artifacts, check:
- No duplicate instructions across CLAUDE.md, rules, and skills
- No conflicting instructions between artifacts
- Critical rules have hooks as backstop, not just advisory text
- Context budget is reasonable (CLAUDE.md under 200 lines, skills under 500 lines)
- Each artifact is at the right scope (project vs user vs local)

## Context budget guidelines

| Artifact | Context cost | When loaded |
|----------|-------------|-------------|
| CLAUDE.md (root) | HIGH - every token, every session | Session start |
| CLAUDE.md (subdir) | MEDIUM - loaded lazily | When agent touches subdir files |
| Rule (unconditional) | HIGH - same as CLAUDE.md | Session start |
| Rule (conditional) | LOW - loaded on file match | When agent reads matching files |
| Skill (description) | LOW - ~2% of context window shared by all skills | Session start |
| Skill (full content) | MEDIUM - on activation | When triggered or invoked |
| Subagent | ZERO for main session | Runs in isolated context |
| Hook | ZERO (unless returns output) | Fires on event |
| MCP (tool descriptions) | MEDIUM - auto-deferred if >10% of context | Session start |

## Adherence spectrum

```
100% ---|--- Hooks (deterministic, exit code 2 blocks action)
        |
 ~70% --|--- CLAUDE.md / Rules / Skills (advisory, LLM follows most of the time)
        |
   0% --|--- Nothing configured (Claude uses defaults)
```

If the user says "Claude keeps ignoring this rule" - the answer is almost always
to convert from advisory (CLAUDE.md/rule/skill) to deterministic (hook).

## File structure template

```
project/
  CLAUDE.md                          # Core context (< 200 lines)
  .claude/
    settings.json                    # Hooks, permissions
    settings.local.json              # Local overrides (not in git)
    rules/
      *.md                           # Unconditional and conditional rules
    skills/
      <name>/
        SKILL.md                     # On-demand knowledge/workflow
        references/                  # Supporting files
        scripts/                     # Executable utilities
    agents/
      <name>.md                      # Subagent definitions
    hooks/
      *.sh                           # Hook scripts
    .mcp.json                        # MCP server configs
```

Global (all projects):
```
~/.claude/
  CLAUDE.md                          # Personal global instructions
  settings.json                      # Global hooks
  skills/<name>/SKILL.md             # Global skills
  agents/<name>.md                   # Global subagents
  rules/*.md                         # Personal rules
  .mcp.json                          # Global MCP servers
```

## Common patterns

### Pattern: Advisory + Guardrail
Put the instruction in CLAUDE.md or a rule for normal adherence.
Add a PreToolUse hook for the critical subset that must be enforced 100%.
Example: "Don't edit .env files" in CLAUDE.md + hook that blocks Write|Edit to .env.

### Pattern: MCP + Skill
MCP server gives Claude the tool (DB connection, Jira API).
Skill teaches Claude your data model, query patterns, conventions.
Without the skill, Claude has the tool but lacks project-specific context.

### Pattern: Subagent + Skills
Subagent runs in isolation with its own context.
`skills:` field in frontmatter injects skill content into the subagent.
Built-in agents (Explore, Plan) do NOT get your skills - only custom subagents.

### Pattern: CLAUDE.md + Progressive Disclosure
Core commands and conventions in CLAUDE.md.
Detailed docs referenced with "Read when:" triggers (not @imported).
Agent reads detail files only when the task requires them.

### Pattern: Monorepo Layering
Root CLAUDE.md: shared conventions, build commands, project map.
Subdir CLAUDE.md: service-specific context (loaded lazily).
Conditional rules: file-scoped standards (frontend, backend, DB).

## Anti-patterns

- **Everything in CLAUDE.md**: Bloated context, low adherence, no modularity.
- **Duplicating instructions**: Same rule in CLAUDE.md AND a rule file AND a skill. Wastes tokens, creates conflicts.
- **Using CLAUDE.md for enforcement**: "NEVER do X" in CLAUDE.md is ~70% effective. Use a hook.
- **Too many skills**: Descriptions compete for 2% context budget. Consolidate related knowledge.
- **MCP without Skill**: Claude has the tool but not the domain knowledge to use it well.
- **Subagent for everything**: 20k token overhead per spawn. Use for genuine isolation needs.
- **@importing everything**: @imports load at startup like CLAUDE.md. They organize, not reduce, context.
