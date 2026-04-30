# Plane Conventions: /log-episode

## 0. Purpose

This module is loaded by the **`/log-episode`** skill — the skill that
records one episode log entry per merged PR and closes the
corresponding Plane Work Item to `Done`. It defines the `Done`
transition guard, comment template, read contract, and failure
recovery specific to `/log-episode`.

Universal Plane conventions (workspace identity, bootstrap, state-name
resolution, general failure policy, comment prefix rule, subagent
rule) live in `universal.md` and are loaded alongside.

The full state machine is in `implement-task.md` § 2; this file
covers only the `Done` transition.

**Authority.** `architecture.md` § 3 > `universal.md` > this file >
`/plane-integration` skill.

## 1. Done transition

| Transition       | From          | To       | Trigger                                |
|------------------|---------------|----------|----------------------------------------|
| PR merged        | `In Review`   | `Done`   | `/log-episode` (after `gh pr merge`)   |

**Transition guard:**

- Expects `In Review`.
- If already `Done`: warn (already closed) and continue (idempotent
  rerun).
- If `In Progress` (rare — PR merged before status update reached
  Plane): warn `"WI <code> was still In Progress when merged; forcing Done"`
  and continue, forcing the transition.
- If `Backlog`, `Todo`, or `Cancelled`: abort the Plane state update
  with `"WI <code> is in unexpected state <name>; manual reconciliation needed"`.
  The episode log entry is **still written** (git is canonical); the
  Plane drift is logged.

State name resolution rule lives in `universal.md` § 4.

## 2. Comment templates

Prefix rule lives in `universal.md` § 5.

| Trigger                                 | Comment text                                                              |
|-----------------------------------------|---------------------------------------------------------------------------|
| PR merged                               | `[log-episode] Merged: <pr-url> (commit <sha>)`                           |
| MCP failure (graceful, recoverable)     | `[log-episode] WARN: state update failed; episode logged in git regardless` |

## 3. Read contract

`/log-episode` reads:

- **Work Item**: `id`, `name`, `state`, `parent`, `external_id`,
  `labels`, `created_at`. Plane does not expose a flat
  `completed_at` field — the merge timestamp comes from
  `gh pr view <pr-url> --json mergedAt` (git is canonical for
  completion time per `architecture.md § 9.6`).
- **Work Item comments**: only those with skill-prefix (filtered by
  text-prefix match), used for cross-checking timing in the episode
  log auto-extracted fields
- Does NOT read: relations (DAG is in plan, not derived from Plane);
  Plane state-history (use `gh pr view` for the merge timestamp)

**Response shaping.** Pass `fields=` and `expand=` parameters to MCP
calls to keep payloads small.

## 4. Failure recovery

Per-operation rules for `/log-episode`. General logging and
notification policy lives in `universal.md` § 7.

| Operation                       | On failure                                                                                                        |
|---------------------------------|-------------------------------------------------------------------------------------------------------------------|
| Read Work Item / comments       | Continue with partial data; missing fields filled with `null` in the episode entry; warning surfaced              |
| State update to `Done`          | Episode log entry **still written** (git is canonical); drift logged; user notified                               |
| Comment posting                 | Continue (comment is convenience)                                                                                 |

The episode log JSONL append is **independent** of any Plane MCP call.
If Plane is fully unreachable, the episode entry is still written;
only Plane-side state remains stale. This is the load-bearing
guarantee that `architecture.md § 9.6` "self-contained reasoning trace"
relies on.
