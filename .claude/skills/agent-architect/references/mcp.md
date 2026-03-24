# MCP Configuration Guide

## What it is

MCP (Model Context Protocol) connects Claude Code to external services: databases,
Jira, Slack, Google Drive, custom APIs. The only artifact that connects Claude
to the world beyond filesystem and terminal.

MCP gives tools (capabilities). Skills teach how to use them. Always pair them —
a tool without domain knowledge is an anti-pattern.

## Context cost

Tool descriptions are loaded at session start and included in **every request**.
Multiple servers = significant context before any work begins.

**Tool search** (enabled by default) defers MCP tools when they exceed 10% of
context window, loading on demand via ToolSearch. Control via `ENABLE_TOOL_SEARCH`:
`true` (always), `auto` (at 10%, default), `auto:<N>` (custom %), `false` (all upfront).
Requires Sonnet 4+ or Opus 4+ — Haiku does not support tool search.

**Output limits**: warning at 10,000 tokens per tool output. Default max: 25,000 tokens.
Configurable via `MAX_MCP_OUTPUT_TOKENS`.

**Reliability**: MCP connections can fail silently mid-session — tools disappear
without warning. Run `/mcp` to check per-server token costs. Run `/context` for
overall context usage.

## Transports

```bash
# stdio - local process, stdin/stdout (most common for local servers)
claude mcp add --transport stdio my-server -- npx -y @some/mcp-package

# http - remote server (RECOMMENDED for remote servers)
claude mcp add --transport http stripe https://mcp.stripe.com

# sse - Server-Sent Events (DEPRECATED — use http instead)
# ws - WebSocket
```

## Three scopes

| Scope | Storage | Shared | Default |
|-------|---------|--------|---------|
| Local | `~/.claude.json` (per project path) | No | YES |
| Project | `.mcp.json` in project root | Git (team) | No |
| User | Global config | No (all projects) | No |

Priority: **local > project > user** (personal overrides shared).

**Naming caveat**: MCP "local scope" stores in `~/.claude.json` (home directory).
This differs from "local settings" which use `.claude/settings.local.json` (project
directory). Don't confuse them.

```bash
claude mcp add --transport http --scope project my-db https://...
claude mcp add --transport http --scope user my-service https://...
```

## .mcp.json (project scope)

```json
{
  "mcpServers": {
    "api-server": {
      "type": "http",
      "url": "${API_BASE_URL:-https://api.example.com}/mcp",
      "headers": {
        "Authorization": "Bearer ${API_KEY}"
      }
    },
    "local-db": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@company/db-mcp-server"],
      "env": {
        "DB_CONNECTION": "${DATABASE_URL}"
      }
    }
  }
}
```

### Config fields

| Field | Transport | Description |
|-------|-----------|-------------|
| `type` | both | `"http"`, `"stdio"`, `"sse"` (deprecated), `"ws"` |
| `url` | http/sse/ws | Server URL |
| `headers` | http/sse | HTTP headers (auth tokens, etc.) |
| `command` | stdio | Executable to run |
| `args` | stdio | Command arguments array |
| `env` | stdio | Environment variables for the process |
| `cwd` | stdio | Working directory for the process |

### Environment variables

- `${VAR}` — expands to value (config parse fails if unset, no default)
- `${VAR:-default}` — expands to VAR or default

Works in: command, args, url, headers, env, cwd.

## CLI management

```bash
claude mcp add --transport stdio myserver -- npx server    # Add stdio server
claude mcp add --transport http stripe https://mcp.stripe.com  # Add http server
claude mcp add-json weather '{"type":"http","url":"..."}'  # Add via JSON
claude mcp add-from-claude-desktop                         # Import from Desktop
claude mcp list                                            # List all servers
claude mcp get github                                      # Server details
claude mcp remove github                                   # Remove server
```

In session: `/mcp` (status, token costs, OAuth auth), `/permissions` (allow domains).

Options (`--transport`, `--env`, `--scope`, `--header`) go BEFORE server name.
`--` separates name from command/args for stdio.

OAuth: `--client-id`, `--client-secret`, `--callback-port` for remote OAuth 2.0 servers.

## MCP in subagents

