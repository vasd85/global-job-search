---
name: log-episode
description: >-
  Final phase of the agent-system pipeline. Append one episode log
  entry per PR to docs/episodes/<YYYY-MM>.jsonl, perform gh pr merge,
  transition the Plane Work Item to Done. Finale (no arg, runs on
  feature branch, performs merge) or standalone (/log-episode <pr-url>;
  emergency-only for PRs merged externally). Drafts reasoning trace
  from scratchpads; user approval mandatory. Manual invocation only.
disable-model-invocation: true
argument-hint: "[pr-url]"
---

# Log-episode

Record one episode log entry per PR and close the WI to `Done`. In
finale mode the skill performs `gh pr merge` itself, so one PR
carries code + tests + episode entry. The JSONL append is independent
of any Plane MCP call: if Plane fails, the log is still written (git
is canonical). No silent writes — the user always edits or approves
the draft.

## Why this exists

`git log` captures *what*; PR descriptions *what is merged*;
skill-logs *every tool call*. None capture *why* at WI granularity
in greppable append-only form. The episode log fills that gap; this
skill is its only writer.

## Inputs, outputs, modes

**Input:** **finale** mode — no argument; runs on the **feature
branch before merge** (the session where `/implement-task` just
opened the PR). Discover the PR via `gh pr view --json url` on the
current branch. **Standalone** mode — `<pr-url>` for old/external
PRs already merged elsewhere; the per-task scratchpad may be absent.
**Emergency-only fallback**; finale is the default flow. Mode =
argument presence AND scratchpad existence at
`.claude/scratchpads/<feature-slug>/tasks/<wi-code>/`. In standalone
without scratchpad, schema-nullable fields fall back to `null` / `[]` / `{}`;
`feature_slug` and reasoning trace are user-typed; no phase-state write.
**Ad-hoc WIs** (`external_id == null`): `feature_slug` and `plane_epic_id` = literal `adhoc`; `*_link` fields = `null`.

**Contracts loaded at startup** (cited below by section, not paraphrased):

- `docs/agents/plane/universal.md` — workspace facts, state
  resolution (§ 4), comment prefix (§ 5), failure-logging (§ 7).
- `docs/agents/plane/log-episode.md` — `Done` transition guard (§ 1),
  comment templates (§ 2), read contract (§ 3), failure recovery (§ 4).

**Output:** one JSON line appended to `docs/episodes/<YYYY-MM>.jsonl`;
in finale, also commit + push + `gh pr merge --merge --delete-branch`
+ return to `main`; WI `Done` per `log-episode.md § 2`;
`plane-failures.jsonl` appended on MCP failure per `universal.md § 7`.

## The flow

### 1. Resolve mode and inputs

Read both contract files in full. Detect mode. Resolve `<pr-url>`
from argument (standalone) or `gh pr view --json url` (finale, on
current feature branch). From the PR derive: `<wi-code>` by parsing
`headRefName` against `<type>/<short>-GJS-<n>` (fallback: PR title);
`<feature-slug>` from the per-task scratchpad parent dir; `<plane_epic_id>`
from the WI's `parent` via `mcp__plane__retrieve_work_item_by_identifier`
(both default to literal `adhoc` for ad-hoc WIs).
In finale, `completed_at = now` (ISO 8601 UTC) — pre-merge timestamp
captured seconds before `gh pr merge` returns; imprecision (< 10 s)
accepted by design. Standalone uses `gh pr view --json mergedAt`. In
finale, rewrite per-task `phase-state.md` frontmatter:
`phase: log-episode`, `status: in-progress`, `started_at: <now>`,
`next_phase: null`, `cycles: 0`. Standalone skips this.

### 2. Auto-extract telemetry

Run the helper `scripts/episode/auto-extract.sh` to draft every
auto-extracted field per `docs/episodes/schema.json`:

```bash
scripts/episode/auto-extract.sh <pr-url> \
  --epic-code <plane_epic_id> --completed-at <iso> \
  [--feature-slug <slug>] > /tmp/episode-<wi-code>.json
```

`<plane_epic_id>` comes from step 1. `--completed-at <now-iso>` required
in finale (PR open); omit in standalone (helper reads `mergedAt`). Helper
emits human-curated fields (`decisions`, `blockers`, `dead_ends`,
`learnings`, `tags`, `parallel_with`) as empty arrays for step 3; on
non-zero exit abort and surface stderr. Empty `feature_slug` falls back
to `""`; user supplies in step 3 or validation fails.

### 3. Draft reasoning trace

Read scratchpad notes: per-task `phase-state.md` Notes,
`code-review.md`, any `decisions.md` / `blockers.md` the user kept.
Draft `decisions`, `blockers`, `dead_ends`, `learnings`, `tags` per
schema shapes (`decision`: `what`/`why`/`rejected`/`confidence`;
`blocker`: `what`/`resolution`/`duration_min`/`tag`; `dead_end`:
`tried`/`why_failed`). Standalone without scratchpads → empty arrays
and prompt from memory.

