---
name: log-episode
description: >-
  Final phase of the agent-system pipeline. Append one episode log
  entry per merged PR to docs/episodes/<YYYY-MM>.jsonl and transition
  the corresponding Plane Work Item to Done. Two modes: finale
  (auto-invoked by /implement-task after merge in the same session,
  no argument) and standalone (/log-episode <pr-url> for old PRs in
  fresh sessions). Drafts decisions/blockers/dead_ends/learnings from
  scratchpads; user approval is mandatory before append. Manual
  invocation only.
disable-model-invocation: true
argument-hint: "[pr-url]"
---

# Log-episode

Record one episode log entry per merged PR and close the WI to
`Done`. The JSONL append is independent of any Plane MCP call: if
Plane fails, the log is still written (git is canonical). No silent
writes — the user always edits or approves the draft.

## Why this exists

`git log` captures *what*; PR descriptions *what is merged*;
skill-logs *every tool call*. None capture the *why* layer at WI
granularity in greppable append-only form. The episode log fills
that gap; this skill is its only writer.

## Inputs, outputs, modes

**Input:** **finale** mode — no argument; discover the PR via
`gh pr view --json url,mergedAt,headRefName,title,body,mergeCommit`
on the current branch (the session where `/implement-task` just
merged the PR). **Standalone** mode — `<pr-url>` for old PRs that
may have merged hours/days ago, possibly on another machine; the
per-task scratchpad may be absent. Mode = argument presence AND
existence of the scratchpad at
`.claude/scratchpads/<feature-slug>/tasks/<wi-code>/`. In standalone
without scratchpad, schema-nullable fields fall back to `null` / `[]` / `{}`;
`feature_slug` (non-nullable) and reasoning trace are user-typed; no phase-state write.

**Contracts loaded at startup** (cited below by section, not paraphrased):

- `docs/agents/plane/universal.md` — workspace facts, state
  resolution (§ 4), comment prefix (§ 5), failure-logging (§ 7).
- `docs/agents/plane/log-episode.md` — `Done` transition guard (§ 1),
  comment templates (§ 2), read contract (§ 3), failure recovery (§ 4).

**Output:** one JSON line appended to `docs/episodes/<YYYY-MM>.jsonl`
(created if absent for the month); WI in `Done` with merge comment
per `log-episode.md § 2`; per-task `phase-state.md` updated in
finale only; `plane-failures.jsonl` appended on MCP failure per
`universal.md § 7`.

## The five-step flow

### 1. Resolve mode and inputs

Read both contract files in full. Detect mode. Resolve `<pr-url>`
from argument (standalone) or `gh pr view --json url` (finale).
From the PR derive: `<wi-code>` by parsing `headRefName` against
`<type>/<short>-GJS-<n>` (fallback: scan PR title for `GJS-<n>`);
`<feature-slug>` from the per-task scratchpad parent dir name
(`null` in standalone with no scratchpad); `<plane_epic_id>` from
the WI's `parent` via `mcp__plane__retrieve_work_item_by_identifier`.
In finale mode, rewrite per-task `phase-state.md` frontmatter:
`phase: log-episode`, `status: in-progress`, `started_at: <now>`,
`next_phase: null`, `cycles: 0`. Standalone skips this.

### 2. Auto-extract telemetry

Run the helper `scripts/episode/auto-extract.sh` to draft every
auto-extracted field per `docs/episodes/schema.json`:

```bash
scripts/episode/auto-extract.sh <pr-url> \
  --epic-code <plane_epic_id> \
  [--feature-slug <slug>] > /tmp/episode-<wi-code>.json
```

`<plane_epic_id>` comes from one `mcp__plane__retrieve_work_item_by_identifier`
call in step 1 (the script never talks to Plane). The helper populates
auto-extracted fields and emits human-curated fields (`decisions`,
`blockers`, `dead_ends`, `learnings`, `tags`, `parallel_with`) as
empty arrays for step 3 to fill in. On non-zero exit, abort and
surface the script's stderr to the user.
Note: when the helper cannot derive `feature_slug` (no `--feature-slug`,
no scratchpad glob match), it emits `feature_slug: ""` and a slug-less
`episode_id`; the user must supply the slug in Step 3 or schema
validation will fail in Step 4.

### 3. Draft reasoning trace

Read available scratchpad notes: per-task `phase-state.md` Notes,
`code-review.md`, any `decisions.md` / `blockers.md` the user kept.
Draft `decisions`, `blockers`, `dead_ends`, `learnings`, `tags` per
schema shapes (`decision`: `what`/`why`/`rejected`/`confidence`;
`blocker`: `what`/`resolution`/`duration_min`/`tag`; `dead_end`:
`tried`/`why_failed`). Standalone without scratchpads → empty arrays
and prompt from memory.

