# Plane Conventions: Universal

## 0. Purpose

This is the project-wide layer of Plane operational conventions —
the parts that apply to **every** skill writing to or reading from
Plane in `global-job-search`. Skill-specific operations live in
sibling files under `docs/agents/plane/`:

- `tasks.md` — Epic and Work Item creation, naming, labels (consumed by `/tasks`)
- `implement-task.md` — branch naming, status transitions, read contract (consumed by `/implement-task`)
- `log-episode.md` — Done transition, episode read contract (consumed by `/log-episode`)

**Loading rule.** Every Plane-using skill `Read`s this file plus its
own module in its first phase. Other skills and subagents do not load
any of these files.

**Authority.** `architecture.md` § 3 > this file > `/plane-integration`
skill. Architecture is constitution; these files are operationalisation;
the skill is generic technical reference.

## 1. Workspace facts

These identifiers are required by every Plane-writing skill. Resolved
once at startup and cached for the run.

| Item                      | Value                                          |
|---------------------------|------------------------------------------------|
| Workspace slug            | (read from MCP env / `mcp__plane__get_me`)     |
| Project name              | `gjs`                                          |
| Project identifier (key)  | `GJS` (used in WI codes like `GJS-12`)         |
| Project id (UUID)         | `04e5eb31-ae3d-485e-a87e-bb2b857b5267`         |
| GitHub repo (for links)   | `https://github.com/vasd85/global-job-search`  |
| `external_source` value   | `gjs-tasks-skill`                              |

If the project id ever changes (project recreated, migration), this
file must be updated in the same PR that changes Plane state.

## 2. Entity scope (summary)

The project uses Work Items, Epics, work-item relations of type
`blocked_by`, comments, labels, and Plane-managed states. Cycles,
Modules, Pages, Issue Types, Views, Initiatives, Milestones, Intake,
Time Tracking, and Workflows are **not used by convention** — see
`tasks.md` § 1 for the full table and rationale, and § 9 below for
items that may not be reintroduced opportunistically.

## 3. Bootstrap requirements

Before the first `/tasks` run, the project must satisfy this checklist.
Setup is one-time. Every Plane-using skill validates at startup and
aborts with a clear message if the project is not bootstrapped.

**Project feature flags** (set via `mcp__plane__update_project_features`):

| Flag                   | Required value | Reason                                    |
|------------------------|---------------:|-------------------------------------------|
| `epics`                | `true`         | Enables Epic creation                     |
| `modules`              | unchanged      | Not used but feature stays available      |
| `cycles`               | unchanged      | Not used but feature stays available      |
| `pages`                | unchanged      | Not used                                  |
| `intakes`              | `false`        | Not used                                  |
| `work_item_types`      | unchanged      | Workspace-level disabled                  |
| `workflows`            | unchanged      | Not used (skills handle transitions)      |

**Required states** (verified or created via `mcp__plane__create_state`):

| Name           | Group       | Notes                                          |
|----------------|-------------|------------------------------------------------|
| `Backlog`      | `backlog`   | Plane default; default state for new WIs       |
| `Todo`         | `unstarted` | Plane default; not used by skills, kept        |
| `In Progress`  | `started`   | Plane default                                  |
| `In Review`    | `started`   | **Created during bootstrap**                   |
| `Done`         | `completed` | Plane default                                  |
| `Cancelled`    | `cancelled` | Plane default                                  |

**Demo content cleanup.** Plane onboarding pre-seeds the project with
demo Modules, Cycles, Labels, and Work Items. Delete or archive during
bootstrap so analytics and filters are not polluted. Skills are not
expected to handle their presence.

**Bootstrap is manual or one-shot.** No dedicated bootstrap skill is
planned until a second project needs the convention.

## 4. Feature slug

The slug is invariant across PRD, design, plan, Epic, and Work Items.
Defined when `/research` creates the scratchpad:

```
<YYYY-MM-DD>-<topic-kebab-case>
```

The date is today (the day the slug is first created); the topic is
lowercase kebab-case derived from the PRD subject.

