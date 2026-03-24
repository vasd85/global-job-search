# Plugins Authoring Guide

## What they are

A self-contained directory bundling skills, subagents, hooks, MCP servers, and LSP servers
into one installable unit. Plugins are the packaging and distribution layer on top of
all other artifacts. Each component works by its own type's rules after installation.

**Core principle**: start standalone in `.claude/`, convert to plugin when ready to share.

## Standalone vs Plugin

| | Standalone (`.claude/`) | Plugin |
|---|---|---|
| Skill names | `/hello` | `/plugin-name:hello` |
| For | Personal, project-specific, experiments | Sharing, versioning, reuse |
| Namespace | No | Yes (prevents conflicts) |

## Directory structure

```
my-plugin/
  .claude-plugin/               # Only plugin.json goes here
    plugin.json                 # Manifest (optional)
  skills/                       # Skills (use for new work)
    code-review/
      SKILL.md
    pdf-processor/
      SKILL.md
      scripts/
  commands/                     # Legacy — use skills/ for new skills
    status.md
  agents/                       # Subagent definitions
    security-reviewer.md
  hooks/                        # Hook configs
    hooks.json
    security-hooks.json         # Multiple hook files supported
  .mcp.json                     # MCP servers
  .lsp.json                     # LSP servers
  settings.json                 # Default settings (only `agent` key supported)
  scripts/                      # Utilities for hooks
    format-code.sh
```

CRITICAL: commands/, agents/, skills/, hooks/ go at plugin ROOT, NOT inside `.claude-plugin/`.
Only `plugin.json` goes inside `.claude-plugin/`.

## Manifest (plugin.json)

Optional. Without it, Claude Code auto-discovers components in default locations
and infers name from directory name. If present, `name` is the only required field.

### Complete schema

```json
{
  "name": "my-plugin",
  "version": "1.2.0",
  "description": "Brief plugin description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://github.com/author"
  },
  "homepage": "https://docs.example.com/plugin",
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

### Key rules

- Name used for namespace: plugin `plugin-dev` → skill appears as `/plugin-dev:skill-name`
- Custom paths supplement defaults — they don't replace them
- All custom paths must be relative and start with `./`
- Multiple paths supported as arrays
- Version follows semver. Must bump version for users to see updates (caching)
- `settings.json` at plugin root takes priority over settings in `plugin.json`

## Components

### Skills

`skills/` with subdirectories containing SKILL.md. Namespace: `/plugin-name:skill-name`.
Work identically to standalone skills, just namespaced. `commands/` is legacy — use
`skills/` for new work.

### Agents

`agents/` with markdown files. Visible in `/agents`, work like any subagent.

**Supported frontmatter**: `name`, `description`, `model`, `effort`, `maxTurns`, `tools`,
`disallowedTools`, `skills`, `memory`, `background`, `isolation` (only `"worktree"`).

**NOT supported in plugin agents** (security restriction): `hooks`, `mcpServers`,
`permissionMode`. Use plugin-level hooks/MCP instead.

### Hooks

`hooks/hooks.json` — same format as settings.json. Multiple hook files supported
(e.g., `hooks.json` + `security-hooks.json`). Use `${CLAUDE_PLUGIN_ROOT}` for script paths:

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

All four hook types supported: command, http, prompt, agent.
Event names are case-sensitive: `PostToolUse`, not `postToolUse`.

### MCP servers

`.mcp.json` at plugin root. Auto-start when plugin enabled. Independent of user MCP config.
Use `${CLAUDE_PLUGIN_ROOT}` for paths:

```json
{
  "mcpServers": {
    "plugin-db": {
      "command": "${CLAUDE_PLUGIN_ROOT}/servers/db-server",
      "args": ["--config", "${CLAUDE_PLUGIN_ROOT}/config.json"],
      "env": { "DB_PATH": "${CLAUDE_PLUGIN_ROOT}/data" }
    }
  }
}
```

### LSP servers

`.lsp.json` for code intelligence. Use pre-built LSP plugins for common languages
(TypeScript, Python, Rust). Custom only for unsupported languages.

Required fields: `command` (binary must be in PATH), `extensionToLanguage`
(maps file extensions to language IDs).

Users must install the language server binary separately.

### Default settings

`settings.json` at plugin root. Currently only `agent` key supported.
Activates a plugin agent as main thread — applies its system prompt, tools, model.

```json
{ "agent": "security-reviewer" }
```

## Environment variables

| Variable | Description |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}` | Absolute path to plugin directory. Changes on update — don't write persistent files here |
| `${CLAUDE_PLUGIN_DATA}` | Persistent directory (`~/.claude/plugins/data/{id}/`). Survives updates. Auto-created on first reference. Deleted on uninstall from last scope (`--keep-data` preserves it) |

