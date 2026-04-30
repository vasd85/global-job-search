# Plane Bootstrap (one-time setup)

## 0. Purpose

This file documents the one-time manual setup required for the
project's Plane workspace before any Plane-using skill (`/tasks`,
`/implement-task`, `/log-episode`) is run for the first time.

It is **not loaded by any skill**. Skills do no startup-time
bootstrap validation — if the workspace is misconfigured, MCP calls
will fail naturally, the skill's general failure handling
(`universal.md § 7`) will surface the error, and the user consults
this file manually.

The cost-benefit: holding the table of feature flags and required
states in every Plane-using skill's context, every run, just to
produce a slightly nicer error message on a one-time misconfiguration
is not worth the token spend.

## 1. Project feature flags

Set via `mcp__plane__update_project_features`:


| Flag                   | Required value | Reason                               |
| ---------------------- | -------------: | ------------------------------------ |
| `epics`                | `true`         | Enables Epic creation                |
| `modules`              | unchanged      | Not used but feature stays available |
| `cycles`               | unchanged      | Not used but feature stays available |
| `pages`                | unchanged      | Not used                             |
| `intakes`              | `false`        | Not used                             |
| `work_item_types`      | unchanged      | Workspace-level disabled             |
| `workflows`            | unchanged      | Not used (skills handle transitions) |


## 2. Required states

Verified or created via `mcp__plane__create_state`:


| Name           | Group       | Notes                                      |
| -------------- | ----------- | ------------------------------------------ |
| `Backlog`      | `backlog`   | Plane default; default state for new WIs   |
| `Todo`         | `unstarted` | Plane default; not used by skills, kept    |
| `In Progress`  | `started`   | Plane default                              |
| `In Review`    | `started`   | **Created during bootstrap**               |
| `Done`         | `completed` | Plane default                              |
| `Cancelled`    | `cancelled` | Plane default                              |


## 3. Demo content cleanup

Plane onboarding pre-seeds the project with demo Modules, Cycles,
Labels, and Work Items. Delete or archive during bootstrap so
analytics and filters are not polluted. Skills are not expected to
handle their presence — they filter their own writes by
`external_source = gjs-tasks-skill` for idempotency, so demo items
are simply ignored on read but stay visible in the Plane UI.

## 4. Workspace facts

Identifiers used by every Plane-writing skill — verified during
bootstrap and recorded in `universal.md § 1` (which is the file
skills consult, not this one):


| Item                     | Value                                          |
| ------------------------ | ---------------------------------------------- |
| Workspace slug           | (read from MCP env / `mcp__plane__get_me`)     |
| Project name             | `gjs`                                          |
| Project identifier (key) | `GJS` (used in WI codes like `GJS-12`)         |
| Project id (UUID)        | `04e5eb31-ae3d-485e-a87e-bb2b857b5267`         |
| GitHub repo (for links)  | `https://github.com/vasd85/global-job-search`  |
| `external_source` value  | `gjs-tasks-skill`                              |


If the project id ever changes (project recreated, migration), update
`universal.md § 1` and this file in the same PR.

## 5. When this file is consulted

- One-time setup of the Plane workspace for a new project
- Recovery after a workspace was recreated
- Investigating Plane-side errors when an MCP call fails on what
  looks like a missing state or feature flag

Skills do not read this file. There is no machine-driven validator;
re-running this checklist manually is the protocol.