**Then prompt the user for approval.** Present the full draft JSON
and ask: (1) edits? (2) `parallel_with` — sibling WI codes that ran
concurrently (e.g. `GJS-43, GJS-44`)? Defaults `[]`; human-curated.
Use `AskUserQuestion` — never silent-write. User must approve
before step 4.

### 4. Validate against schema

Validate against `EpisodeSchema` (zod source in
`packages/ats-core/src/episode-schema.ts`) before any append.
Required keys surface via `docs/episodes/schema.json`. Method: write
to `/tmp/episode-<wi-code>.json`, run `pnpm --filter @gjs/ats-core
validate:episode /tmp/episode-<wi-code>.json`. On error, print the
output, ask the user to edit, re-validate. Loop until valid.

### 5. Finale flow: append → commit → push → merge → Plane

**Finale mode** performs the merge — one PR carries code + tests +
episode entry. **Idempotency:** before step (b), grep the JSONL for
`pr_url`. If found, the entry was written on a previous (failed)
run — skip (b)-(e), resume at (f). Safely re-runnable after a
transient merge failure.

(a) **Validate** per step 4 (revalidate after edits if re-entered).
(b) **Append.** Resolve `<YYYY-MM>` from `completed_at`. Create file
if absent. Append validated object as one JSON line (newline at end).
(c) `git add docs/episodes/<YYYY-MM>.jsonl`.
(d) **Commit** per `CLAUDE.md § Git` — HEREDOC delimiter `EOF`
(single-quoted), no `Co-Authored-By` trailer:

```bash
git commit -F - <<'EOF'
docs(episodes): record <wi-code>
EOF
```

(e) `git push`.
(f) `gh pr merge <pr-url> --merge --delete-branch`.
(g) `gh pr view <pr-url> --json mergeCommit` — extract `mergeCommit.oid` as `<sha>`.
(h) **Plane `Done`.** Resolve id per `universal.md § 4`; apply guard
per `log-episode.md § 1`; call `mcp__plane__update_work_item(state=<Done id>)`.
(i) **Comment.** Per `log-episode.md § 2`: `[log-episode] Merged: <pr-url> (commit <sha>)`.
(j) `git checkout main && git pull --ff-only`.
(k) `git branch -d <feature-branch>` if local copy still exists.
(l) **Phase-state close.** Rewrite per-task `phase-state.md`:
`status: complete`, `ended_at: <now ISO 8601 UTC>`.

**Standalone** (emergency-only): skip (c)-(g), (j), (k); PR already
merged externally. Run (b) on `main` (user commits manually after),
then (h) Plane `Done` using `<sha>` from `gh pr view --json mergeCommit`,
then (i) comment. No phase-state write.

Print summary: `episode_id`, JSONL path, merge SHA, WI new state,
any drift to `plane-failures.jsonl`.

## Phase tracking

Finale-only: writes per-task `phase-state.md` (schema:
`docs/agents/phase-state-schema.md`) with `phase: log-episode`,
`next_phase: null`, `cycles: 0`, `started_at` set in step 1, `ended_at`
in step 5(l); `status` `in-progress` → `complete` (`failed` on abort).

## Failure handling

Logging and notification follow `universal.md § 7`. Per-operation
rules from `log-episode.md § 4`:

| Operation                            | On failure                                                                              |
|--------------------------------------|-----------------------------------------------------------------------------------------|
| Read WI / comments                   | Continue with partial data; missing fields → `null`                                     |
| Schema validation                    | Loop with user edits until valid; never bypass                                          |
| JSONL append (step b)                | Hard abort; **no merge**, no Plane writes                                               |
| Commit / push (steps d-e)            | Hard abort; **no merge**, no Plane writes                                               |
| `gh pr merge` (step f)               | Episode commit stays on branch; PR open; Plane stays `In Review`; **no forced Done**; user resolves and may re-invoke (idempotent — re-append skipped) |
| State update to `Done`               | Episode log **still written** (canonical); drift logged + WARN comment                  |
| Comment posting                      | Continue (comment is convenience)                                                       |
| Main checkout / `branch -d` (j-k)    | Warn and continue — episode is in git, PR is merged                                     |

On state-update failure, post the WARN comment per `log-episode.md § 2`.
No bootstrap-time validation: misconfigured workspace surfaces via
the failing MCP call's error per `universal.md § 7`.

## What stays out

- **PRD / design / plan creation** — owned by `/research`, `/prd`, `/design`, `/plan`.
- **Multi-WI summaries / batch reports / bulk backfill** — one entry per WI.
- **`/promote-pattern`** and **auto-detecting `parallel_with`** — out of scope.
- **Modifying past episode entries** — JSONL is append-only.
- **Reading raw skill-log transcripts** — only `meta.json` and `events.jsonl` are consumed.

## Language

**Dialogue:** mirror the user's language. **Episode log content and
Plane comments: always English** — read by downstream agents.

## When NOT to use this skill

- PR not yet opened → `/implement-task` opens the PR; run this only after step 6 completes.
- WI has a non-null, non-`gjs:wi:...` `external_id` → foreign system; reconcile manually.