Both are substituted inline in skill content, agent content, hook commands, MCP/LSP configs.
Also exported as env vars to hook processes and MCP/LSP subprocesses.

### Persistent data pattern

Use `${CLAUDE_PLUGIN_DATA}` for installed dependencies, caches, generated files.
Compare bundled manifest against stored copy to detect when updates change dependencies:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "diff -q \"${CLAUDE_PLUGIN_ROOT}/package.json\" \"${CLAUDE_PLUGIN_DATA}/package.json\" >/dev/null 2>&1 || (cd \"${CLAUDE_PLUGIN_DATA}\" && cp \"${CLAUDE_PLUGIN_ROOT}/package.json\" . && npm install) || rm -f \"${CLAUDE_PLUGIN_DATA}/package.json\""
      }]
    }]
  }
}
```

Scripts reference persisted node_modules via `NODE_PATH`:
```json
{
  "mcpServers": {
    "routines": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"],
      "env": { "NODE_PATH": "${CLAUDE_PLUGIN_DATA}/node_modules" }
    }
  }
}
```

## Namespace and priorities

### Skills priority

managed > user > project > plugin. Higher level wins on name conflict.

### Subagent priority

managed > CLI flag > project > user > plugin.

### Hooks

Merge from all sources. Plugin hooks fire alongside others.
Enterprise `allowManagedHooksOnly: true` can block plugin hooks.

## Plugin caching

Marketplace plugins are copied to `~/.claude/plugins/cache` for security.

**Path traversal limitation**: installed plugins cannot reference files outside their
directory. Paths like `../shared-utils` won't work after installation.

**Workaround**: symlink external files into your plugin directory before distribution.
Symlinks are followed during the copy process:

```bash
ln -s /path/to/shared-utils ./shared-utils
```

## Installation and management

### Interactive

```
/plugin                    # Management menu: browse, install, enable/disable, details
```

### CLI commands

```bash
claude plugin install <plugin> [-s user|project|local]
claude plugin uninstall <plugin> [-s scope] [--keep-data]
claude plugin enable <plugin> [-s scope]
claude plugin disable <plugin> [-s scope]
claude plugin update <plugin> [-s scope]
claude plugin validate      # Check plugin.json, frontmatter, hooks.json
```

### Install scopes

| Scope | Settings file | Use case |
|---|---|---|
| user | `~/.claude/settings.json` | Personal, all projects (default) |
| project | `.claude/settings.json` | Team, shared via source control |
| local | `.claude/settings.local.json` | Per-machine override, gitignored |
| managed | Managed policy settings | Organization-wide (read-only, update only) |

`/plugin uninstall` for project scope disables in `.claude/settings.local.json`
(doesn't modify shared settings.json).

### Local development

```bash
claude --plugin-dir ./my-plugin
claude --plugin-dir ./plugin-one --plugin-dir ./plugin-two
```

`--plugin-dir` with same name as installed plugin: local copy takes precedence
(except managed force-enabled plugins).

## Marketplaces

Distribution mechanism. Source types configured in `extraKnownMarketplaces` in settings.json:

```json
// GitHub — repo with marketplace.json
{ "source": "github", "repo": "acme-corp/plugins" }

// npm — npm package
{ "source": "npm", "package": "@acme-corp/claude-plugins" }

// URL — only loads marketplace.json; plugins must use external sources (GitHub, npm, git)
{ "source": "url", "url": "https://plugins.example.com/marketplace.json" }