Two approaches in subagent frontmatter `mcpServers`:

```yaml
# Inline: scoped to subagent, starts/stops with it
mcpServers:
  - playwright:
      type: stdio
      command: npx
      args: ["-y", "@playwright/mcp@latest"]

# String ref: shares parent session's connection
mcpServers:
  - github
```

**Context isolation pattern**: define MCP inline in a subagent to keep its tool
definitions out of the main conversation context entirely. The subagent gets
the tools; the parent does not pay the context cost.

**Plugin agents restriction**: for security, plugin-shipped agents do NOT support
`mcpServers` (silently ignored). Only project/user agents can use MCP.

## MCP in plugins

`.mcp.json` at plugin root or inline in `plugin.json`. Starts automatically
when plugin enabled. Use `${CLAUDE_PLUGIN_ROOT}` for paths,
`${CLAUDE_PLUGIN_DATA}` for data directory.

## Enterprise: Managed MCP

### Option 1: Exclusive control (managed-mcp.json)

Deployed to system directory. Takes exclusive control — users cannot add/modify servers.
- macOS: `/Library/Application Support/ClaudeCode/managed-mcp.json`
- Linux/WSL: `/etc/claude-code/managed-mcp.json`

### Option 2: Allowlists/Denylists

Users can add servers within policy limits. `allowedMcpServers` / `deniedMcpServers`
in managed settings. Filters by: serverName, serverCommand, serverUrl (wildcards).

## Interactions

- **+ Skills**: MCP = tool, Skill = knowledge. Without skill, Claude has tool
  but lacks project context. Companion skill should describe: data model,
  query patterns, when/how to use the tool, gotchas.
- **+ Subagents**: inline MCP scoped to subagent lifecycle (context isolation),
  or string refs share parent connection.
- **+ Hooks**: PreToolUse matcher `mcp__servername__toolname` for audit/blocking.
- **+ Permissions**: `MCP(servername__toolname)` in settings.json allow/deny rules.
- **+ CLAUDE.md**: mention available servers briefly, detailed usage in skills.

## Limits

| Limit | Value |
|-------|-------|
| Output per tool call | 25,000 tokens max (warning at 10,000) |
| Tool search threshold | 10% of context window (auto-defer) |
| Tool search model support | Sonnet 4+, Opus 4+ (not Haiku) |
| Startup timeout | Default varies; set `MCP_TIMEOUT=<ms>` |
| Env var expansion | Fails if required var unset with no default |
| Plugin agent MCP | Not supported (silently ignored) |

## Configuration checklist

When configuring MCP for a project, verify each item:

1. [ ] **Need confirmed**: service is external (not filesystem/git/search — Claude has those built in)
2. [ ] **Transport**: http for remote (recommended), stdio for local processes. NOT sse (deprecated)
3. [ ] **Scope**: project (`.mcp.json`, team-shared) for team servers; local for personal/dev
4. [ ] **Secrets**: API keys use `${VAR}` expansion, not hardcoded. All required vars documented
5. [ ] **Companion skill**: created for every nontrivial server (data model, patterns, when to use)
6. [ ] **Permissions**: `MCP(servername__toolname)` rules in settings.json if needed
7. [ ] **Context cost**: checked via `/mcp` — consider inline-in-subagent pattern if heavy
8. [ ] **No duplication**: not replicating a capability Claude already has via built-in tools
9. [ ] **Windows**: stdio servers with npx wrapped in `cmd /c` (not WSL)

## Common anti-patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| MCP without companion skill | Claude has tool but no domain knowledge — misuses it | Create skill describing data model, patterns, when/how |
| SSE transport for new servers | Deprecated | Use http transport |
| Hardcoded secrets in `.mcp.json` | Committed to git | Use `${VAR}` expansion, document required vars |
| Duplicating built-in capabilities | Wastes context on tools Claude already has | Remove server; use built-in filesystem/git/search |
| Heavy MCP in main session | Tool descriptions consume context every request | Move to inline-in-subagent for context isolation |
| Missing env var defaults | Config parse fails for team members without the var set | Add `${VAR:-default}` or document required vars |
| MCP in plugin agents | Silently ignored — tools never appear | Use project/user agents instead |
