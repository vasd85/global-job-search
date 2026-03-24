# Hooks Authoring Guide

## What they are

Shell commands, HTTP endpoints, prompts, or agents that execute automatically at lifecycle events.
Deterministic (100% enforcement), unlike CLAUDE.md/rules/skills (~70%).
Zero context cost unless the hook returns output into the conversation.

**Core principle**: hooks for guarantees, everything else for recommendations.

## Four hook types

### command (most common)

Shell command. Deterministic, fast. Available for ALL events.

```json
{
  "type": "command",
  "command": "jq -r '.tool_input.file_path' | xargs npx prettier --write",
  "timeout": 30
}
```

### http

HTTP POST to external service. Same event availability as prompt/agent (8 events).
Uses `headers` with `allowedEnvVars` for env var interpolation:

```json
{
  "type": "http",
  "url": "http://localhost:8080/hooks/validate",
  "headers": { "Authorization": "Bearer $MY_TOKEN" },
  "allowedEnvVars": ["MY_TOKEN"],
  "timeout": 30
}
```

Non-2xx responses and connection failures are non-blocking errors.
To block a tool call, return 2xx with JSON body containing decision fields.

### prompt

Single LLM call (Haiku by default, configurable via `model` field). No tool access.
Returns decision as JSON: `{"ok": true}` or `{"ok": false, "reason": "..."}`.
Use when input data alone is enough for the decision.

### agent

Subagent with tool access (Read, Grep, Glob, etc.). Multi-step verification.
Default 60s timeout, up to 50 turns. Same `"ok"/"reason"` response format as prompt.
Use when you need to check against actual codebase state.

**Type availability by event:**
- All four types: PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest,
  Stop, SubagentStop, TaskCompleted, UserPromptSubmit
- command only: SessionStart, SessionEnd, InstructionsLoaded, Notification,
  SubagentStart, PreCompact, PostCompact, ConfigChange, StopFailure, TeammateIdle,
  WorktreeCreate, WorktreeRemove, Elicitation, ElicitationResult

## Configuration

### Location

| Location | Scope | Shareable |
|----------|-------|-----------|
| `~/.claude/settings.json` | All projects | No |
| `.claude/settings.json` | Single project | Yes (committed) |
| `.claude/settings.local.json` | Single project | No (gitignored) |
| Managed policy settings | Organization-wide | Yes (admin) |
| Plugin `hooks/hooks.json` | When plugin enabled | Yes |
| Skill/subagent frontmatter | While component active | Yes |

To disable all hooks: set `"disableAllHooks": true` in settings.
Enterprise: `allowManagedHooksOnly: true` blocks user/project/plugin hooks.

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

### Handler fields

**Common fields (all types):**

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `type` | yes | — | `"command"`, `"http"`, `"prompt"`, or `"agent"` |
| `timeout` | no | 600 (command), 30 (prompt), 60 (agent) | Seconds before canceling |
| `statusMessage` | no | — | Custom spinner message while hook runs |
| `once` | no | false | Run only once per session then removed (skills frontmatter only) |

**Command-specific:** `command` (required), `async` (bool — run in background without blocking)
**HTTP-specific:** `url` (required), `headers` (object), `allowedEnvVars` (array — only listed vars resolved)
**Prompt/Agent-specific:** `prompt` (required; use `$ARGUMENTS` as placeholder for hook input JSON), `model` (optional override)

All matching hooks run in parallel. Identical handlers are deduplicated automatically.

### Matcher

Regex string, case-sensitive. `"*"`, `""`, or omitted = matches everything.

| Event | Matches on | Example values |
|-------|-----------|----------------|
| PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest | tool name | `Bash`, `Edit\|Write`, `mcp__.*` |
| SessionStart | session source | `startup`, `resume`, `clear`, `compact` |
| SessionEnd | exit reason | `clear`, `resume`, `logout`, `prompt_input_exit`, `other` |
| Notification | notification type | `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` |
| SubagentStart, SubagentStop | agent type | `Explore`, `Plan`, custom agent names |
| PreCompact, PostCompact | compaction trigger | `manual`, `auto` |
| ConfigChange | config source | `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills` |
| StopFailure | error type | `rate_limit`, `authentication_failed`, `billing_error`, `server_error`, `unknown` |
| InstructionsLoaded | load reason | `session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact` |
| Elicitation, ElicitationResult | MCP server name | your configured server names |
| UserPromptSubmit, Stop, TeammateIdle, TaskCompleted, WorktreeCreate, WorktreeRemove | **no matcher** | always fires on every occurrence |

