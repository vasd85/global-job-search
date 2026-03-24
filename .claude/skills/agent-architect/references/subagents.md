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
- Built-in Task/Explore sufficient (reserve custom subagents for security, cost,
  consistency, or memory needs — routine work rarely needs custom subagents)

## Built-in subagents

- **Explore** - Haiku model, read-only tools, codebase search/analysis
- **Plan** - inherits model, read-only tools, plan mode research
- **general-purpose** - inherits model, all tools, multi-step tasks
- Other helpers: Bash (inherits), statusline-setup (Sonnet), Claude Code Guide (Haiku)

## Locations and priority

| Level | Path | Priority (same name) |
|-------|------|---------------------|
| Managed | Enterprise settings | Highest |
| CLI flag | `--agents '{...}'` | High |
| Project | `.claude/agents/<name>.md` | Medium |
| User | `~/.claude/agents/<name>.md` | Low |
| Plugin | `<plugin>/agents/<name>.md` | Lowest |

Loaded at session start. Create via `/agents` or manually (restart needed if manual).
CLI: `claude agents` to list all configured subagents.

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
name: code-reviewer                  # Unique identifier
description: Reviews code for...     # When Claude should delegate
tools: Read, Glob, Grep              # Allowlist (only these tools)
disallowedTools: Write, Edit         # Denylist (everything except these)
model: sonnet                        # sonnet | opus | haiku | inherit | full ID
effort: max                          # low | medium | high | max (Opus 4.6 only)
permissionMode: plan                 # default | acceptEdits | dontAsk | bypassPermissions | plan
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
skills:                              # Injected into subagent context at startup
  - api-conventions
  - error-handling-patterns
memory: user                         # Persistent memory (user | project | local)
isolation: worktree                  # Git worktree isolation
background: true                     # Always run as background task
---
```

After frontmatter: system prompt in markdown.

## Tool control

- **Default**: inherits all tools from main conversation including MCP
- **Allowlist** (`tools: Read, Grep, Glob`): only listed tools
- **Denylist** (`disallowedTools: Write, Edit`): everything except listed
- **Ordering**: `disallowedTools` applied first, then `tools` resolved against remaining pool
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

Permission control: `Agent(AgentName)` rules in settings.json restrict which subagents
Claude can spawn. Has no effect inside subagent definitions (subagents cannot nest).

## Model selection

- `haiku` - cheap tasks: search, grep, simple analysis
- `sonnet` - balanced: code review, data analysis
- `opus` - complex: security audit, architecture review
- `inherit` (default) - same as main conversation

## MCP servers

- **String reference** (`- github`): shares parent session's connection
- **Inline definition**: connected when subagent starts, disconnected when it finishes;
  avoids polluting parent conversation context

Use inline definitions for MCP servers only needed by the subagent. Use string references
for servers already configured in the parent session.

## Hooks

### In subagent frontmatter

Active only while the subagent runs; cleaned up when it finishes.
Supported events: `PreToolUse`, `PostToolUse`, `Stop` (auto-converted to `SubagentStop`).

```yaml
hooks:
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "./scripts/run-linter.sh"
```

### In settings.json (parent session)

`SubagentStart` and `SubagentStop` events fire when subagents start/stop in the main session.

## Persistent memory

```yaml
---
memory: user
---
Update your agent memory with patterns, conventions, and recurring issues.
```

Scopes: `user` (all projects, recommended), `project` (one codebase), `local` (one machine + project).

Memory paths:
- `user`: `~/.claude/agent-memory/<name>/`
- `project`: `.claude/agent-memory/<name>/`
- `local`: `.claude/agent-memory-local/<name>/`

Auto-includes first 200 lines of MEMORY.md. Read/Write/Edit auto-enabled for memory files.

## Skills in subagents

```yaml
skills:
  - api-conventions
  - error-handling-patterns
