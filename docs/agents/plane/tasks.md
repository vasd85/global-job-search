# Plane Conventions: /tasks

## 0. Purpose

This module is loaded by the **`/tasks`** skill — the only skill that
creates Plane entities. It defines what entities are used, the
hierarchy, naming, schemas, labels, and `/tasks`-specific failure
recovery and comment templates.

Universal Plane conventions (workspace identity, bootstrap, state-name
resolution, general failure policy, comment prefix rule) live in
`universal.md` and are loaded alongside this file.

**Authority.** `architecture.md` § 3 > `universal.md` > this file >
`/plane-integration` skill.

## 1. Entity scope

The project uses a deliberate subset of Plane's entity model.

**Used:**

- **Work Items** — atomic tasks; one per chunk in plan DAG; one per PR
- **Epics** — one per feature; container of Work Items
- **Labels** — taxonomy for filtering (§ 6)
- **Work Item relations** of type `blocked_by` — encode plan DAG
- **Work Item comments** — state-transition audit trail and error reports
- **Work Item state** — lifecycle owned by Plane (see `implement-task.md` § 2)

**Not used by convention** (feature flags may be on; skills do not
write or read these):

- **Cycles** — no sprint cadence in solo workflow. Skills neither
  create cycles nor add WIs to them.
- **Modules** — taxonomy deferred. Repository module boundaries are
  in flux and accumulating implementation experience comes first;
  fixing a Plane-side taxonomy too early creates rework. Revisit
  once boundaries stabilise.
- **Pages** — `architecture.md § 3` is explicit: Plane does not store
  documents. PRDs, designs, plans, ADRs all live in git under `docs/`.
  Skills never publish to Pages.
- **Issue Types and custom Properties** — workspace feature
  `work_item_types` is disabled; revisit only if typed work items
  become useful (would need to enable at workspace level first).
- **Views** — ad-hoc filtering via MCP `list_work_items` filters
  suffices; no need to materialise saved Views.
- **Initiatives** — disabled at workspace level; cross-project scope
  unnecessary for a single project.
- **Milestones** — solo workflow has no need for project-level dated
  checkpoints.
- **Intake** — disabled; external requests, if any, land in GitHub
  Issues.
- **Time tracking** — disabled.
- **Workflow rules** — disabled; skills handle transitions explicitly.
- **Wiki** — workspace-level feature, not used.

## 2. Hierarchy and granularity

The hierarchy is exactly two levels:

```
Feature  (one PRD + one plan + one Epic in Plane)
  └── Chunk  (one row in plan DAG = one Work Item = one PR)
```

**Epic.** One per feature. A feature is one PRD/(optional design)/plan
triplet under `docs/`.

**Work Item.** One per chunk in `docs/plans/<slug>.md`'s DAG. One Work
Item maps to exactly one PR. Atomic — if a chunk needs splitting during
implementation, file a follow-up Work Item under the same Epic rather
than expanding scope of the current one.

**No sub-Epics.** If a feature is large enough to need a sub-feature
breakdown, split it into multiple PRDs (and thus multiple Epics) at
planning time, not at execution time.

**No parent Work Item beyond Epic.** The Plane `parent` field on a
Work Item points only to its Epic. Skills assume flat structure under
Epic both when writing (create only siblings) and when reading (the
immediate parent is the Epic).

Plane natively supports sub-issues, but this convention does not use
them, for four reasons:

1. **One axis for inter-WI structure.** Dependencies live exclusively
   in `blocked_by` relations (§ 5), derived from the plan DAG. Adding
   parent-child as a second axis forces drift.
2. **1 WI = 1 PR = 1 merge.** Load-bearing invariant of the episode
   log (`architecture.md § 9`). Nested WIs invite Plane entities that
   are not separate PRs, breaking the 1:1:1 mapping.
3. **`plane_epic_id` is one hop up.** The episode log derives the
   Epic id from the WI's `parent` in a single hop. Nesting forces
   upward traversal — extra code path for a case we explicitly do not
   want.
4. **Idempotent reconciliation.** `/tasks` matches WIs by `external_id`
   regardless of tree position. Nesting introduces a "WI moved between
   parents" reconciliation case that has no business reason here.

If implementation reveals a chunk is too large, file a sibling Work
Item under the same Epic, not a child Work Item.

## 3. Naming

Feature slug rule lives in `universal.md` § 4 — invariant across PRD,
design, plan, Epic, Work Items.

**Epic name.** The H1 / title of `docs/product/<slug>.md`. Human-
readable, no slug prefix, no namespace. Example:
`Fix Greenhouse rate-limit handling`.

**Work Item name.** The title of the corresponding chunk in
`docs/plans/<slug>.md`. Human-readable, no slug or epic prefix —
Plane shows the parent Epic in its UI. Example:
`Add exponential backoff to Greenhouse extractor`.

**Branch name** is set by `/implement-task`; see `implement-task.md`
§ 1.

**Comment prefix rule** lives in `universal.md` § 6.
`/tasks`-specific templates in § 7 below.

**Label format** — see § 6.

## 4. Entity schemas

### 4.1 Epic

Required fields when creating an Epic:

| Field             | Value                                                |
|-------------------|------------------------------------------------------|
| `name`            | per § 3                                              |
| `description_html`| from template below (rendered from markdown)         |
| `external_id`     | `gjs:epic:<feature-slug>`                            |
| `external_source` | `gjs-tasks-skill`                                    |
| `parent`          | none (Epics have no parent)                          |
| `labels`          | `feature:<slug>` only                                |
| state             | project default (`Backlog`)                          |

**Description template (markdown):**