**MCP tool naming:** `mcp__<server>__<tool>` (e.g., `mcp__github__search_repositories`).
Use `mcp__memory__.*` to match all tools from a server.

## Communication: stdin/stdout/stderr/exit codes

### Input (stdin)

JSON with common fields: `session_id`, `transcript_path`, `cwd`, `permission_mode`,
`hook_event_name`. Each event adds its own fields (tool_input, tool_response, prompt, source, etc.).

In subagent context, additional fields: `agent_id`, `agent_type`.

### Exit codes

| Code | Effect |
|------|--------|
| 0 | Action proceeds. stdout parsed for JSON. For SessionStart/UserPromptSubmit: stdout → context |
| 2 | **Action blocked.** stderr becomes feedback for Claude. JSON in stdout is IGNORED |
| Other | Action proceeds. stderr logged (visible in `Ctrl+O` verbose mode) |

**Exit code 2 behavior per event:**

| Event | Can block? | What happens on exit 2 |
|-------|-----------|------------------------|
| PreToolUse | Yes | Blocks tool call |
| PermissionRequest | Yes | Denies permission |
| UserPromptSubmit | Yes | Blocks and erases prompt |
| Stop | Yes | Prevents stopping, Claude continues |
| SubagentStop | Yes | Prevents subagent from stopping |
| TeammateIdle | Yes | Teammate continues with stderr feedback |
| TaskCompleted | Yes | Blocks task completion |
| ConfigChange | Yes | Blocks config change (except policy_settings) |
| Elicitation | Yes | Denies the elicitation |
| ElicitationResult | Yes | Blocks response (becomes decline) |
| WorktreeCreate | Yes | Any non-zero exit fails creation |
| PostToolUse, PostToolUseFailure | No | stderr shown to Claude |
| StopFailure | No | Output and exit code ignored |
| Notification, SubagentStart | No | stderr shown to user only |
| SessionStart, SessionEnd | No | stderr shown to user only |
| PreCompact, PostCompact | No | stderr shown to user only |
| WorktreeRemove | No | Logged in debug mode only |
| InstructionsLoaded | No | Exit code ignored |

### JSON output (advanced)

Exit 0 and print JSON to stdout for fine-grained control.
Do NOT mix: JSON is ignored with exit 2. stdout must contain only the JSON object.

**Universal fields (all events):**

| Field | Default | Description |
|-------|---------|-------------|
| `continue` | true | If false, Claude stops entirely (overrides event-specific decisions) |
| `stopReason` | — | Message shown to user when `continue` is false |
| `suppressOutput` | false | Hide stdout from verbose mode |
| `systemMessage` | — | Warning message shown to user |

**Decision control per event:**

| Events | Pattern | Key fields |
|--------|---------|------------|
| PreToolUse | `hookSpecificOutput` | `permissionDecision` (allow/deny/ask), `permissionDecisionReason`, `updatedInput`, `additionalContext` |
| PermissionRequest | `hookSpecificOutput` | `decision.behavior` (allow/deny), `updatedInput`, `updatedPermissions`, `message`, `interrupt` |
| UserPromptSubmit, PostToolUse, PostToolUseFailure, Stop, SubagentStop, ConfigChange | Top-level `decision` | `decision: "block"`, `reason`, `additionalContext` |
| TeammateIdle, TaskCompleted | Exit code 2 or `continue: false` | stderr for feedback, or JSON to stop teammate entirely |
| SessionStart, UserPromptSubmit | `hookSpecificOutput` | `additionalContext` (added to Claude's context) |
| SubagentStart | `hookSpecificOutput` | `additionalContext` (injected into subagent context) |
| WorktreeCreate | stdout path | Print absolute path to created worktree |
| Elicitation, ElicitationResult | `hookSpecificOutput` | `action` (accept/decline/cancel), `content` (form values) |
| Notification, SessionEnd, PreCompact, PostCompact, InstructionsLoaded, StopFailure, WorktreeRemove | None | Side effects only (logging, cleanup) |

**PreToolUse** — deny with reason:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Use rg instead of grep"
  }
}
```

**PermissionRequest** — auto-approve with permission update:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow",
      "updatedPermissions": [
        { "type": "setMode", "mode": "acceptEdits", "destination": "session" }
      ]
    }
  }
}
```