// File — local marketplace.json
{ "source": "file", "path": "/opt/plugins/marketplace.json" }
```

Team marketplaces: configure at project level via `.claude/settings.json`.
Enterprise: `strictKnownMarketplaces` restricts to managed marketplaces only.
Submit to official Anthropic marketplace via in-app forms (claude.ai or Console).

## Converting from standalone

1. Create plugin directory + `.claude-plugin/plugin.json`
2. Copy components:
   ```bash
   mkdir my-plugin && mkdir my-plugin/.claude-plugin
   cp -r .claude/skills my-plugin/
   cp -r .claude/agents my-plugin/
   ```
3. Create `hooks/hooks.json` from settings.json hook config
4. Update script paths to use `${CLAUDE_PLUGIN_ROOT}`
5. Test each component with `--plugin-dir`
6. Remove originals from `.claude/` after verifying

## Version management

Follow semver: MAJOR.MINOR.PATCH.

- Bump version in `plugin.json` before distributing — users won't see changes
  otherwise due to caching
- Version in `plugin.json` takes priority over marketplace entry
- Use pre-release versions (`2.0.0-beta.1`) for testing
- Start at `1.0.0` for first stable release
- Document changes in `CHANGELOG.md`

## Debugging

- `claude --debug` or `/debug` — plugin loading details, errors, registration
- `claude plugin validate` or `/plugin validate` — check manifests, frontmatter, hooks
- `/plugin` — installed plugin status, error tab
- `/reload-plugins` — reload all components after changes
- Check: directories at root (not inside `.claude-plugin/`)
- Check: valid JSON in `plugin.json` and `hooks.json`
- Check: `${CLAUDE_PLUGIN_ROOT}` in hook/script/MCP paths
- Check: event names are case-sensitive (`PostToolUse`, not `postToolUse`)
- Check: hook scripts are executable (`chmod +x`)
- Check: LSP binaries installed in PATH

## Interactions with other artifacts

- **vs Standalone `.claude/`**: same component types, different packaging. Plugin adds
  namespace, distribution, versioning. Start standalone, convert when sharing.
- **vs Skills**: plugin skills work identically but namespaced. Follow skills authoring
  guide for each SKILL.md within the plugin.
- **vs Hooks**: plugin hooks merge with all other hooks. Same format as settings.json.
  Enterprise can block via `allowManagedHooksOnly`.
- **vs MCP**: plugin MCP servers independent of user config. Auto-start on enable.
  Always pair with a skill teaching domain knowledge.
- **vs Subagents**: plugin agents follow subagent authoring guide but with restricted
  frontmatter (no hooks/mcpServers/permissionMode).

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

## Creation checklist

1. [ ] **Structure**: only `plugin.json` inside `.claude-plugin/`; all components at root
2. [ ] **Manifest**: `name` set (kebab-case); version follows semver
3. [ ] **Skills**: use `skills/` not `commands/`; each SKILL.md has proper frontmatter
4. [ ] **Agents**: only supported frontmatter (no hooks/mcpServers/permissionMode)
5. [ ] **Hooks**: `${CLAUDE_PLUGIN_ROOT}` for all script paths; scripts executable
6. [ ] **MCP**: `${CLAUDE_PLUGIN_ROOT}` for paths; server starts correctly
7. [ ] **Persistent data**: `${CLAUDE_PLUGIN_DATA}` for state that survives updates
8. [ ] **No external paths**: no `../` references (won't work after cache copy)
9. [ ] **Version**: bumped if updating existing plugin
10. [ ] **Tested**: verified with `--plugin-dir`; `plugin validate` passes
11. [ ] **Each component**: follows its own type's authoring guide

## Common anti-patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Components inside `.claude-plugin/` | Not discovered by Claude Code | Move to plugin root |
| Absolute or `../` paths in hooks/MCP | Break after installation (cache copy) | Use `${CLAUDE_PLUGIN_ROOT}` |
| Writing persistent state to `${CLAUDE_PLUGIN_ROOT}` | Lost on plugin update | Use `${CLAUDE_PLUGIN_DATA}` |
| `commands/` for new skills | Legacy directory | Use `skills/` with SKILL.md |
| hooks/mcpServers/permissionMode in agent frontmatter | Not supported in plugin agents | Use plugin-level hooks/MCP instead |
| No version bump on change | Users don't receive updates (caching) | Bump version in plugin.json |
| Plugin for single-project personal use | Unnecessary namespace/packaging overhead | Use standalone `.claude/` |
| MCP server without companion skill | Claude has tool but no domain knowledge | Bundle a skill teaching when/how to use |
