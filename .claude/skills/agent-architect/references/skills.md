# Skills Authoring Guide

## What they are

Markdown file (SKILL.md) + optional supporting files that teach Claude a specific capability.
Loaded on demand — only descriptions at startup (~2% of context), full content when triggered.
Advisory (~70% adherence). Most flexible extension of Claude Code.

## Loading: three phases

1. **Startup**: name + description from frontmatter loaded (low cost)
2. **Matching**: request matches description → Claude asks to load full SKILL.md
3. **Execution**: Claude follows instructions, reads reference files as needed

What loads when depends on invocation settings — see [Invocation control](#invocation-control).

## Locations and priority

| Level | Path | Priority |
|-------|------|----------|
| Enterprise | Managed settings | Highest |
| Personal | `~/.claude/skills/<n>/SKILL.md` | High |
| Project | `.claude/skills/<n>/SKILL.md` | Medium |
| Plugin | `plugin/skills/<n>/SKILL.md` | Lowest |

Same name = higher level wins. Plugin skills get namespace: `/plugin-name:skill-name`.

**Nested discovery**: Skills in subdirectory `.claude/skills/` are auto-discovered when
working with files in that subdirectory (monorepo support). E.g., editing a file in
`packages/frontend/` also discovers skills from `packages/frontend/.claude/skills/`.

**Additional directories**: Skills from `--add-dir` directories are loaded automatically
with live change detection — editable during a session without restart.

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

All fields are optional. Only `description` is recommended.

```yaml
---
name: skill-name                     # /slash-command name (lowercase, digits, hyphens, max 64 chars)
description: >-                      # Semantic trigger (MOST IMPORTANT field)
  What this skill does and when.
  Include keywords users would naturally say.
argument-hint: "<topic> [depth]"     # Hint shown in autocomplete menu
disable-model-invocation: true       # Manual only (/skill-name) — removes from context entirely
user-invocable: false                # Only Claude invokes (background knowledge, hidden from / menu)
context: fork                        # Run in isolated subagent
agent: Explore                       # Subagent type when context: fork (default: general-purpose)
model: sonnet                        # Model override: sonnet, opus, haiku, or full model ID
effort: max                          # Effort override: low, medium, high, max (Opus 4.6 only)
allowed-tools: Read, Grep, Glob      # Tool allowlist (grants access without per-use approval)
hooks:                               # Hooks scoped to skill lifetime
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "${CLAUDE_SKILL_DIR}/scripts/check.sh"
---
```

**Key fields explained:**

- `name`: becomes the `/slash-command`. If omitted, uses directory name.
- `description`: determines when Claude loads the skill via semantic similarity matching.
  If omitted, uses first paragraph of markdown content.
- `model`: overrides the session model while skill is active. Use for cost optimization
  (haiku for simple read-only skills) or capability (opus for complex analysis).
- `effort`: overrides session effort level while skill is active.
- `allowed-tools`: skills that define this field grant Claude access to listed tools
  without per-use approval for the skill's duration. Supports patterns: `Bash(python:*)`.

## String substitutions

| Variable | Description |
|---|---|
| `$ARGUMENTS` | All text after `/skill-name`. If not present in content, appended as `ARGUMENTS: <value>` |
| `$ARGUMENTS[N]` or `$N` | Specific argument by 0-based index (`$0` = first, `$1` = second) |
| `${CLAUDE_SESSION_ID}` | Current session ID (useful for logging, session-specific files) |
| `${CLAUDE_SKILL_DIR}` | Directory containing this SKILL.md file — resolves correctly across installations |

**Always use `${CLAUDE_SKILL_DIR}` for bundled scripts** — hardcoded paths break when the
skill is installed at a different level (project vs personal vs plugin):

```markdown
Run `${CLAUDE_SKILL_DIR}/scripts/validate.py` to check structure.
Do not read the script — just execute it and use the output.
```

## Two content types

### Reference (inline, adds knowledge)

Adds knowledge Claude applies to current work. Conventions, patterns, domain knowledge.
Runs **inline** — Claude uses it alongside conversation context.

**Must NOT use `context: fork`** — a subagent receiving guidelines without an actionable
task prompt returns empty/meaningless output.

```yaml
---
name: api-conventions
description: >-
  API design patterns for this codebase.
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

Step-by-step instructions for a specific action. Usually paired with
`disable-model-invocation: true` to prevent Claude from auto-triggering
workflows with side effects.

```yaml
---
name: deploy
description: Deploy the application to production
context: fork
disable-model-invocation: true
---
Deploy the application:
1. Run `npm test` — all tests must pass
2. Run `npm run build` — verify clean build
3. Run `npm run deploy:staging` — verify staging
4. Run `npm run deploy:prod` — deploy to production
5. Run `npm run smoke-test` — verify production
```

## Invocation control

| Setting | Who invokes | Description in context | Full content loaded | Use case |
|---------|-------------|----------------------|--------------------|----|
| (default) | User + Claude | Always | When invoked by either | General skills |
| `disable-model-invocation: true` | User only (`/name`) | Never (zero cost) | When user invokes | Side-effect actions (deploy, commit) |
| `user-invocable: false` | Claude only | Always | When Claude invokes | Background knowledge |

Note: `user-invocable: false` hides from `/` menu but does NOT block the Skill tool.
Only `disable-model-invocation: true` fully prevents programmatic invocation.

### Execution context

- **Inline** (default): runs in current conversation alongside chat history.
  Use for reference content and lightweight tasks.
- **`context: fork`**: runs in isolated subagent, returns summary to main conversation.
  Only for **task skills with clear, actionable instructions**.

The `agent` field selects subagent type: built-in (`Explore`, `Plan`, `general-purpose`)
or custom from `.claude/agents/`. Default: `general-purpose`.

### Permission control

Control which skills Claude can invoke via `permissions.allow` and `permissions.deny`
in settings.json (or interactively via `/permissions`):

```jsonc
// settings.json
{
  "permissions": {
    "allow": [
      "Skill(commit)",        // exact name match
      "Skill(review-pr *)"    // prefix match — any arguments
    ],
    "deny": [
      "Skill(deploy *)",      // block deploy skill
      "Skill"                 // block ALL skills (nuclear option)
    ]
  }
}
```

Syntax: `Skill(name)` for exact match, `Skill(name *)` for prefix match with arguments.
Bare `Skill` in deny blocks all skill invocations.

## Dynamic features

### !`command` (preprocessing)

Shell commands run BEFORE sending to Claude. Output replaces the placeholder inline.
Claude sees only the final result, not the command itself.

```yaml
---
name: pr-summary
description: Summarize PR changes
context: fork
agent: Explore
allowed-tools: Bash(gh *)
---
## Context
- PR diff: !`gh pr diff`
- PR comments: !`gh pr view --comments`
- Changed files: !`gh pr diff --name-only`

## Task
Summarize this pull request...
```

### ultrathink

Include the word "ultrathink" anywhere in skill content to enable extended thinking.

## Progressive disclosure

Keep SKILL.md under 500 lines. Put detailed content in reference files:

```markdown
For complex form mappings, refer to FORMS.md
For API details, see REFERENCE.md
```

**One level deep only**: link SKILL.md → reference file directly. Do NOT chain
(file A → file B → file C) — leads to partial reads.

### Scripts as zero-context execution

Scripts execute without loading their source into context. Only output costs tokens.
Always instruct Claude to run, not read:

```markdown
Run `${CLAUDE_SKILL_DIR}/scripts/validate.py` to check PDF structure.
Do not read the script — just execute it and use the output.
```

This is ideal for complex validation logic, data processing, or operations
requiring consistency across invocations.

## Writing descriptions

Description is the most important field. It determines when Claude loads the skill
via semantic similarity matching against user requests.

### Principles

1. **Include natural keywords**: words users would actually say to trigger this skill
2. **Include "when to use" triggers**: "Use when reviewing code, checking PRs, or analyzing quality"
3. **Differentiate similar skills**: unique keywords for each; overlapping descriptions cause misfires
4. **Be specific, not broad**: mention specific file types, directories, or action contexts
5. **Be slightly forward**: Claude tends to under-trigger skills — err toward matching more

### Good vs bad descriptions

```yaml
# BAD — too broad, fires on everything
description: Helps with code

# BAD — too narrow, misses natural requests
description: Validates PDFs uploaded via /api/documents endpoint

# GOOD — specific with natural keywords and triggers
description: >-
  Extract text from PDFs, fill PDF forms, merge PDF files.
  Use when working with PDF files, document extraction,
  or form processing.

# BAD — two skills with overlapping descriptions
description: Data analysis    # skill A
description: Analyze data     # skill B

# GOOD — differentiated
description: Sales data analysis from Excel files and CRM exports    # skill A
description: Log file analysis and error pattern detection            # skill B
```

### Debugging trigger issues

- `/skills` — list loaded skills with descriptions
- `/context` — check what occupies context; may show excluded skills warning
- `claude --debug` — skill loading errors
- Rephrase request with keywords from description if skill doesn't trigger
- Set `SLASH_COMMAND_TOOL_CHAR_BUDGET` env var to override description budget
  (default: 2% of context window, fallback: 16,000 characters)

## Skills and subagents

### Skill → Subagent (context: fork)

Add `context: fork` to frontmatter. Skill content becomes the subagent's task prompt.
`agent:` selects the execution environment (model, tools, permissions).

| Approach | System prompt | Task | Also loads |
|---|---|---|---|
| Skill with `context: fork` | From agent type (Explore, Plan, etc.) | SKILL.md content | CLAUDE.md |
| Subagent with `skills` field | Subagent's markdown body | Claude's delegation message | Preloaded skills + CLAUDE.md |

### Subagent → Skills (skills field)

```yaml
# .claude/agents/api-developer.md
---
name: api-developer
description: Implement API endpoints following team conventions
skills:
  - api-conventions
  - error-handling-patterns
---
Implement API endpoints. Follow the conventions and patterns from the preloaded skills.
```

Full skill content is **injected** into subagent context at startup — not just made
available for invocation. Subagents do NOT inherit skills from the parent conversation;
list them explicitly.

**Key limitation**: Built-in agents (Explore, Plan, Verify) and the Task tool do NOT
have access to custom skills. Only custom subagents from `.claude/agents/` with an
explicit `skills` field can use them.

## Hooks in skills

Skills can define lifecycle hooks in frontmatter. Hooks are active only while the skill
runs and cleaned up when it finishes. All hook events are supported. Format matches
settings.json hooks.

```yaml
---
name: secure-writer
description: Write code with security validation
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "${CLAUDE_SKILL_DIR}/scripts/security-check.sh"
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: command
          command: "${CLAUDE_SKILL_DIR}/scripts/lint-check.sh"
---
```

Use `${CLAUDE_SKILL_DIR}` in hook commands for portable paths.

## Interactions with other artifacts

- **vs CLAUDE.md**: CLAUDE.md = every session (HIGH context cost). Skills = on demand.
  Move non-essential content to skills.
- **vs Rules**: Rules load automatically (unconditional: always; conditional: by file match).
  Skills load by semantic match or manual invoke. Rules for automatic enforcement,
  skills for conscious selection.
- **vs Subagents**: Skills add knowledge inline. Subagents run in isolation with own tools.
  Skills for guides/standards, subagents for isolated execution.
- **vs MCP**: MCP gives tools. Skills teach how to use them effectively. Always pair them —
  a tool without domain knowledge is an anti-pattern.

## Limits

- SKILL.md: max 500 lines
- References: one level deep from SKILL.md
- Names: lowercase, digits, hyphens (max 64 characters)
- Frontmatter: `---` on line 1, no blank lines before it, spaces not tabs
- Colons in description: wrap in quotes or use `>-` block scalar
- Description budget: ~2% of context window (fallback: 16,000 chars)
- Live reload: skills in `.claude/skills/` picked up during session without restart

## Creation checklist

When creating a new skill, verify each item:

1. [ ] **Content type**: reference (inline) or task (fork/manual) — correctly identified
2. [ ] **Description**: contains natural keywords + "when to use" triggers + differentiated
       from existing skills
3. [ ] **Invocation control**: `disable-model-invocation: true` for side-effect actions;
       `user-invocable: false` for background knowledge
4. [ ] **Execution context**: `context: fork` ONLY for task skills with clear instructions;
       reference skills MUST be inline
5. [ ] **Arguments**: uses `$ARGUMENTS` / `$N` if user input needed; `argument-hint` set
       for autocomplete
6. [ ] **Supporting files**: large content moved to reference files, linked one level deep
7. [ ] **Scripts**: use `${CLAUDE_SKILL_DIR}` for portable paths; instruct "run, don't read"
8. [ ] **Model/effort**: set only when skill needs specific model or effort level
9. [ ] **Size**: SKILL.md under 500 lines
10. [ ] **No duplication**: does not duplicate existing CLAUDE.md, rules, or skills content
11. [ ] **Hooks**: if validation needed, use `${CLAUDE_SKILL_DIR}` in hook commands

## Common anti-patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| Reference skill with `context: fork` | Subagent gets knowledge but no task → empty return | Remove `context: fork`, run inline |
| Task skill without `disable-model-invocation` | Claude auto-triggers side effects (deploy, commit) | Add `disable-model-invocation: true` |
| Hardcoded paths in portable skill | Breaks across project/personal/plugin installs | Use `${CLAUDE_SKILL_DIR}` |
| Everything in one SKILL.md | Exceeds 500 lines, loads unnecessary context | Progressive disclosure → reference files |
| Broad description | Fires on unrelated requests | Add specific keywords, file types, contexts |
| Missing "when to use" in description | Claude under-triggers the skill | Add explicit trigger phrases |
| MCP without companion skill | Claude has tool but no domain knowledge | Pair MCP with skill teaching usage |
| Two skills with similar descriptions | Claude picks wrong skill | Differentiate with unique keywords |
| Deep reference chains (A→B→C) | Partial reads, lost context | Keep references one level deep |