`updatedPermissions` entry types: `addRules`, `replaceRules`, `removeRules`, `setMode`,
`addDirectories`, `removeDirectories`. Destinations: `session`, `localSettings`,
`projectSettings`, `userSettings`.

**Stop/PostToolUse** — block with reason:

```json
{
  "decision": "block",
  "reason": "Tests must pass before proceeding"
}
```

## All events (21 total)

### SessionStart

Source: `startup`, `resume`, `clear`, `compact`. stdout → context. command only.
Input: `source`, `model`, optional `agent_type`.
`CLAUDE_ENV_FILE`: write export statements for persistent env vars (SessionStart only).

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

Most powerful event. Fires before tool execution. Matches tool name.
Input: `tool_name`, `tool_input`, `tool_use_id`.
Can allow, deny, or ask. Can modify input (`updatedInput`) and inject `additionalContext`.

### PostToolUse

Fires after successful execution. Gets `tool_input` AND `tool_response`. Cannot undo.
Use for: auto-formatting, logging, post-processing.
For MCP tools: `updatedMCPToolOutput` replaces tool output.

### PermissionRequest

Fires when permission dialog appears. NOT in `-p` mode (use PreToolUse instead).
Input: `tool_name`, `tool_input`, `permission_suggestions` (always-allow options).
Can allow/deny, modify input (`updatedInput`), apply `updatedPermissions`.

### Stop

Fires when Claude finishes responding. NOT on user interruption. API errors → StopFailure.
Input: `stop_hook_active` (true if already continuing from stop hook — **CHECK THIS to prevent
infinite loops**), `last_assistant_message`.
Use agent type for verification (run tests before accepting completion).

### UserPromptSubmit

Fires when user sends prompt, before processing. stdout → context.
Input: `prompt`. Can block (`decision: "block"`), add `additionalContext`.

### SubagentStart

Fires when subagent spawns. Matcher: agent type name. command only.
Input: `agent_id`, `agent_type`. Can inject `additionalContext` into subagent.

### SubagentStop

Fires when subagent finishes. Matcher: agent type name.
Input: `stop_hook_active`, `agent_id`, `agent_type`, `agent_transcript_path`,
`last_assistant_message`. Same decision control as Stop.

### PostToolUseFailure

Fires when tool execution fails. Matches tool name.
Input: `tool_name`, `tool_input`, `error`, `is_interrupt`. Can add `additionalContext`.

### Notification

Fires when Claude needs attention. Cannot block. command only.
Types: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`.

### StopFailure

Fires instead of Stop when turn ends due to API error. Output and exit code **ignored**.
Matcher: error type (`rate_limit`, `authentication_failed`, `billing_error`,
`invalid_request`, `server_error`, `max_output_tokens`, `unknown`).
For logging/alerting only. command only.

### TeammateIdle

Agent teams: fires when teammate about to go idle. command only.
Exit 2 = teammate continues with stderr feedback.
JSON `{"continue": false, "stopReason": "..."}` = stop teammate entirely.
Input: `teammate_name`, `team_name`.

### TaskCompleted

Fires when task being marked completed (TaskUpdate tool or teammate finishing). command only.
Exit 2 = blocks completion with stderr feedback.
Input: `task_id`, `task_subject`, optional `task_description`, `teammate_name`, `team_name`.

### ConfigChange

Fires when config file changes during session. Can block (except policy_settings). command only.
Matcher: `user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills`.
Input: `source`, optional `file_path`.

### InstructionsLoaded

Fires when CLAUDE.md or rules file loaded. Async, no blocking, exit code ignored. command only.
Matcher: `session_start`, `nested_traversal`, `path_glob_match`, `include`, `compact`.
Input: `file_path`, `memory_type`, `load_reason`, optional `globs`, `trigger_file_path`.

### PreCompact / PostCompact

Before/after context compaction. Matcher: `manual`, `auto`. No blocking. command only.
PreCompact input: `trigger`, `custom_instructions`.
PostCompact input: `trigger`, `compact_summary`.

### SessionEnd

Fires when session terminates. Cannot block. command only.
Matcher: `clear`, `resume`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other`.
Default timeout: 1.5s (override: `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` env var).