```markdown
## Source documents
- PRD: <github-blob-link to docs/product/<slug>.md on main>
- Design: <github-blob-link to docs/designs/<slug>.md on main>
  <!-- omit row if no design phase ran -->
- Plan: <github-blob-link to docs/plans/<slug>.md on main>
- Feature slug: `<slug>`

## Goal
<one paragraph; lifted from PRD § 1 / elevator pitch>

## Scope
- In: <bulleted list, lifted from PRD>
- Out: <bulleted list, lifted from PRD>
```

The Epic description does not list child Work Items. Plane's Epic
view already renders them with live state, and the plan in git is the
canonical source for the DAG. Skills do not duplicate either.

**Idempotency.** `/tasks` looks up the Epic by
`external_source = gjs-tasks-skill` AND
`external_id = gjs:epic:<feature-slug>`. If found, fields are updated;
no duplicate is created. If not found, the Epic is created.

### 4.2 Work Item

Required fields when creating a Work Item:

| Field             | Value                                                |
|-------------------|------------------------------------------------------|
| `name`            | per § 3                                              |
| `description_html`| from template below                                  |
| `external_id`     | `gjs:wi:<feature-slug>:<chunk-id>`                   |
| `external_source` | `gjs-tasks-skill`                                    |
| `parent`          | id of the Epic for this feature                      |
| `labels`          | `type:<task-type>` and `feature:<slug>` (§ 6)        |
| `state`           | project default (`Backlog`)                          |
| `priority`        | `none` (deferred; user adjusts manually)             |
| `assignees`       | empty at creation (solo project)                     |

Skills do not set `start_date`, `target_date`, or `estimate_point`.

**Description template (markdown):**

```markdown
## Plan reference
- Plan section: <github-blob-link to docs/plans/<slug>.md#chunk-<id>>
- Chunk id: `<chunk-id>`
- Feature: `<slug>`
- Parent Epic: see Plane sidebar (`<epic-code>`)

## Goal
<one paragraph; what this chunk produces; lifted from plan>

## Acceptance criteria
- [ ] <copied verbatim from plan's chunk>
- [ ] ...

## Files (expected)
- <path>
- ...
<!-- omit section if plan does not declare files for this chunk -->
```

**Idempotency.** `/tasks` looks up Work Items by
`external_source = gjs-tasks-skill` AND
`external_id = gjs:wi:<feature-slug>:<chunk-id>`.

- Found → update fields (name, description, labels, parent).
- Not found → create.
- Plan rerun removes chunk → corresponding WI is moved to `Cancelled`
  with comment `[tasks] Chunk removed from plan in <commit-sha>`.
  Never deleted.

## 5. Work Item relations

Each Work Item declares its dependencies via `blocked_by` relations.
`/tasks` materialises them from the plan DAG:

- For each chunk with `depends_on: [a, b, c]` in plan, three relations
  of type `blocked_by` are created on the corresponding WI.
- On rerun, missing relations are added; relations whose target chunk
  no longer depends are removed.
- Other relation types (`relates_to`, `duplicate`, `start_after`, etc.)
  are not used by skills. If a user adds them manually, skills
  preserve them — neither read nor remove.

`mcp__plane__create_work_item_relation` is the API. Note the relation
is directional: created **on the blocked WI**, pointing **to its
blockers**.

## 6. Labels

Two label namespaces are defined and applied automatically. Any other
labels (added manually by the user) are preserved unchanged.

| Namespace          | Values                                                                         | When applied                                  |
|--------------------|--------------------------------------------------------------------------------|-----------------------------------------------|
| `type:*`           | `type:feat`, `type:fix`, `type:refactor`, `type:chore`, `type:docs`, `type:test` | One per WI; from chunk's `task_type` in plan |
| `feature:<slug>`   | one new label per feature                                                      | Every WI of that feature; also on the Epic    |

`/tasks` creates these labels on demand if they do not exist. Color
assignment:

- `type:*` — stable color per type (e.g. green `feat`, red `fix`);
  chosen once and reused. Color values are an implementation detail
  of `/tasks`, not part of this convention.
- `feature:*` — generated from a hash of the slug (stable across
  reruns).

If a user manually edits a label's color in Plane UI, skills do not
overwrite it on rerun.

**Other namespaces deferred.** `module:*`, `package:*`, `area:*`,
`vendor:*` are intentionally not defined. They become candidates once
the repository's module boundaries stabilise (§ 1, "Modules").

## 7. Comment templates

Prefix rule (`[<skill>]`) lives in `universal.md` § 6.

| Trigger                                 | Comment text                                                                                |
|-----------------------------------------|---------------------------------------------------------------------------------------------|
| Reconciliation (chunk removed)          | `[tasks] Chunk removed from plan in <commit-sha>; moved to Cancelled`                       |
| MCP failure (graceful, recoverable)     | `[tasks] WARN: <op> failed (<error>); state may drift — manual fix or skill rerun required` |

Other skills' templates live in their respective module files.

## 8. Failure recovery

Per-operation rules for `/tasks`. General logging and notification
policy lives in `universal.md` § 8.

| Operation                       | On failure                                                                              |
|---------------------------------|-----------------------------------------------------------------------------------------|
| Epic create                     | Abort entire run; user reruns after triage                                              |
| Work Item create                | Continue with remaining WIs; report partial; rerun reconciles via idempotency (§ 4.2)   |
| Relation create                 | Continue; missing relations logged; rerun reconciles                                    |
| Label create                    | Continue without that label; comment on first affected WI                               |
| Bootstrap validation            | Abort with `"Bootstrap incomplete: <reason>; see plane/universal.md § 3"`               |