The date prefix sorts file listings under `docs/product/`,
`docs/designs/`, `docs/plans/` chronologically by `ls`. The slug is
**invariant** — once chosen, it does not change even if the work spans
multiple days.

Example: `2026-04-29-fix-greenhouse-rate-limit`.

## 5. State name resolution

Skills MUST call `mcp__plane__list_states` at startup and resolve state
ids by case-insensitive name match. Skills MUST NOT hardcode state
UUIDs. If a named state is missing, abort with a bootstrap error
referencing § 3.

## 6. Comment prefix rule

All bot-authored comments are prefixed `[<skill>]` or
`[<skill> step <N>]`. The prefix lets users filter human comments
from skill output and identifies the responsible actor.

Per-skill templates live in the respective module file under
"Comment templates".

Comments are **append-only**. Skills do not edit or delete prior
comments, including their own from earlier runs. Debugging trail
outweighs tidiness.

## 7. Subagents do not call Plane

Subagents (`developer`, `code-reviewer`, etc.) do NOT call Plane MCP
directly. They receive Work Item fields from the calling skill as
plain text in their prompt. Plane writes are concentrated in the
three Plane-using skills (`/tasks`, `/implement-task`, `/log-episode`);
subagents are read-only consumers of context.

## 8. Failure handling — general policy

Plane MCP calls can fail (network, rate-limit `429`, auth, server
`5xx`, missing entity). Skills handle failures deterministically.

**Logging.** On any Plane MCP error, append a JSON object to
`.claude/scratchpads/<feature-slug>/plane-failures.jsonl`:

```json
{
  "timestamp": "<ISO 8601>",
  "skill": "<skill name>",
  "step": "<free-form context>",
  "operation": "<MCP tool name>",
  "error": "<full error message>",
  "recoverable": true
}
```

**User notification.** Skills print to user on every failure:

```
[<skill>] Plane MCP <op> failed: <one-line error>.
See scratchpad plane-failures.jsonl. <recovery hint>.
```

**State drift policy.** Temporary mismatch between git state (source
of truth) and Plane state (mirror) is acceptable WHEN logged and
surfaced. Silent drift is a bug — skills never proceed past a Plane
write failure without writing to `plane-failures.jsonl` and notifying
the user.

**Rate limits (`429`).** Skills back off exponentially with jitter
and retry up to a small bounded number of times before logging as a
failure. Specific timing is a skill-implementation detail; the
convention is "bounded retries with backoff, never silent
forever-loops".

Per-skill recovery rules (which operations abort vs. continue) live
in the respective module file under "Failure recovery".

## 9. Out of scope

The following are intentionally outside Plane usage in this project.
Re-introducing any of them requires updating these convention files
first.

- All entities listed under `tasks.md` § 1 "Not used by convention"
  (Cycles, Modules, Pages, Issue Types, Views, Initiatives, Milestones,
  Intake, Time tracking, Workflow rules, Wiki).
- Plane attachments and uploads — skills do not upload files.
- Worklog entries — time tracking disabled.
- Work-item links to external URLs (separate API resource); GitHub
  URLs are embedded in description and comments instead.
- Plane Activity API and history reads — skills derive event ordering
  from comments and git, not from Plane activity.
- PQL (Plane Query Language) — basic filter parameters on `list_*`
  endpoints suffice.

## 10. Open questions

- **`start_date` / `target_date` on Work Items.** Currently unused.
  Revisit if `/log-episode` analytics need date-based slicing beyond
  `created_at` / `completed_at`.
- **Auto-assignment of WIs.** Currently unassigned at creation.
  Auto-assigning every WI to the project owner adds noise without
  changing solo workflow. Defer.
- **Chunk-id stability across plan reruns.** Convention assumes
  `/plan` preserves chunk ids on rerun. If a future `/plan` rewrites
  ids, `/tasks` rerun will see them as new + cancelled and produce
  drift. Address only if observed.
- **Multiple Plane projects.** Convention is scoped to project `gjs`.
  If a second project ever needs the same setup, factor the bootstrap
  and `external_source` value out of these files into a parameterised
  template.
