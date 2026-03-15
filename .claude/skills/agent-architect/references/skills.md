# Skills Authoring Guide

## What they are

Markdown file (SKILL.md) + optional supporting files that teach Claude a specific capability.
Loaded on demand - only descriptions at startup (~2% of context), full content when triggered.
Advisory (~70% adherence). Most flexible extension of Claude Code.

## Loading: three phases

1. **Startup**: name + description from frontmatter loaded (low cost)
2. **Matching**: request matches description -> Claude asks to load full SKILL.md
3. **Execution**: Claude follows instructions, reads reference files as needed

If `disable-model-invocation: true` - description not loaded at all (zero cost).

## Locations and priority

| Level | Path | Priority |
|-------|------|----------|
| Enterprise | Managed settings | Highest |
| Personal | `~/.claude/skills/<n>/SKILL.md` | High |
| Project | `.claude/skills/<n>/SKILL.md` | Medium |
| Plugin | `plugin/skills/<n>/SKILL.md` | Lowest |

Same name = higher level wins. Plugin skills get namespace: `/plugin-name:skill-name`.

## File structure

### Minimal

```
.claude/skills/
  commit-message/
    SKILL.md
```

### Complex

```
.claude/skills/
  pdf-processing/
    SKILL.md              # Overview + quick start (< 500 lines)
    FORMS.md              # Field mappings
    REFERENCE.md          # API details
    scripts/
      fill_form.py        # Utility (executed, not read)
      validate.py
```

SKILL.md is the only required file.

## YAML Frontmatter

### Minimal (recommended start)

```yaml
---
name: my-skill-name
description: >-
  What this skill does and when to use it.
  Include keywords users would naturally say.
---
```

### All fields

```yaml
---
name: skill-name                     # /slash-command name
description: What and when           # Semantic trigger (most important field)
disable-model-invocation: true       # Manual only (/skill-name)
user-invocable: false                # Only Claude invokes (background knowledge)
context: fork                        # Run in isolated subagent
agent: Explore                       # Subagent type (with context: fork)
allowed-tools: Read, Grep, Glob      # Tool allowlist
argument-hint: "<topic> [depth]"     # Argument hint in menu
hooks:                               # Hooks scoped to skill lifetime
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/check.sh"
---
```

## Two content types

### Reference (inline, adds knowledge)

```yaml
---
name: api-conventions
description: API design patterns for this codebase.
  Use when writing API endpoints, reviewing API code,
  or discussing API architecture.
---
When writing API endpoints:
- RESTful naming conventions
- Consistent error format: { success, data, error }
- Zod validation schemas
- OpenAPI documentation comments
```

### Task (action, usually manual invoke)

```yaml
---
name: deploy
description: Deploy the application to production
context: fork
disable-model-invocation: true
---
Deploy the application:
1. Run `npm test` - all tests must pass
2. Run `npm run build` - verify clean build
3. Run `npm run deploy:staging` - verify staging
4. Run `npm run deploy:prod` - deploy to production
5. Run `npm run smoke-test` - verify production
```

## Invocation control

| Setting | Who invokes | Use case |
|---------|-------------|----------|
| Default | User + Claude | General skills |
| `disable-model-invocation: true` | User only (`/name`) | Side-effect actions (deploy, commit) |
| `user-invocable: false` | Claude only | Background knowledge |

### Execution context

- **Inline** (default): runs in current conversation, applies alongside chat history
- **`context: fork`**: runs in isolated subagent, returns summary. Only for task skills with clear instructions. Reference skills should NOT fork (no actionable prompt = empty return).

## Dynamic features

### $ARGUMENTS

Text after slash command: `/migrate-component SearchBar React Vue`
- `$ARGUMENTS[0]` or `$0` = SearchBar
- `$ARGUMENTS[1]` or `$1` = React
- `$ARGUMENTS[2]` or `$2` = Vue

### !`command` (preprocessing)

Shell command runs BEFORE sending to Claude. Output replaces placeholder.

```yaml
---
name: pr-summary
description: Summarize PR changes
context: fork
agent: Explore
---
## Context
- PR diff: !`gh pr diff`
- PR comments: !`gh pr view --comments`

## Task
Summarize this pull request...
```

### ultrathink

Include the word "ultrathink" anywhere in skill content to enable extended thinking.

## Progressive disclosure

Keep SKILL.md under 500 lines. Put details in reference files:

```markdown
For complex form mappings, refer to FORMS.md
For API details, see REFERENCE.md
```

Keep references one level deep (SKILL.md -> file, not file -> file -> file).

### Scripts as zero-context execution

Scripts execute without loading into context. Only their output costs tokens.

```markdown
Run scripts/validate.py to check PDF structure.
Do not read the script - just execute it and use the output.
```

## Writing descriptions

Description is the most important field. It determines when Claude loads the skill.

- **Include natural keywords**: words users would actually say
- **Include "when to use" triggers**: "Use when reviewing code, checking PRs..."
- **Differentiate similar skills**: unique keywords for each
- **Don't be too broad**: specific types, directories, contexts
- Be slightly "pushy" - Claude tends to under-trigger skills

## Skills and subagents

### Skill runs as subagent (context: fork)

Add `context: fork` to frontmatter. Skill content becomes subagent prompt.

### Subagent uses skills (skills field)

```yaml
# .claude/agents/api-developer.md
---
skills:
  - api-conventions
  - error-handling-patterns
---
```

Full skill content is injected into subagent context. Subagents do NOT inherit
skills automatically. Built-in agents (Explore, Plan, Verify) and Task tool
do NOT have access to your skills.

## Interactions

- **vs CLAUDE.md**: CLAUDE.md = every session. Skills = on demand. Move non-essential content to skills.
- **vs Rules**: Rules load automatically. Skills load by match or manual invoke. Rules for automatic application, skills for conscious selection.
- **vs Subagents**: Skills add knowledge inline. Subagents run in isolation. Skills for guides/standards, subagents for isolated execution.
- **vs MCP**: MCP gives tools. Skills teach how to use them. Pair them.

## Debugging

- `/skills` - list loaded skills with descriptions
- `/context` - what occupies context
- `claude --debug` - skill loading errors
- Skill not triggering? Rephrase with keywords from description, check disable-model-invocation
- Wrong skill triggers? Descriptions too similar - differentiate them
- YAML errors: frontmatter must start line 1 with `---`, quote colons in descriptions, use `>-`

## Limits

- SKILL.md: max 500 lines
- References: one level deep
- Names: lowercase, digits, hyphens
- Frontmatter: `---` on line 1, no blank lines before it, spaces not tabs
- Live reload: skills in `.claude/skills/` picked up during session without restart
