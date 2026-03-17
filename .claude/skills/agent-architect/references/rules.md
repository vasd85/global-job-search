# Rules Authoring Guide

## What they are

Markdown files in `.claude/rules/` - modular alternative to monolithic CLAUDE.md.
Same high priority as CLAUDE.md, but support conditional loading via `paths:` frontmatter.
Advisory (~70% adherence), not deterministic. For 100% enforcement use hooks.

## Two types

### Unconditional (no frontmatter)

Loaded at session start, same priority as CLAUDE.md. Apply to all files.

```markdown
# Code Style Guidelines

- Comments in English only
- Prefer functional programming over OOP
- Use strict typing everywhere
```

Use for: project-wide rules that are a standalone topic (code style, git workflow, naming).

### Conditional (with `paths:`)

Loaded only when Claude reads files matching the glob pattern. This is the primary
context-saving mechanism of rules.

```yaml
---
paths:
  - "src/api/**/*.ts"
---
# API Development Rules
- All endpoints must include input validation
- Use the standard error response format
- Include OpenAPI documentation comments
```

Use for: rules specific to a code area (frontend, backend, tests, migrations).

## Locations

| Level | Path | Scope |
|-------|------|-------|
| Project | `.claude/rules/*.md` | Committed to git, shared with team |
| User | `~/.claude/rules/*.md` | Personal, all projects |

User rules load before project rules, so project rules have higher priority.
Personal defaults apply everywhere, but any project can override them.

## Glob patterns

```yaml
paths:
  - "src/api/**/*.ts"              # All .ts in src/api/ recursively
  - "**/*.test.ts"                  # All test files anywhere
  - "src/auth/**/*"                 # Everything in src/auth/
  - "*.config.js"                   # Config files in root
  - "src/**/*.{ts,tsx}"             # Brace expansion: .ts and .tsx
  - "{src,lib}/**/*.ts"             # Multiple directories
  - "**/*.{test,spec}.{ts,tsx}"     # All tests and specs
```

Multiple patterns = rule loads when ANY pattern matches.

## File organization

### Flat (small projects)

```
.claude/rules/
  code-style.md
  testing.md
  security.md
  api-design.md
```

### Nested (large projects)

All .md files discovered recursively:

```
.claude/rules/
  frontend/
    components.md
    styling.md
  backend/
    api.md
    database.md
  shared/
    naming.md
```

Descriptive filenames: `testing.md`, `api-design.md`, `security.md`.

## Writing effective rules

- **One file = one topic.** Don't mix code style with testing rules.
- **Be specific**: "Use descriptive names: 'should [action] when [condition]'" not "Write good tests"
- **Use markdown structure**: headers and bullets for scannability
- **Avoid conflicts**: contradicting rules in different files = Claude picks arbitrarily
- **Don't duplicate CLAUDE.md**: rules supplement, not repeat

## Symlinks for reuse

```bash
ln -s ~/shared-claude-rules .claude/rules/shared
ln -s ~/company-standards/security.md .claude/rules/security.md
```

Useful for team standards. Security team owns security.md, frontend team owns components.md.

## Examples

### Testing standards (conditional)

```yaml
---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
---
# Test Writing Standards
- Descriptive names: "should [action] when [condition]"
- One assertion per test when possible
- Mock external dependencies, never real APIs
- Include edge cases: empty inputs, null, boundaries
- Verify single file: `npm test -- --testPathPattern=<file>`
```

### Security-critical code (conditional)

```yaml
---
paths:
  - "src/auth/**/*"
  - "src/payments/**/*"
---
# Security Rules
- Never log sensitive data (passwords, tokens, card numbers)
- Validate all inputs at function boundaries
- Parameterized queries only
- Explicit authorization checks before data access
```

### React components (conditional)

```yaml
---
paths:
  - "src/components/**/*.{tsx,jsx}"
---
# React Component Rules
- Functional components with hooks
- Extract business logic into custom hooks
- Tailwind for styling, no CSS modules
- Export and document props interface
```

## Monorepo strategy

```
monorepo/
  CLAUDE.md                          # Shared: stack, structure, commands
  .claude/
    rules/
      code-style.md                  # Unconditional: project-wide style
      git-workflow.md                # Unconditional: git conventions
      frontend/
        react-components.md          # Conditional: paths: src/apps/web/**
        styling.md                   # Conditional: paths: **/*.{css,scss,tsx}
      backend/
        api-design.md                # Conditional: paths: src/apps/api/**
        database.md                  # Conditional: paths: drizzle/**, src/db/**
```

## Interactions

- **vs CLAUDE.md**: Same priority. Rules modularize and offload CLAUDE.md.
  CLAUDE.md = routing, core context. Rules = topical standards.
- **vs Skills**: Rules load automatically. Skills load by description match or manual invoke.
  Rules = automatic application. Skills = conscious selection.
- **vs Hooks**: Rules are advisory. Hooks are deterministic. Escalate critical rules to hooks.
- **vs Subagents**: Subagents do NOT inherit rules. Include needed rules in subagent prompt
  or via `skills:` field.

## Debugging

- `/memory` - shows all loaded CLAUDE.md and rules files
- `/context` - shows what occupies context window
- `InstructionsLoaded` hook - fires when rules load (path, type, reason)
- Check glob patterns match actual file paths
- Review for conflicts between rule files periodically
