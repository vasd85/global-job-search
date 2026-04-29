# Plane Data Model — Full Entity Reference

Detailed reference for every Plane entity an agent might read or write.
Grouped by tier. Use this when SKILL.md's quick routing table isn't
specific enough.

Canonical conceptual docs live at `docs.plane.so/core-concepts/*`. URL
links below point to the relevant section.

## Container tier

### Workspace
Top container. Typically one per team or company. Holds projects,
members, billing.
- Doc: `docs.plane.so/core-concepts/workspaces/overview`

### Project
Lives inside a workspace. Has its own members, states, labels, and
**feature toggles** (cycles, modules, views, pages, intake, time
tracking can be enabled/disabled per project).
- API call to create a Cycle fails if Cycles are disabled in that
  project. Always check `project-features` before scripting.
- Doc: `docs.plane.so/core-concepts/projects/overview`

### Teamspace
Groups projects by team. Useful for navigation, not a permission
boundary by itself.
- Doc: `docs.plane.so/core-concepts/workspaces/teamspaces`

## Work tier

### Work Item (= Issue)
The task primitive. URL paths use `issue/`; UI calls them "Work Items".
Synonymous.

Built-in attributes:
- **States** — configurable state machine per project.
- **Labels** — per-project tagging.
- **Estimates** — story points or t-shirt sizes when enabled.
- **Time tracking / worklogs** — when enabled.
- **Links** — outbound URLs.
- **Comments** — threaded discussion.
- **Attachments** — file uploads.

What it's NOT for: hierarchical parent grouping (use Epic), feature
grouping (use Module), or time-box grouping (use Cycle).

- Doc: `docs.plane.so/core-concepts/issues/overview`,
  `.../issues/properties`, `.../issues/states`, `.../issues/labels`,
  `.../issues/estimates`, `.../issues/time-tracking`

### Issue Types and custom Properties
Define custom work-item types (Bug, Story, Spike) with typed custom
fields (text, number, date, dropdown). **This is where domain-specific
metadata lives** — do not stuff it into the description.

- Doc: `docs.plane.so/core-concepts/issues/issue-types`

## Grouping tier — the easy-to-confuse trio

| Entity | Time box? | Hierarchy? | Use for |
|---|---|---|---|
| **Cycle** | Yes (start + end dates) | No (membership) | Sprints, iterations |
| **Module** | No | No (membership) | Feature areas: Auth, Billing |
| **Epic** | No | Yes (parent → children) | Large body of work split into child items |

A single work item can be in **a Cycle and a Module simultaneously**.
An Epic contains other work items (parent/child).

What each is NOT for:
- A Cycle is not a feature group. Don't put "Auth" in a Cycle.
- A Module is not a sprint. Modules don't end.
- An Epic is not a tag. Don't make an Epic for "Frontend".

Switching after the fact is painful — pick correctly the first time.

- Cycles: `docs.plane.so/core-concepts/cycles`
- Modules: `docs.plane.so/core-concepts/modules`
- Epics: `docs.plane.so/core-concepts/issues/epics`

## Strategic tier

### Initiative
Cross-project, strategic scope. "Q3 platform reliability initiative"
spanning the API, infra, and frontend projects.
- Doc: `docs.plane.so/core-concepts/projects/initiatives`

### Milestone
Project-level dated checkpoint. "1.0 launch", "Beta closed".
Lighter-weight than an Initiative.
- Doc: `docs.plane.so/core-concepts/projects/milestones`

## Knowledge tier

### Page (project Pages)
Project-level docs. Key features:
- **Nestable** — pages can have parent and child pages.
- **`@`-mention** to work items, with bidirectional links.
- **Convert selected text to work items** — turns a paragraph into a
  linked Work Item, preserving the back-reference.
- Project-scoped (not workspace-scoped).

PRDs and design docs go here.
- Doc: `docs.plane.so/core-concepts/pages/overview`

### Wiki
A view layered over project Pages — the project knowledge base
presentation. Same underlying data as Pages.
- Doc: `docs.plane.so/core-concepts/pages/wiki`

### Work-item Pages
Per-issue page attachments, scoped to a single work item. For notes
specific to that issue. Not the same as project Pages.

### Stickies
Lightweight personal notes. Niche; not for shared knowledge.
- Doc: `docs.plane.so/core-concepts/stickies`

## Inbound tier

### Intake
Triage queue for incoming requests (forms, emails, customer reports).
Items here are pending acceptance into the project. Useful for agents
that act on external submissions.
- Doc: `docs.plane.so/intake/overview`

### Customer
Links a work item to an external requestor. Useful when issues need
back-channel communication or SLA tracking.
- Doc: `docs.plane.so/customers`

## Query tier

### View
Saved filtered query over work items. Reusable list configurations.
- Doc: `docs.plane.so/core-concepts/views`

### PQL (Plane Query Language)
Plane's query syntax for filtering work items in views and the
advanced search endpoint. Read this before building complex filters.
- Doc: `docs.plane.so/core-concepts/issues/plane-query-language`

## Process tier

Two distinct features that are often conflated:

### Workflows and approvals
Configuration-level governance over **state transitions** and
**who approves them**. Defines the rules ("only Lead can move from
Review to Done").
- Doc: `docs.plane.so/workflows-and-approvals/workflows`

### Automations
Rule-based actions triggered by events ("when state changes to Done,
assign to QA lead"). **Check Automations before building agent logic
for common patterns** — some agent behaviour is better expressed as a
native Automation than scripted from outside.
- Doc: `docs.plane.so/automations/custom-automations`

Workflows = governance of transitions. Automations = side effects on
events. Different layers.