### WorktreeCreate / WorktreeRemove

Create: replaces default git worktree behavior. Must print absolute path to stdout.
Non-zero exit fails creation. Input: `name`. command only.
Remove: cleanup counterpart. Input: `worktree_path`. Cannot block. command only.

### Elicitation / ElicitationResult

MCP server user input interception. Matcher: MCP server name. command only.
Elicitation: intercept and respond programmatically (`action`: accept/decline/cancel, `content`).
ElicitationResult: validate/transform user response before sending to MCP server.

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

### Protect files (external script pattern)

Script reads stdin JSON, checks `tool_input.file_path` against protected patterns,
exits 2 with stderr message if matched. Hook config references script via `$CLAUDE_PROJECT_DIR`:

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

### Auto-approve specific permissions

```json
{
  "hooks": {
    "PermissionRequest": [{
      "matcher": "ExitPlanMode",
      "hooks": [{
        "type": "command",
        "command": "echo '{\"hookSpecificOutput\": {\"hookEventName\": \"PermissionRequest\", \"decision\": {\"behavior\": \"allow\"}}}'"
      }]
    }]
  }
}
```

### Audit configuration changes

```json
{
  "hooks": {
    "ConfigChange": [{
      "hooks": [{
        "type": "command",
        "command": "jq -c '{timestamp: now | todate, source: .source, file: .file_path}' >> ~/claude-config-audit.log"
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
          command: "${CLAUDE_SKILL_DIR}/scripts/security-check.sh"
---
```

Use `${CLAUDE_SKILL_DIR}` in skill hooks, `$CLAUDE_PROJECT_DIR` in settings hooks.
Plugin hooks use `${CLAUDE_PLUGIN_ROOT}` for bundled scripts,
`${CLAUDE_PLUGIN_DATA}` for persistent state that survives plugin updates.

## Security

- Settings file edits picked up automatically by file watcher
- `/hooks` menu is **read-only** — to add/modify hooks, edit settings JSON or ask Claude
- Quote shell variables: `"$VAR"` not `$VAR`
- Block path traversal: check `..` in file paths
- Use absolute paths: `"$CLAUDE_PROJECT_DIR"`, `"${CLAUDE_SKILL_DIR}"`
- Skip sensitive files: .env, .git/, keys
- Command hooks execute with full user permissions — test before adding
- Enterprise: `allowManagedHooksOnly: true` blocks user/project/plugin hooks

## Debugging

- `claude --debug` — hook execution details, matched hooks, exit codes
- `Ctrl+O` — verbose mode for hook messages in transcript
- `/hooks` — read-only browser to verify config and check hook source
- Check matcher case sensitivity (regex, case-sensitive)
- PermissionRequest does NOT fire in `-p` mode (use PreToolUse instead)
- Stop fires on any response completion, NOT only task completion
- Stop does NOT fire on user interrupt; API errors fire StopFailure instead
- Prevent infinite Stop loops: check `stop_hook_active` in input, exit 0 if true

## Decision matrix

| Task | Type | Event |
|------|------|-------|
| Auto-format | command | PostToolUse (Edit\|Write) |
| Block file edit | command | PreToolUse (Edit\|Write) |
| Block dangerous bash | command | PreToolUse (Bash) |
| Desktop notification | command | Notification |
| Lint after edit | command | PostToolUse (Edit\|Write) |
| Inject context at start | command | SessionStart (startup) |
| Re-inject after compact | command | SessionStart (compact) |
| Setup env (nvm, conda) | command | SessionStart |
| Log session end | command | SessionEnd |
| Verify tests before stop | agent | Stop |
| Check code standards | prompt | PreToolUse (Edit\|Write) |
| Audit MCP calls | command | PreToolUse (mcp__\*) |
| Validate SQL | command | PreToolUse (Bash) |
| Auto-approve permissions | command | PermissionRequest |
| Audit config changes | command | ConfigChange |
| Quality gate for teammates | command | TeammateIdle |
| Verify task completion | command | TaskCompleted |
| Custom VCS worktree | command | WorktreeCreate + WorktreeRemove |
| Auto-respond MCP elicitation | command | Elicitation |
