# Plane Access — REST, MCP, SDKs, Compose

Operational reference for connecting to Plane Cloud. Use when SKILL.md's
short access summary isn't enough.

## REST API

### Base
- Base URL: `https://api.plane.so/`
- All endpoints prefixed `/api/v1/`
- Required reading: `developers.plane.so/api-reference/introduction`

### Auth
- Header: `X-API-Key: <PAT>`
- PAT generation: `app.plane.so` → Profile Settings → Personal Access
  Tokens. Set an expiry.
- The same PAT serves REST (`X-API-Key`) and MCP PAT mode
  (`Authorization: Bearer`). Keep out of version control.

### Rate limits
- **60 requests/minute per API key.**
- Response headers:
  - `X-RateLimit-Remaining` — calls left this window
  - `X-RateLimit-Reset` — UTC epoch seconds until window resets
- Plan for 429 responses with exponential backoff. Easy to saturate
  with bulk agent loops.

### Pagination
- Cursor-based.
- `per_page` defaults to 100 and **caps at 100**.
- Cursor format: `value:offset:is_prev`.
- Response includes: `next_cursor`, `prev_cursor`, `next_page_results`,
  `prev_page_results`, `count`, `total_pages`, `total_results`.

### Response shaping (cuts agent token cost)
- `?fields=id,name,description` — trims payload to listed fields.
- `?expand=assignees,state` — inlines related objects.
- Combine both. Important in agent loops where the default response
  is large.

### Status codes
400, 401, 404, 429, 500, 502, 503, 504. Standard semantics.

### Endpoint URL pattern
```
developers.plane.so/api-reference/<resource>/<action>
```

Resources (canonical names; note `issue` in URLs == "Work Item" in UI):
`project`, `project-features`, `project-labels`, `issue`, `state`,
`label`, `link`, `issue-comment`, `issue-activity`, `issue-attachments`,
`work-item-pages`, `issue-types/types`, `issue-types/properties`,
`issue-types/values`, `issue-types/options`, `cycle`, `module`, `page`,
`intake-issue`, `assets`, `milestones`, `estimate`, `worklogs`, `epics`,
`initiative`, `customer`, `teamspace`, `sticky`, `workspace-features`,
`workspace-invitations`, `members`, `user`.

Actions are typically `overview`, `add-*`, `list-*`, `get-*-detail`,
`update-*`, `delete-*`.

### Three notable endpoints
- `issue/advanced-search-work-items` — richer queries than basic
  list-and-filter; uses PQL.
- `issue-types/properties` + `issue-types/values` — typed custom
  metadata on work items.
- `project-features` + `workspace-features` — toggle features
  programmatically when scripting project setup.

## MCP server (Cloud, hosted)

Reference: `developers.plane.so/dev-tools/mcp-server`. Claude Code
specifics: `developers.plane.so/dev-tools/mcp-server-claude-code`.

### Two transports
- **Browser OAuth** — `https://mcp.plane.so/http/mcp`. Interactive;
  human approves in a browser. For human-in-the-loop agents.
- **PAT mode** — `https://mcp.plane.so/http/api-key/mcp`. Headers:
  `Authorization: Bearer <PAT>` and `X-Workspace-slug: <slug>`. For
  automated pipelines and non-interactive agent traffic.

### Client connection pattern
All Cloud MCP clients use the same shape:
```
npx mcp-remote@latest <url>
```
With an optional `headers` block for PAT mode (provides
`Authorization` and `X-Workspace-slug`).

The Plane docs ship drop-in snippets for Claude.ai, Claude Desktop,
Cursor, VSCode (`.vscode/mcp.json`), Windsurf, and Zed.

### Tool catalog
**Not enumerated in the Plane docs.** Two ways to discover:
1. Connect the server — your MCP client lists available tools.
2. Read the README at `github.com/makeplane/plane-mcp-server`.

All tools use Pydantic models from the Python SDK, so the schema is
consistent with REST.

### Deprecated — do not use
- `npx @makeplane/plane-mcp-server`
- `npm install @makeplane/plane-mcp-server`

The Node.js MCP server is deprecated. The active implementation is
Python + FastMCP. Self-hosted stdio (out of scope here; Cloud-only is
assumed) would be `uvx plane-mcp-server stdio`. **For Cloud, only use
the hosted HTTP endpoints above.**

## SDKs

The page `developers.plane.so/dev-tools/build-plane-app/sdks` is
misleading and shows only OAuth helpers. **READMEs are authoritative.**

### Node
- Repo: `github.com/makeplane/plane-node-sdk`
- npm: `@makeplane/plane-node-sdk` (currently 0.2.x)
- Shape: unified `PlaneClient` with namespaced resources, e.g.
  `client.projects.list()`, `client.projects.create(slug, payload)`.
- Breaking change between 0.1.x and 0.2.x — ignore tutorials predating
  that.

### Python
- Repo: `github.com/makeplane/plane-python-sdk`
- PyPI: `plane-sdk`

### OpenAPI
- **No public spec for Cloud.**
- Self-hosted can generate via
  `python manage.py spectacular --file openapi.yaml` with
  `ENABLE_DRF_SPECTACULAR=1`. Reflects `main` branch and may drift
  from Cloud.
- Effective schema reference: SDK READMEs.

## Plane Compose (declarative bootstrap)

Reference: `developers.plane.so/dev-tools/plane-compose`. Install:
`pipx install plane-compose`.

### When it fits
Spinning up or evolving project structure (work item types, workflows,
states, labels, starter work items) in a repeatable, diffable,
version-controlled way. Examples: provisioning a new project from a
template, templated sprint scaffolding.

### When it does not fit
Per-item ad-hoc operations (create one bug, move one work item).
MCP or REST is lighter for those.

### Two sync modes
- **`plane push`** — additive only. Creates and updates, never deletes.
  **Safe default** when humans and agents share a project.
- **`plane apply`** — declarative with deletions, but only within the
  `apply_scope` declared in `plane.yaml` (e.g., manage only items
  labelled `automated` or with ID prefix `AUTO-`). **Always set scope
  before using `apply`** to avoid wiping human-created work.

### Files
- `plane.yaml` — workspace, project key, defaults.
- `schema/types.yaml` — work item types and fields.
- `schema/workflows.yaml` — state machines.
- `schema/labels.yaml` — label groups.
- `work/inbox.yaml` — work items to sync.
- `.plane/state.json` — auto-managed by the CLI; do not hand-edit.

### Rate limit
Self-throttles to **50 req/min by default** (configurable via
`PLANE_RATE_LIMIT_PER_MINUTE`). Below the 60/min REST cap, leaving
headroom for other integrations sharing the same key.
