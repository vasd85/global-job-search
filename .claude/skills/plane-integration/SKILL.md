---
name: plane-integration
description: >-
  Plane.so entity map, selection rules, REST API + MCP access endpoints,
  and external-doc routing rules for agents that read or write Plane data.
  TRIGGER when: an agent needs to read or write PRDs, work items, issues,
  cycles, modules, epics, sprints, pages, initiatives, milestones, intake,
  or views in Plane; the user mentions Plane.so, plane.so URLs, app.plane.so,
  api.plane.so, or mcp.plane.so; an agent flow needs to publish a doc to
  Plane, plan work in Plane, or fetch context from Plane work items; the
  user asks
  "where does the PRD go in Plane", "how do I model this in Plane",
  "Cycle vs Module vs Epic", "fetch this work item from Plane",
  "publish PRD to Plane", "break PRD into tasks in Plane".
  SKIP when: the question is about local repo files (markdown docs,
  source code, config), about other PM tools (Linear, Jira, Asana,
  GitHub Issues, Notion, Trello), or about general project-management
  theory unrelated to Plane.
---

# Plane Integration

Reference map for agents driving Plane.so Cloud. Teaches the entity model,
which entity to pick for a given job, and where to look in Plane's docs.

This skill is a **map**, not a project-specific playbook. It does not
prescribe how a particular project organizes its Plane workspace.

## What Plane is

A workspace contains projects. Each project has its own members, states,
labels, and feature toggles. Inside a project, the second-tier concepts
are **Pages** (docs), **Work Items** (a.k.a. issues — the task primitive),
**Cycles** (sprints), **Modules** (feature groups), **Epics** (hierarchical
parents), **Initiatives** (cross-project), and **Milestones** (dated
checkpoints).

Terminology: **"Issue" and "Work Item" are the same thing.** URL paths
(`/issues/`, `issue-comment`) use the older term; the UI uses "Work Item".
Treat them as synonyms when reading docs or building API URLs.

## Use-case routing — pick the right entity

| I need to... | Use |
|---|---|
| Publish a PRD or design doc | **Page** (project Page; nestable; supports `@`-mentions to work items; supports "convert selected text to work item") |
| Capture a unit of work | **Work Item** |
| Group child work items under a hierarchical parent | **Epic** |
| Group work items by feature (no time box) | **Module** |
| Time-box a batch of work items (sprint) | **Cycle** |
| Span work across multiple projects strategically | **Initiative** |
| Mark a project-level dated checkpoint | **Milestone** |
| Group projects by team | **Teamspace** |
| Triage incoming external requests | **Intake** |
| Save a filtered query | **View** (use PQL for complex filters) |
| Attach typed metadata to work items | **Issue Types + custom Properties** (do not stuff into description text) |

A work item can belong to a **Cycle and a Module simultaneously** — they
are not mutually exclusive.

## Disambiguation — the most common mistakes

### Cycles vs Modules vs Epics

This is the most-confused trio. Picking the wrong one forces a painful
migration later.

- **Cycle** — time-boxed iteration with start and end dates. Sprints.
- **Module** — feature-based group with no time box. "Auth", "Billing".
- **Epic** — large work item containing child work items. Hierarchical
  parent, not a grouping construct.

Cycles and Modules are orthogonal — one work item, both at once is fine.
Epics are vertical (parent/child); Cycles and Modules are horizontal
(membership).

### Pages vs Wiki vs work-item Pages

- **Pages** — project-level docs, nestable, with `@`-mentions and
  bidirectional links to work items. PRDs go here.
- **Wiki** — the project knowledge-base view layered over Pages.
- **work-item Pages** — per-issue page attachments, scoped to a single
  work item.

PRDs typically go to project Pages, not Wiki.

## Workflow patterns

Common shapes that map an agent task onto Plane entities. Apply the
pattern when the task fits the shape, regardless of which skill or flow
drives the call. The caller decides which pattern applies; this skill
only describes the destination.

- **Producing a research, design, or specification doc** → publish as a
  **Page** in the relevant project. Consider nesting under a parent
  page (a "PRDs" or "Specs" hub) when several siblings will accumulate.