```

Full skill content injected at startup (not just available for invocation).
Subagents do NOT inherit skills automatically — list them explicitly.
Built-in agents (Explore, Plan, Verify) and Task tool have NO access to custom skills.

## Foreground vs background

- **Foreground** (default): blocks main conversation; permission prompts pass through
- **Background** (`background: true`): runs concurrently; only pre-approved permissions
  work, unapproved auto-denied; `AskUserQuestion` calls fail but subagent continues

## Writing system prompts

Subagent does NOT get Claude Code's full system prompt — only its own markdown + basic env data.
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
If changes exist, Claude asks whether to keep or discard.
Add `.claude/worktrees/` to `.gitignore`.

For non-git VCS: configure `WorktreeCreate` and `WorktreeRemove` hooks for custom logic.

## Plugin subagent restrictions

Plugin-sourced subagents ignore `hooks`, `mcpServers`, and `permissionMode` fields
for security. If these features are needed, move the subagent to project or user level.

## Limitations

- **No nesting**: subagents cannot spawn other subagents
- **Fresh context**: each invocation starts from scratch, no parent history
- **Single channel**: only the Agent tool prompt string passes from parent to subagent
- **Overhead**: ~20k tokens for context loading before real work
- **Parallelism**: max 10 concurrent, additional queued
- **Resume**: ask Claude to resume (not restart) to keep full history

## Interactions with other artifacts

- **vs Skills**: Skills add knowledge inline. Subagents run in isolation with own tools.
  Inject skills into subagents via `skills:` field for domain knowledge.
- **vs CLAUDE.md**: Subagents load CLAUDE.md automatically. Don't duplicate CLAUDE.md
  content in subagent system prompts.
- **vs Rules**: Subagents do NOT inherit rules. Include needed rules in subagent prompt
  or inject via `skills:` field.
- **vs Hooks**: Subagent frontmatter hooks scoped to subagent lifetime. Parent session
  hooks use `SubagentStart`/`SubagentStop` events.
- **vs MCP**: Use string references for parent's servers, inline defs for subagent-only.

## Limits

- Names: unique identifier, used for delegation matching
- Frontmatter: `---` on line 1, no blank lines before it, spaces not tabs
- System prompt: self-contained markdown (no Claude Code system prompt inheritance)
- Advisory adherence (approximate) for delegation matching — Claude decides when to delegate
- Max 10 concurrent subagents; additional queued in batches

## Creation checklist

When creating a new subagent, verify each item:

1. [ ] **System prompt**: self-contained — defines role, workflow, output format, constraints
2. [ ] **Description**: specific keywords + when Claude should delegate; differentiated
       from existing subagents
3. [ ] **Tools**: correctly restricted — allowlist OR denylist (`disallowedTools` applied first)
4. [ ] **Skills**: explicitly listed if domain knowledge needed (not inherited from parent)
5. [ ] **Model**: appropriate for task complexity (haiku=cheap, sonnet=balanced, opus=complex)
6. [ ] **Memory**: scope set if persistent learning needed (user=recommended default)
7. [ ] **No nesting**: prompt doesn't instruct spawning sub-subagents
8. [ ] **Plugin safety**: if plugin-sourced, no hooks/mcpServers/permissionMode (silently ignored)
9. [ ] **Isolation**: worktree set if parallel write operations needed; `.claude/worktrees/` in .gitignore
10. [ ] **Hooks**: if defined, supported events only (PreToolUse, PostToolUse, Stop)

## Common anti-patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Subagent for trivial task | 20k token overhead wasted | Do task inline in main session |
| Assuming parent context | Subagent starts fresh, no parent history | Pass all needed data in Agent tool prompt |
| Missing skills field | Subagent lacks domain knowledge | Add explicit `skills:` with relevant skills |
| Plugin subagent with restricted fields | hooks/mcpServers/permissionMode silently ignored | Move to project-level `.claude/agents/` |
| Vague description | Claude can't match tasks to delegate | Specific keywords + "use when..." triggers |
| Expecting nesting | Subagents can't spawn sub-subagents | Chain from main conversation instead |
| Duplicating CLAUDE.md in prompt | CLAUDE.md loads automatically in subagents | Reference CLAUDE.md, don't copy content |
| Rigid Lead-Specialist workflow | Gatekeeps context from main agent | Consider built-in Task/Explore for routine work |
