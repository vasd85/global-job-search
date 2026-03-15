# Hooks Authoring Guide

## What they are

Shell commands, prompts, or agents that execute automatically at lifecycle events.
Deterministic (100% enforcement), unlike CLAUDE.md/rules/skills (~70%).
Zero context cost unless the hook returns output into the conversation.

**Core principle**: hooks for guarantees, everything else for recommendations.

## Four hook types

### command (most common)

Shell command. Deterministic, fast. Available for all events.

```json
{
  "type": "command",
  "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write",
  "timeout": 30
}
```

### http

HTTP request to external service. All events.

### prompt

Single LLM call (Haiku by default). Returns yes/no decision as JSON.
Use when input data alone is enough for the decision. No tool access.

### agent

Subagent with tool access (Read, Grep, Glob, etc.). Multi-step verification.
Default 60s timeout, up to 50 turns. Use when you need to check against
actual codebase state.

**Availability**: command works for ALL events. prompt/agent/http work for:
PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Stop,
SubagentStop, TaskCompleted, UserPromptSubmit.

## Configuration

### Location

- `.claude/settings.json` - project (committed to git)
- `.claude/settings.local.json` - local (not committed)
- `~/.claude/settings.json` - user (all projects)
- Skills/subagents frontmatter (scoped to component lifecycle)

### JSON structure

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "ToolPattern",
        "hooks": [
          {
            "type": "command",
            "command": "your-command",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Matcher

Regex string, case-sensitive. Filters when hook fires:
- PreToolUse/PostToolUse: matches tool name (`Edit|Write`, `Bash`, `mcp__*`)
- SessionStart: matches source (`startup`, `resume`, `clear`, `compact`)
- Notification: matches notification_type (`permission_prompt`, `idle_prompt`)
- `"*"`, `""`, or omitted = matches everything

All matching hooks run in parallel. Identical commands are deduplicated.

## Communication: stdin/stdout/stderr/exit codes

### Input (stdin)

JSON with event-specific data: session_id, transcript_path, cwd, tool_input,
tool_response, prompt, source, etc.

### Exit codes

| Code | Effect |
|------|--------|
| 0 | Action proceeds. stdout added to context (SessionStart, UserPromptSubmit) |
| 2 | **Action blocked.** stderr becomes feedback for Claude to adjust. |
| Other | Action proceeds. stderr logged but not shown to Claude. |

### JSON output (advanced)

Instead of exit 0/2, return JSON to stdout for fine-grained control:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Use rg instead of grep"
  }
}
```

Decisions: `"allow"`, `"deny"`, `"ask"` (escalate to user).
Do NOT mix: JSON is ignored with exit 2.

## Key events

### SessionStart

Source: "startup", "resume", "clear", "compact". stdout -> context.
`CLAUDE_ENV_FILE`: write export statements for persistent env vars in the session.

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "startup",
      "hooks": [{
        "type": "command",
        "command": "echo 'conda activate myenv' >> \"$CLAUDE_ENV_FILE\""
      }]
    }]
  }
}
```

### PreToolUse

Most powerful event. Fires before tool execution. Exit 2 blocks the action.
Matches tool name. Use for: blocking dangerous operations, protecting files,
validating commands.

### PostToolUse

Fires after successful execution. Gets tool_input AND tool_response. Cannot undo.
Use for: auto-formatting, logging, post-processing.

### Stop

Fires when Claude finishes responding. NOT on user interruption.
Use agent type for verification (run tests before accepting completion).

### UserPromptSubmit

Fires when user sends prompt. stdout -> context. Use for: prompt validation,
context injection.

### Other events

- **SessionEnd**: cleanup, logging (cannot block)
- **PermissionRequest**: when Claude asks permission (NOT in -p mode)
- **SubagentStart/SubagentStop**: subagent lifecycle
- **Notification**: Claude needs attention
- **PreCompact/PostCompact**: context compaction
- **InstructionsLoaded**: CLAUDE.md/rules loading (async, no blocking)

## Practical examples

### Auto-format after edit

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write"
      }]
    }]
  }
}
```

### Protect files from editing

Script `.claude/hooks/protect-files.sh`:

```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
PROTECTED_PATTERNS=(".env" "package-lock.json" ".git/")
for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "Blocked: $FILE_PATH matches protected pattern '$pattern'" >&2
    exit 2
  fi
done
exit 0
```

Hook config:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-files.sh"
      }]
    }]
  }
}
```

### Block dangerous bash commands

```bash
#!/bin/bash
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')
if echo "$COMMAND" | grep -q "drop table"; then
  echo "Blocked: dropping tables is not allowed" >&2
  exit 2
fi
exit 0
```

### Test verification before stop (agent hook)

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "agent",
        "prompt": "Verify all unit tests pass. Run the suite and check results.",
        "timeout": 120
      }]
    }]
  }
}
```

### Context injection at startup

```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "startup",
      "hooks": [{
        "type": "command",
        "command": "echo 'Recent commits:' && git log --oneline -5"
      }]
    }]
  }
}
```

## Hooks in skills and subagents

Define hooks in frontmatter. Scoped to component lifetime, cleaned up on finish.
All events supported. In subagents, Stop hooks auto-convert to SubagentStop.

```yaml
---
name: secure-ops
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/security-check.sh"
---
```

## Security

- Direct edits to settings.json require review via `/hooks` menu
- Quote shell variables: `"$VAR"` not `$VAR`
- Block path traversal: check `..` in file paths
- Use absolute paths: `"$CLAUDE_PROJECT_DIR"`
- Skip sensitive files: .env, .git/, keys
- Enterprise: `allowManagedHooksOnly: true` blocks user/project/plugin hooks

## Debugging

- `claude --debug` - hook execution details, matched hooks, exit codes
- `Ctrl+O` - verbose mode for hook messages in transcript
- Check matcher case sensitivity
- PreToolUse fires before action, PostToolUse after
- PermissionRequest does NOT fire in `-p` mode (use PreToolUse instead)
- Stop fires on any response completion, NOT only task completion

## Decision matrix

| Task | Type | Event |
|------|------|-------|
| Auto-format | command | PostToolUse (Edit\|Write) |
| Block file edit | command | PreToolUse (Edit\|Write) |
| Block dangerous bash | command | PreToolUse (Bash) |
| Desktop notification | command | Notification |
| Lint after edit | command | PostToolUse (Edit\|Write) |
| Inject context | command | SessionStart |
| Setup env (nvm, conda) | command | SessionStart |
| Log session end | command | SessionEnd |
| Verify tests before stop | agent | Stop |
| Check code standards | prompt | PreToolUse (Edit\|Write) |
| Audit MCP calls | command | PreToolUse (mcp__*) |
| Validate SQL | command | PreToolUse (Bash) |

## Creation shortcut

Fastest way: `/hooks` interactive menu in Claude Code session.
Or ask Claude: "Write a hook that runs eslint after every file edit".