- **Decomposing a doc into executable work**:
  - Create an **Epic** that references the source Page via `@`-mention,
    so the back-link is bidirectional.
  - Add child **Work Items** under the Epic.
  - Tag with a **Module** if the work belongs to a feature area that
    outlives any single iteration.
  - Add to a **Cycle** if the work is time-boxed (sprint).
  - Use Pages' "convert selected text to work item" when chunking the
    doc into tasks — it preserves the back-link automatically.
- **Fetching context to implement, test, or review a work item** → read
  the work item (description, state, labels, custom properties), its
  comments, linked Pages, parent Epic, and any cross-linked issues.
  Use response shaping (`fields=`, `expand=`) to keep payloads small
  in agent loops.
- **Triaging incoming external requests** → land them in **Intake**
  first; promote to a Work Item only after acceptance.
- **Tracking a strategic body of work that spans projects** → use an
  **Initiative**; for a project-level dated checkpoint, use a
  **Milestone**.

## Access — the short version

Full operational detail in [references/access.md](references/access.md).

- **REST**: base `https://api.plane.so/`, prefix `/api/v1/`.
- **Auth**: `X-API-Key: <PAT>` header. PAT from `app.plane.so` → Profile
  Settings → Personal Access Tokens. Same PAT serves REST and MCP.
- **MCP server (Cloud, hosted, PAT mode)**:
  `https://mcp.plane.so/http/api-key/mcp` with headers
  `Authorization: Bearer <PAT>` and `X-Workspace-slug: <slug>`. The
  access path for automated/non-interactive agents. Wiring the MCP
  server in your client is a separate task, **not** covered by this
  skill.
- **Rate limit**: 60 requests/minute per PAT.

## External docs routing rules

When deciding which Plane doc to consult, follow this priority:

1. **Conceptual** question about entities or correct choice between them
   → `docs.plane.so/core-concepts/*` or
   `docs.plane.so/introduction/core-concepts`.
2. **"How do I do X programmatically"** → `developers.plane.so/api-reference/<resource>/<action>`.
3. **MCP setup** or client-specific connection
   → `developers.plane.so/dev-tools/mcp-server`, plus
   `mcp-server-claude-code` if the client is Claude Code.
4. **Declarative project bootstrap or templates**
   → `developers.plane.so/dev-tools/plane-compose`.
5. **Auth, rate limits, pagination, error codes**
   → `developers.plane.so/api-reference/introduction`.
6. **"What does the SDK actually expose"** → the GitHub READMEs at
   `github.com/makeplane/plane-node-sdk` and
   `github.com/makeplane/plane-python-sdk`. **Not** the docs page —
   the docs SDK page is misleading.

If a question falls outside these six rules, it is likely out of scope
for this integration. Do not search further; flag the gap to the user.

## Known gotchas

- Project-level feature toggles can block API calls. Creating a Cycle
  fails if Cycles are disabled in project settings. Same for Modules,
  Pages, Intake, time tracking. Check `project-features` before assuming.
- The Node MCP server (`@makeplane/plane-mcp-server` on npm) is
  **deprecated**. Use the hosted Cloud MCP endpoints. The active server
  is Python + FastMCP.
- The SDK docs page at `developers.plane.so/dev-tools/build-plane-app/sdks`
  shows only OAuth helpers and is misleading. Treat the GitHub READMEs as
  authoritative.
- No public OpenAPI spec for Cloud. Self-hosted can generate one but it
  reflects `main` and may drift from Cloud.
- Plane has its own query language (**PQL**) for advanced filtering.
  Basic list-and-filter is enough for most agent reads.

## Pointers

- Full entity reference: [references/data-model.md](references/data-model.md)
- Full REST + MCP + SDK + Compose detail: [references/access.md](references/access.md)

## Out of scope

Do not grow this skill into the following — each is a separate concern:

- **A specific project's organization of Plane** (which Modules exist,
  naming conventions, sprint cadence, label taxonomy). That's a
  project-level decision, not a property of Plane itself.
- **MCP server configuration** (adding to `.mcp.json` / `settings.json`,
  storing the PAT, restart instructions). Separate task.
- **Wiring specific agent flows to Plane** (e.g., teaching a research
  skill to publish a Page, a planning skill to create Epics, or a
  review skill to fetch work-item context). Each consuming flow defines
  its own Plane interaction; this skill only describes the destination
  shapes.
- Self-hosting, OAuth app development, webhooks, imports, marketing
  content, Plane-native `@`-mention agents.
