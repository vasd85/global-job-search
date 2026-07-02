# ADR-0013 — `profile-tree` lives in a shared `@gjs/profile-tree` package

## Status

Accepted

## Context

The `wipe-and-foundation` cutover (design `2026-05-26-wipe-and-foundation`)
introduces a `profile-tree` module: `CANONICAL_BRANCHES` (the single
source of truth for the preference taxonomy, ADR-0011), the leaf/tree Zod
schemas, and the pure functions (`mutateLeaf`, `moveLeaves`,
`deriveL2Inputs`, `summariseTreeForL3`) plus a `migrateLeaves` DB wrapper.

The design's code samples place this module at
`apps/web/src/lib/profile-tree/`. But the sibling `substrate-cutover`
task needs **both** `apps/web` and `apps/worker` to import from it:

- `apps/worker` seed bootstrap imports `ALL_CANONICAL_BRANCHES`.
- `apps/worker` L3 scoring handler imports `summariseTreeForL3` and
  `PreferenceTreeSchema`.
- `apps/web` filter pipeline imports `deriveL2Inputs`.

The repo has **no apps→apps import precedent** and **no `@/` path alias**
(`tsconfig.base.json` defines no `paths`). Every piece of shared code is
already a `@gjs/*` workspace package resolved via pnpm workspaces +
`package.json` `exports`. Keeping the module in `apps/web` would force the
worker to reach across app boundaries via a non-idiomatic alias the repo
has never used, leaving `index.ts` re-exporting from a location the worker
cannot cleanly resolve. The design's §"ADR drafts" explicitly flagged this
relocation as warranting a fresh ADR (next free slot 0013).

## Decision

We will home the **entire** `profile-tree` module in a new shared
workspace package, **`@gjs/profile-tree`** (`packages/profile-tree/`),
rather than in `apps/web/src/lib/profile-tree/`. The package mirrors the
scaffolding of the existing simple packages (`@gjs/logger`,
`@gjs/ingestion`): ESM `"type": "module"`, `tsconfig` extending
`tsconfig.base.json`, a single-rooted `src/index.ts` entry, and standard
`typecheck`/`lint`/`test` scripts. Its only runtime dependency is `zod`.
Both `apps/web` and `apps/worker` import it idiomatically as
`@gjs/profile-tree`.

To keep the package decoupled and individually green, `migrateLeaves`
takes a minimal structural `Database` interface (raw-SQL execution)
instead of importing `@gjs/db` or `drizzle-orm`, so the package typechecks
before the `preference_tree` column exists. `substrate-cutover` adapts the
real drizzle `Database` to that interface when it wires `migrateLeaves`
in.

## Consequences

- `substrate-cutover` adds `@gjs/profile-tree` as a `workspace:*`
  dependency on both `apps/web` and `apps/worker` and imports the shared
  surface from it — no `@/` alias, no apps→apps import.
- A new vitest project (`packages/profile-tree/vitest.config.ts`) is
  registered in the root `vitest.config.ts`.
- `index.ts` stays single-rooted: the whole public surface re-exports from
  one package root, avoiding a split where some files live in `@gjs/*` and
  others in `apps/web`.
- The package is purely additive and lands green on its own before the
  destructive migration depends on it, de-risking the cutover.
- A future move of `migrateLeaves` to consume `@gjs/db` directly (rather
  than the structural `Database` interface) remains possible; the
  interface is the seam that keeps this package zod-only today.
