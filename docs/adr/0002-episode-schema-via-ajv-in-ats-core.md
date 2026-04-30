# ADR-0002 — Episode log schema validation via parasitic ajv in @gjs/ats-core

## Status

Superseded by [ADR-0003](./0003-zod-as-runtime-validation-library.md)

## Context

GJS-14 (Step 1 of `docs/plans/agent-system.md`) introduced the episode
log JSON Schema at `docs/episodes/schema.json`. The plan's "Validation"
gate required runtime validation that the schema accepts the canonical
example at `docs/agents/architecture.md § 9.1`.

The Vitest workspace (`vitest.config.ts` at repo root with the
`projects: [...]` array) only discovers tests inside each project's
`src/**/*.{test,spec}.ts`. The episode schema is not domain-specific to
any package — it's project-wide infrastructure. There was no obvious
home, so we picked `@gjs/ats-core` as the most general "shared library"
and added `ajv ^8.20.0` + `ajv-formats ^3.0.1` to its `devDependencies`
purely to power one test file (`packages/ats-core/src/episode-schema.test.ts`).

`ajv` is unrelated to `@gjs/ats-core`'s actual purpose (vendor-specific
ATS extraction — Greenhouse, Lever, Ashby, SmartRecruiters). No
production code in `packages/ats-core/src/` imports it.

The choice was flagged during code review of PR #29 as worth recording
because it would aggravate as more docs-level schemas accumulate (PRD
template, plan template, etc.) and as Step 9 (`/log-episode`) added
runtime ajv usage at the skill level.

## Decision

(Originally accepted, then immediately reconsidered before merge.)

We placed the episode schema test in `@gjs/ats-core/src/episode-schema.test.ts`
and added `ajv` + `ajv-formats` as devDependencies of `@gjs/ats-core`.

Trigger to revisit was specified as: when ≥3 docs-level schema tests
accumulate, OR when Step 9 (`/log-episode`) lands and adds runtime ajv
usage. At that point we'd extract a dedicated workspace package
(`packages/episode-log/` or `tests/`) with its own deps.

## Consequences

- **Negative — devDependency drift.** `@gjs/ats-core/package.json`
  lists deps that don't reflect its purpose. Future readers see `ajv`
  and assume some extractor uses it; nothing does.
- **Negative — split validator universe.** `apps/web` and `apps/worker`
  already use `zod` (4.x) for runtime validation. Adding `ajv` for
  episode schema fragments the validation library used across packages.
  This was identified by the user during review as a missed consistency
  opportunity.
- **Positive — kept the WI scope small at the time.** No new workspace
  package, no build step for schema generation, one test file
  alongside many existing tests in `@gjs/ats-core/src/`.

## Why this ADR is superseded

The "split validator universe" consequence outweighed the "kept scope
small" benefit. Per [ADR-0003](./0003-zod-as-runtime-validation-library.md),
`zod` is the standard runtime validation library across the project.
The episode schema migrated to a zod schema in `@gjs/ats-core/src/episode-schema.ts`
in the same PR (#29) before merge. `ajv` and `ajv-formats` were
removed.

This ADR is retained as the historical record of the original choice
and the reasoning that replaced it. Future contributors evaluating
"where to put a docs-level schema test" should read this file plus
ADR-0003 together.