**Then prompt the user for approval.** Present the full draft JSON
and ask: (1) edits to drafted fields? (2) `parallel_with` — sibling
WI codes that ran concurrently (e.g. `GJS-43, GJS-44`)? Defaults
`[]`; human-curated, never auto-extracted. Use `AskUserQuestion`
or an explicit interactive prompt — never silent-write. The user
must approve before step 4.

### 4. Validate against schema

Validate the candidate against `EpisodeSchema` (zod source of truth
in `packages/ats-core/src/episode-schema.ts`) before any append.
Required keys are pinned by zod's `EpisodeSchema` (surfaced in the
generated `docs/episodes/schema.json` `required` array). Method: write to
`/tmp/episode-<wi-code>.json`, run `pnpm --filter @gjs/ats-core
validate:episode /tmp/episode-<wi-code>.json`. On error, print the
specific output, ask the user to edit the offending field,
re-validate. Loop until valid.

### 5. Append, then update Plane

Append first, then Plane writes — Plane failure must not block the
log entry per `log-episode.md § 4`.

1. **Append.** Resolve `<YYYY-MM>` from `completed_at`. Create
   `docs/episodes/<YYYY-MM>.jsonl` if absent. Append the validated
   object as one JSON line (no trailing comma, newline at end).
   Append failure (disk, permission) is a hard abort — surface to
   user; no Plane writes.
2. **Plane state → `Done`.** Resolve `Done` id per `universal.md § 4`.
   Apply transition guard per `log-episode.md § 1`: `In Review` →
   transition; `Done` → warn and continue (idempotent rerun);
   `In Progress` → warn `WI <code> was still In Progress when merged;
   forcing Done` and force; `Backlog` / `Todo` / `Cancelled` → abort
   the state update with `WI <code> is in unexpected state <name>;
   manual reconciliation needed` (entry from sub-step 1 stays). Call
   `mcp__plane__update_work_item(state=<Done id>)`.
3. **Comment.** Per `log-episode.md § 2`: `[log-episode] Merged:
   <pr-url> (commit <sha>)`. On comment failure, continue.
4. **Finale close.** Rewrite per-task `phase-state.md`:
   `status: complete`, `ended_at: <now ISO 8601 UTC>`. Standalone
   skips this.

Print summary: `episode_id`, JSONL path, WI new state, any drift to `plane-failures.jsonl`.

## Phase tracking

Writes per-task `.claude/scratchpads/<feature-slug>/tasks/<wi-code>/phase-state.md`
**in finale mode only**, schema at `docs/agents/phase-state-schema.md`.
`phase: log-episode`, `next_phase: null`; `started_at` in step 1,
`ended_at` when step 5 finishes; `status: in-progress` → `complete`
on append, `failed` on user abort or append-write failure;
`cycles: 0` — no reviewer subagent. Standalone skips this.

## Failure handling

Logging and notification follow `universal.md § 7`. Per-operation
rules from `log-episode.md § 4`:

| Operation                | On failure                                                              |
|--------------------------|-------------------------------------------------------------------------|
| Read WI / comments       | Continue with partial data; missing fields → `null`                     |
| Schema validation        | Loop with user edits until valid; never bypass                          |
| JSONL append             | Hard abort; surface error; no Plane writes                              |
| State update to `Done`   | Episode log **still written** (canonical); drift logged + WARN comment  |
| Comment posting          | Continue (comment is convenience)                                       |

On state-update failure, post the WARN comment per `log-episode.md § 2`:
`[log-episode] WARN: state update failed; episode logged in git regardless`.
No bootstrap-time validation: a misconfigured workspace surfaces via
the failing MCP call's error pointing to `bootstrap.md` per `universal.md § 7`.

## What stays out

- **PRD / design / plan creation** — owned by `/research`, `/prd`, `/design`, `/plan`.
- **Multi-WI summaries / batch reports / bulk backfill** — one entry per WI; no batch mode.
- **`/promote-pattern`** (Stage 3 aggregation) and **auto-detecting `parallel_with`** — out of scope.
- **Modifying past episode entries** — JSONL is append-only.
- **Reading raw skill-log transcripts** (per-session JSONL under `~/.claude/projects/`) — only `meta.json` and `events.jsonl` are consumed.

## Language

**Dialogue:** mirror the user's language. **Episode log content and
Plane comments: always English** — read by downstream agents.

## When NOT to use this skill

- PR not merged yet → wait for merge; `/implement-task` ends at `In Review`.
- WI not created by `/tasks` (no `gjs:wi:...` `external_id`) → no episode entry needed.
- Editing a past episode → out of scope; JSONL is append-only.
