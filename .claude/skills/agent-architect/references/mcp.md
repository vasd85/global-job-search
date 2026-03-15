# MCP Configuration Guide

## What it is

MCP (Model Context Protocol) connects Claude Code to external services: databases,
Jira, Slack, Google Drive, custom APIs. The only artifact that connects Claude
to the world beyond filesystem and terminal.

MCP gives tools (capabilities). Skills teach how to use them. Pair them.

## Context cost

Tool descriptions load with each request. Multiple servers = significant context.
When descriptions exceed 10% of context window, auto-deferred via MCPSearch tool.
Output warning at 10,000+ tokens (configurable via `MAX_MCP_OUTPUT_TOKENS`).
Monitor with `/context`.

## Transports

```bash
# stdio - local process, stdin/stdout (most common)
claude mcp add --transport stdio my-server -- npx -y @some/mcp-package

# http - remote server
claude mcp add --transport http stripe https://mcp.stripe.com

# sse - Server-Sent Events
# ws - WebSocket
```

## Three scopes

| Scope | Storage | Shared | Default |
|-------|---------|--------|---------|
| Local | `~/.claude.json` (per project path) | No | YES |
| Project | `.mcp.json` in project root | Git (team) | No |
| User | Global config | No (all projects) | No |

Priority: **local > project > user** (personal overrides shared).

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

### Environment variables

- `${VAR}` - expands to value (fails if unset, no default)
- `${VAR:-default}` - expands to VAR or default

Works in: command, args, url, headers, env, cwd.

## CLI management

```bash
claude mcp add --transport stdio myserver -- npx server
claude mcp list
claude mcp get github
claude mcp remove github
```

In session: `/mcp` (status, OAuth auth), `/permissions` (allow domains).

Options (`--transport`, `--env`, `--scope`, `--header`) go BEFORE server name.
`--` separates name from command/args.

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

## MCP in plugins

`.mcp.json` at plugin root. Starts automatically when plugin enabled.
Use `${CLAUDE_PLUGIN_ROOT}` for paths.

## Enterprise: Managed MCP

### Option 1: Exclusive control (managed-mcp.json)

Deployed to system directory. Takes exclusive control - users cannot add/modify servers.
- macOS: `/Library/Application Support/ClaudeCode/managed-mcp.json`
- Linux/WSL: `/etc/claude-code/managed-mcp.json`

### Option 2: Allowlists/Denylists

Users can add servers within policy limits. `allowedMcpServers` / `deniedMcpServers`
in managed settings. Filters by: serverName, serverCommand, serverUrl (wildcards).

## Interactions

- **+ Skills**: MCP = tool, Skill = knowledge. Without skill, Claude has tool but lacks project context.
- **+ Subagents**: inline MCP scoped to subagent lifecycle, or string refs share parent connection.
- **+ Hooks**: PreToolUse matcher `mcp__servername__toolname` for audit/blocking.
- **+ Permissions**: `MCP(servername__toolname)` in settings.json allow/deny rules.
- **+ CLAUDE.md**: mention available servers briefly, detailed usage instructions in skills.

## Recommendations

- Minimize servers - each adds context cost
- Project scope for team servers (.mcp.json in git, env vars for secrets)
- Local scope for personal/dev servers
- Pair every nontrivial MCP server with a skill
- Don't duplicate CLI via MCP (Claude already has filesystem, git, search built in)
- Monitor context: `/context`
- Timeout: `MCP_TIMEOUT=10000 claude` for slow servers
- Windows (not WSL): wrap npx with `cmd /c`
