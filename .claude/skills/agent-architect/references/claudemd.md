# CLAUDE.md Authoring Guide

## What it is

Markdown file loaded into context at every session start. Advisory, not enforced -
Claude reads it and tries to follow, but ~70% adherence. Not a substitute for hooks
when 100% compliance is needed.

## Hierarchy (all additive, higher = more priority)

1. **Managed** (enterprise) - cannot be excluded
2. **User** (`~/.claude/CLAUDE.md`) - personal, all projects
3. **Project** (`./CLAUDE.md`) - committed to git
4. **Local** (`./CLAUDE.local.md`) - personal, not committed
5. **Subdirectory** (`subdir/CLAUDE.md`) - lazy-loaded when agent touches subdir files

Levels 1-4 load at session start. Level 5 loads lazily.

## Size limit

Target: under 200 lines for root CLAUDE.md. Over 200 lines = more context consumed,
lower adherence. If growing beyond, use these offload mechanisms:

- `@imports` - include external files (BUT: loaded at startup, same cost as inline)
- `.claude/rules/` - modular rules with optional path-scoping
- Skills - on-demand knowledge, only descriptions loaded at startup

## Structure pattern (WHY/WHAT/HOW)

```markdown
# ProjectName

Brief description: stack, purpose, key dependencies. (2-3 lines)

## Commands

npm run dev        # Dev server
npm run test       # Tests
npm run build      # Production build

## Project Structure

apps/web/          # Next.js frontend
apps/api/          # Express backend
packages/shared/   # Shared types

## Conventions

- TypeScript strict, no `any`
- Named exports, not default
- All API responses: { success, data, error }

## Important

- NEVER commit .env files
- Run `npm test && npm lint` before committing
- For API conventions see @docs/api-architecture.md
```

### Recommended sections

- **Project description** (2-3 lines): stack, purpose, dependencies
- **Commands** (only non-obvious): build, test, lint with special flags
- **Project structure** (brief map): key directories and purposes
- **Conventions** (only non-standard): things Claude cannot infer from code
- **Architectural decisions** (counterintuitive): decisions that contradict what code structure suggests
- **Compaction instructions** (optional): what to preserve when context is compacted
- **References**: pointers to detailed docs with "Read when:" triggers

## Progressive disclosure (lazy references)

Instead of @importing everything, give Claude pointers with load conditions:

```markdown
## Reference Documents

### API Architecture - docs/api-architecture.md
**Read when:** Adding or modifying API endpoints

### Deployment SOP - docs/deployment.md
**Read when:** Deploying to staging or production
```

These files are NOT loaded at startup. Claude reads them via Read tool only when
the task requires it. This is real context savings, unlike @imports.

## @imports

Syntax `@path/to/file` includes external file content. Loaded at startup alongside
CLAUDE.md. Paths resolve relative to the importing file.

- Recursive imports supported, max depth 5
- Can import from home dir: `@~/.claude/my-prefs.md`
- WARNING: @imports organize content but do NOT reduce context. Everything loads at startup.

## What NOT to put in CLAUDE.md

- **Personality instructions** ("Be a senior engineer") - waste budget, no quality improvement
- **Linting/formatting rules** - use hooks or real linters for 100% enforcement
- **Task-specific instructions** (deploy, migrate) - move to skills
- **Obvious knowledge** - don't explain TypeScript or REST to Claude
- **All possible commands** - only non-standard ones with special flags
- **Duplicate of existing docs** - redundancy hurts, not helps

## Improving adherence

- **Be specific**: "Use 2-space indentation" not "Format code properly"
- **Use importance markers sparingly**: "IMPORTANT:" or "YOU MUST" for 2-3 most critical rules only
- **Use structure**: headers and bullets help Claude scan
- **Convert critical rules to hooks**: if Claude keeps violating it and it matters, it's a hook

## Monorepo strategy

```
monorepo/
  CLAUDE.md                    # Shared conventions
  apps/
    web/
      CLAUDE.md                # Frontend-specific (lazy-loaded)
    api/
      CLAUDE.md                # Backend-specific (lazy-loaded)
```

Root: shared commands, conventions, project map.
Subdirs: service-specific context. Backend doesn't need frontend guidelines.

## Auto Memory

Separate from CLAUDE.md. Claude writes auto memory himself in
`~/.claude/projects/<project>/memory/`. MEMORY.md is the index, first 200 lines
loaded at startup.

- CLAUDE.md = you write, committed, shared
- Auto memory = Claude writes, local, not shared

"Remember X" -> auto memory. "Add X to CLAUDE.md" -> CLAUDE.md.

## Interactions with other artifacts

- **vs Rules**: Rules offload CLAUDE.md. Same priority, but modular. Conditional rules save context.
- **vs Skills**: CLAUDE.md = every session. Skills = on demand. Move non-essential content to skills.
- **vs Hooks**: CLAUDE.md is advisory (~70%). Hooks are deterministic (100%). Escalate critical rules to hooks.
- **vs Output Styles**: Styles affect system prompt directly. CLAUDE.md is added as user message after system prompt.
- **vs Code Review**: Code Review reads CLAUDE.md and flags violations as nit-level findings.

## Maintenance

- `/init` generates starter CLAUDE.md - delete obvious content, keep only non-inferable
- Add rules when Claude makes mistakes
- Remove rules Claude ignores (sign of bloat)
- If Claude asks questions answered in CLAUDE.md - rewrite for clarity
- `claudeMdExcludes` in settings.local.json to skip irrelevant ancestor CLAUDE.md files
- HTML comments (`<!-- -->`) hidden from Claude on auto-injection, visible via Read tool
