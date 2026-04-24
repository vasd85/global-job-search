---
name: analyze-skill-logs
description: >-
  Analyze a captured skill run at `.claude/logs/<skill>/<ts>-<session>/` —
  locate it, skim events.jsonl for the tool-call skeleton, drill into
  raw.jsonl for agent reasoning, inspect per-subagent transcripts under
  session-dir/subagents/. Use when the user wants to review, debug, or
  audit how a past `/product-research`, `/implement`, or any `/<skill>`
  run behaved — phrasings like "review the last run", "why did the agent
  do X", "what tools did it call", "what happened on that run", "where
  did it go wrong", "walk me through the run", "show events.jsonl",
  "debug the skill".
argument-hint: "<skill name, run dir, or empty for latest>"
context: fork
---

# Analyze skill logs

You inspect a captured run of a `/<skill>` invocation to help the user understand what the agent did, which subagents it spawned, where reasoning drifted, and where the user had to correct course. **All findings must cite specific log events.** Never guess at what happened — if a file can't answer it, say so.

## How runs are captured

The skill-logger hooks (`.claude/hooks/skill-logger/`) fire on `UserPromptSubmit` and `PostToolUse`. On a non-system `/<slash>` they bootstrap:

```
.claude/logs/<skill>/<YYYYMMDD-HHMMSS>-<session-prefix>/
  meta.json     — {skill, args, session_id, started_at, initial_prompt, ...}
  events.jsonl  — compact timeline, one JSON line per event
  raw.jsonl     — SYMLINK → full Claude Code main-agent transcript (live)
  session-dir   — SYMLINK → sibling dir containing subagents/ and tool-results/
```

## Resolving the target run

Interpret the user's argument (or free-text phrasing):

- **empty / "latest"** → most recent run across any skill: `ls -td .claude/logs/*/*/ | head -1`
- **skill name** (e.g. `product-research`) → `ls -td .claude/logs/<skill>/*/ | head -1`
- **directory path** → treat as the run dir directly
- **session id or prefix** → `ls -d .claude/logs/*/*-<prefix>*/`

Always `cat <run>/meta.json` first and tell the user which run you're about to analyze (`skill`, `started_at`, `initial_prompt`). If the choice is ambiguous, list candidates and ask before proceeding.

## Step 1 — skeleton via events.jsonl

Start here. It's the compact timeline, one event per line.

```bash
jq -c . <run>/events.jsonl                                           # full timeline
jq -c 'select(.kind=="tool_use") | {ts,tool}' <run>/events.jsonl    # just tool sequence
jq -c 'select(.kind=="user_prompt")' <run>/events.jsonl             # mid-run user messages (corrections, follow-ups)
```

Event kinds emitted by the logger:

- `skill_start` — `{ts, kind, skill, prompt}`
- `user_prompt` — `{ts, kind, text}` (free-text from user during the run)
- `tool_use` — `{ts, kind, tool, input, output}` (strings >400B and arrays >15 items are truncated with `…[+N]` markers)
- `skill_end` — `{ts, kind, reason}` (written only when another slash command rotates the marker)

Truncation in events.jsonl is aggressive by design. For full payloads drop to raw.jsonl.

## Step 2 — reasoning via raw.jsonl

raw.jsonl is a live symlink to Claude Code's native session transcript. Entries are `{type, message, ...}` where `type` is `"user"`, `"assistant"`, or `"system"`.

```bash
# Assistant text (reasoning between tool calls)
jq -c 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text' <run>/raw.jsonl

# Full tool inputs, untruncated
jq -c 'select(.type=="assistant") | .message.content[]? | select(.type=="tool_use") | {name, input}' <run>/raw.jsonl

# Thinking blocks (can be long — pull only when needed)
jq -c 'select(.type=="assistant") | .message.content[]? | select(.type=="thinking") | .thinking' <run>/raw.jsonl
```

Use events.jsonl for skim, raw.jsonl when you need exact wording or untruncated payloads.

## Step 3 — subagents

A subagent spawn shows up in events.jsonl as a `tool_use` with `tool: "Agent"`. Its internal work — its own tool calls, reasoning, final output — lives in a separate transcript under `session-dir/subagents/`:

```bash
ls <run>/session-dir/subagents/                                       # list subagents spawned
cat <run>/session-dir/subagents/agent-<id>.meta.json                 # description, subagent_type, prompt, final output
jq -c 'select(.type=="assistant") | .message.content[]? | select(.type=="text") | .text' \
  <run>/session-dir/subagents/agent-<id>.jsonl                       # that subagent's reasoning
```

Match a subagent to its spawn event by `agentId` in the main agent's tool_use output, or by timestamp ordering.

## Common analysis questions

- **Where did the user correct the agent?** Filter `user_prompt` events; pair each with the preceding `tool_use` to see what had just happened before the correction.
- **What SQL did the agent run?** `jq -c 'select(.kind=="tool_use" and .tool=="mcp__postgres__execute_sql") | .input.sql' events.jsonl`
- **Which subagents were spawned, for what?** `jq -c 'select(.kind=="tool_use" and .tool=="Agent") | {desc: .input.description, type: .input.subagent_type}' events.jsonl`
- **How long did the run take?** Compare `meta.json .started_at` with the last event's `.ts` in events.jsonl.
- **What was the final output / file written?** Last `Write` entry in events.jsonl → then read that path directly.

## Reporting

Deliver findings as:

1. **Header** (one line): `<skill> · started <ts> · "<initial prompt>"`.
2. **Timeline** (5–15 key events): skill_start, major tool calls, user corrections, final output — each with its timestamp.
3. **Findings**: what worked, what didn't — each tied to a **specific event reference** from the log (e.g., "at 14:23:17 agent ran `Read` on X, then at 14:23:31 user replied Y — agent had missed that Z").
4. **Improvement suggestions for the skill** (only if user asked) — each grounded in a concrete log event, not general impressions.

Keep raw payloads out of the report unless asked; summarize. Cite exact event timestamps so the user can jump to them in the log.

## When NOT to use this skill

- `.claude/logs/` doesn't exist → skill-logger hooks aren't set up or haven't fired yet. Tell the user.
- The run in question predates the hooks → only `~/.claude/projects/<slug>/<session>.jsonl` exists (no meta.json, no events.jsonl). Fall back to raw-transcript analysis only, and tell the user the scope is narrower.
- User wants a live trace of an in-progress run → just `tail -f` raw.jsonl or events.jsonl; no analysis skill needed.
