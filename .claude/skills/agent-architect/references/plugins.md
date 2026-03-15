# Plugins Authoring Guide

## What they are

A self-contained directory bundling skills, subagents, hooks, MCP servers, and LSP servers
into one installable unit. Plugins are the packaging and distribution layer on top of
all other artifacts. Each component works by its own type's rules after installation.

## Standalone vs Plugin

| | Standalone (`.claude/`) | Plugin |
|---|---|---|
| Skill names | `/hello` | `/plugin-name:hello` |
| For | Personal, project-specific, experiments | Sharing, versioning, reuse |
| Namespace | No | Yes (prevents conflicts) |

**Start standalone, convert to plugin when ready to share.**

## Directory structure

```
my-plugin/
  .claude-plugin/               # Only plugin.json goes here
    plugin.json                 # Manifest
  commands/                     # Markdown command files
    status.md
  agents/                       # Subagent definitions
    security-reviewer.md
  skills/                       # Skills
    code-review/
      SKILL.md
    pdf-processor/
      SKILL.md
      scripts/
  hooks/                        # Hook config
    hooks.json
  .mcp.json                     # MCP servers
  .lsp.json                     # LSP servers
  settings.json                 # Default settings
  scripts/                      # Utilities for hooks
    format-code.sh
```

CRITICAL: commands/, agents/, skills/, hooks/ go at plugin ROOT, NOT inside `.claude-plugin/`.
Only `plugin.json` goes inside `.claude-plugin/`.

## Manifest (plugin.json)

```json
{
  "name": "my-plugin",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": {
    "name": "Author Name",
    "url": "https://github.com/author"
  },
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],
  "commands": ["./custom/commands/special.md"],
  "agents": "./custom/agents/",
  "skills": "./custom/skills/",
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json",
  "outputStyles": "./styles/",
  "lspServers": "./.lsp.json"
}
```

Manifest is optional. Without it, Claude Code auto-discovers components in default
locations and infers name from directory name.

If present, `name` is the only required field. Used for namespace.
Custom paths supplement defaults, don't replace them.

## Components

### Skills

`skills/` with subdirectories containing SKILL.md. Namespace: `/plugin-name:skill-name`.
Work identically to regular skills, just namespaced.

### Agents

`agents/` with markdown files. Visible in `/agents`, work like any subagent.

### Hooks

`hooks/hooks.json` - same format as settings.json. Use `${CLAUDE_PLUGIN_ROOT}`
for script paths:

```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "${CLAUDE_PLUGIN_ROOT}/scripts/format-code.sh"
      }]
    }]
  }
}
```

`${CLAUDE_PLUGIN_ROOT}` = absolute path to plugin directory. Use in hooks, MCP, scripts.

### MCP servers

`.mcp.json` at plugin root. Auto-start when plugin enabled. Independent of user MCP config.

### LSP servers

`.lsp.json` for code intelligence. Use pre-built LSP plugins for common languages.
Custom only for unsupported languages.

### Default settings

`settings.json` at plugin root. Currently only `agent` key supported.

## Namespace and priorities

### Skills priority

managed > user > project > plugin. Higher level wins on name conflict.

### Subagent priority

managed > CLI flag > project > user > plugin.

### Hooks

Merge from all sources. Plugin hooks fire alongside others.
Enterprise `allowManagedHooksOnly: true` can block plugin hooks.

## Installation

```
/plugin                    # Interactive management menu
```

### Install scopes

- **user** - personal, all projects
- **project** - shared via `.claude/settings.json`
- **local** - per-machine override

`/plugin uninstall` for project scope disables in `.claude/settings.local.json`
(doesn't modify shared settings.json).

### Local development

```bash
claude --plugin-dir ./my-plugin
claude --plugin-dir ./plugin-one --plugin-dir ./plugin-two
```

## Marketplaces

Distribution mechanism. Source types:

```json
// GitHub
{ "source": "github", "repo": "acme-corp/plugins" }

// npm
{ "source": "npm", "package": "@acme-corp/claude-plugins" }

// URL
{ "source": "url", "url": "https://plugins.example.com/marketplace.json" }

// File
{ "source": "file", "path": "/opt/plugins/marketplace.json" }
```

Configure in `extraKnownMarketplaces` in settings.json.
Enterprise: `strictKnownMarketplaces` restricts to managed marketplaces only.

## Converting from standalone

1. Create plugin directory + `.claude-plugin/plugin.json`
2. Copy components:
   ```bash
   mkdir my-plugin && mkdir my-plugin/.claude-plugin
   cp -r .claude/commands my-plugin/
   cp -r .claude/agents my-plugin/
   cp -r .claude/skills my-plugin/
   ```
3. Create `hooks/hooks.json` from settings.json hook config
4. Test each component
5. Remove originals from `.claude/` after verifying

## Debugging

- `claude --debug` or `/debug` - plugin loading details
- `/plugin` - installed plugin status
- `/reload-plugins` - reload after changes
- Check: directories at root (not inside .claude-plugin/)
- Check: valid JSON in plugin.json
- Check: `${CLAUDE_PLUGIN_ROOT}` in hook/script paths
- Check: event names are case-sensitive (`PostToolUse`, not `postToolUse`)

## When to use

**Use plugin when:**
- Sharing across projects or team
- Versioned releases needed
- Distributing via marketplace
- Bundling related components (skill + hook + MCP)

**Don't use plugin when:**
- Personal config for one project
- Experimenting with new skill/hook
- Want short command names (no namespace overhead)
