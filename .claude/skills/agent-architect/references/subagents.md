# Subagents Authoring Guide

## What they are

Specialized AI assistants running in isolated context with own system prompt, tools,
and permissions. Defined as markdown files with YAML frontmatter. Return only summarized
results - intermediate tool calls stay inside the subagent.

## When to use

- Task generates bulky output irrelevant to main context (tests, logs, docs)
- Need restricted tools or permissions (read-only reviewer)
- Work is self-contained and returns a summary
- Need a different/cheaper model
- Need persistent memory across sessions

## When NOT to use

- Skill is enough (knowledge added inline to current conversation)
- `/btw` is enough (quick question, sees full context, no tools, discarded)
- Task is simple (20k token overhead per spawn)

## Built-in subagents

- **Explore** - read-only, fast codebase search/analysis
- **Plan** - research agent for plan mode
- **general-purpose** - multi-step tasks requiring read + write

## Locations and priority

| Level | Path | Priority (same name) |
|-------|------|---------------------|
| Managed | Enterprise | Highest |
| CLI flag | `--agents '{...}'` | High |
| Project | `.claude/agents/<name>.md` | Medium |
| User | `~/.claude/agents/<name>.md` | Low |
| Plugin | Installed plugins | Lowest |

Loaded at session start. Create via `/agents` or manually (restart needed if manual).

## Frontmatter

### Minimal

```yaml
---
name: code-reviewer
description: Reviews code for quality and best practices
---
You are a code reviewer...
```

### All fields

```yaml
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep              # Allowlist (only these tools)
disallowedTools: Write, Edit         # Denylist (everything except these)
model: sonnet                        # sonnet | opus | haiku | inherit | full ID
permissionMode: plan                 # default | acceptEdits | plan | bypassPermissions
mcpServers:                          # MCP servers for this subagent
  - github                           # String ref: reuse parent session's server
  - playwright:                      # Inline def: scoped to subagent lifecycle
      type: stdio
      command: npx
      args: ["-y", "@playwright/mcp@latest"]
hooks:                               # Active while subagent runs
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/check.sh"
maxTurns: 50                         # Turn limit
skills:                              # Injected into subagent context
  - api-conventions
  - error-handling-patterns
memory: user                         # Persistent memory (user | project | local)
isolation: worktree                  # Git worktree isolation
---
```

After frontmatter: system prompt in markdown.

## Tool control

- **Default**: inherits all tools from main conversation including MCP
- **Allowlist** (`tools: Read, Grep, Glob`): only listed tools
- **Denylist** (`disallowedTools: Write, Edit`): everything except listed
- **Dynamic** (hooks): PreToolUse hooks for fine-grained control

Example - read-only SQL:

```yaml
---
name: db-reader
description: Execute read-only database queries
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---
```

## Model selection

- `haiku` - cheap tasks: search, grep, simple analysis
- `sonnet` - balanced: code review, data analysis
- `opus` - complex: security audit, architecture review
- `inherit` (default) - same as main conversation

## Persistent memory

```yaml
---
memory: user
---
Update your agent memory with patterns, conventions, and recurring issues.
```

Scopes: `user` (all projects, recommended), `project` (one codebase), `local` (one machine + project).

Auto-includes first 200 lines of MEMORY.md. Read/Write/Edit auto-enabled for memory files.

## Skills in subagents

```yaml
skills:
  - api-conventions
  - error-handling-patterns
```

Full skill content injected at startup (not just available for invocation).
Subagents do NOT inherit skills automatically.
Built-in agents (Explore, Plan, Verify) and Task tool have NO access to your skills.

## Writing system prompts

Subagent does NOT get Claude Code's full system prompt - only its own markdown + basic env data.
Make prompts self-contained:

1. Define role and expertise
2. Give clear workflow (numbered steps)
3. Specify output format
4. Add constraints and warnings

### Example: code reviewer

```yaml
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---
You are a code reviewer. When reviewing code:
1. Analyze organization and structure
2. Check error handling completeness
3. Identify security concerns
4. Evaluate test coverage
5. Look for performance issues

For each finding:
- File and line reference
- Severity: critical/major/minor/nit
- Explanation
- Suggested fix
```

### Example: debugger

```yaml
---
name: debugger
description: Debugging specialist for errors, test failures,
  and unexpected behavior.
tools: Read, Edit, Bash, Grep, Glob
---
You are an expert debugger.

When invoked:
1. Capture error and stack trace
2. Identify reproduction steps
3. Isolate failure location
4. Implement minimal fix
5. Verify solution

Provide: root cause, evidence, fix, prevention.
```

## Isolation via worktree

```yaml
isolation: worktree
```

Each subagent gets its own git worktree. Auto-cleaned on completion if no changes.
Add `.claude/worktrees/` to `.gitignore`.

## Limitations

- **No nesting**: subagents cannot spawn other subagents
- **Fresh context**: each invocation starts from scratch, no parent history
- **Single channel**: only the Agent tool prompt string passes from parent to subagent
- **Overhead**: ~20k tokens for context loading before real work
- **Parallelism**: max 10 concurrent, additional queued
- **Resume**: ask Claude to resume (not restart) to keep full history

## Alternative: Master-Clone

Instead of custom subagents, put all context in CLAUDE.md and let the main agent
delegate via built-in Task/Explore. Benefits: no rigid workflow, dynamic orchestration.
Drawbacks: less control over tools, models, permissions.

Custom subagents are justified for: security (restricted tools), cost (cheaper models),
consistency (same config per task type), persistent memory.

For routine work, built-in Task/Explore are often sufficient.
