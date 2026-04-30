# ADR-0003 — Use zod as the project's runtime validation library

## Status

Accepted

## Context

`zod ^4.3.6` is already used across the project for runtime validation:

- `apps/web/src/lib/llm/preference-llm.ts` — LLM structured output
- `apps/web/src/lib/chatbot/state.ts`, `chatbot/schemas.ts` — chatbot I/O
- `apps/web/src/lib/search/schemas.ts` — search query parsing
- `apps/worker/src/lib/discover-companies-schema.ts` — AI-discovery output
- `apps/worker/src/lib/scoring-schema.ts` — scoring algorithm I/O

Pattern in those files: schema definition + `z.infer<typeof X>`-derived
TypeScript types in the same file, schema as the single source of truth
for both shape and types.

In GJS-14 (Step 1 of `docs/plans/agent-system.md`) we initially
introduced `ajv` + `ajv-formats` as the validator for
`docs/episodes/schema.json`, motivated by the architecture and plan
literally naming "ajv (or equivalent jsonschema check)" as the
validation gate. This was a missed-consistency mistake — see
[ADR-0002](./0002-episode-schema-via-ajv-in-ats-core.md) for the
historical context.

The episode log entry shape (`docs/agents/architecture.md § 9.1`) is
consumed entirely by TypeScript code: `/log-episode` (skill, Step 9 of
the plan), future analytics readers, and the Vitest test suite. There
are no foreseen non-Node consumers. The "language-agnostic JSON Schema"
benefit that ajv-as-validator preserves is hypothetical for this
project.

`zod 4` ships `z.toJSONSchema(schema)` natively, which produces a draft
2020-12 JSON Schema document equivalent in semantics to the zod
definition. The committed `docs/episodes/schema.json` can therefore
remain a real, greppable artefact while the zod source is the
source of truth.

## Decision

`zod` is the project-wide runtime validation library. New schemas are
written as zod schemas and corresponding TypeScript types are derived
via `z.infer<typeof Schema>` in the same file. Any feature requiring
runtime shape validation (request bodies, LLM outputs, JSONL entries,
configuration, etc.) defaults to zod.

When a raw JSON Schema document is required for documentation, external
tooling, or grep-based discovery, generate it from the zod source via
`z.toJSONSchema()` and commit the generated file alongside the zod
source. The zod source is always authoritative; the generated JSON
Schema is a derived view. A drift-detection test asserts that the
committed JSON matches the freshly-generated output, so a missed
regeneration fails CI rather than silently propagating a stale view.

The first application of this decision is the episode log schema:
`packages/ats-core/src/episode-schema.ts` (zod source) →
`docs/episodes/schema.json` (generated) — landed in PR #29.

## Consequences

- **Positive — single source of truth.** Schema and TS types come from
  one definition; no drift between `interface Episode` and a separate
  JSON Schema.
- **Positive — consistent validator across packages.** No more
  fragmented `ajv` here / `zod` there decisions per package.
- **Positive — better developer ergonomics.** Typed errors via
  `result.error.issues[]`, structured `path`/`code` fields stable
  across zod minor versions.
- **Negative — zod becomes a real `dependency` (not devDependency)
  of `@gjs/ats-core`.** Any package importing the episode schema
  pulls zod transitively. Acceptable: zod is small, already in the
  workspace, and ats-core is the canonical shared library.
- **Negative — generated artefact requires a regen step.** Editing
  the zod schema without running `pnpm --filter @gjs/ats-core gen:episode-schema`
  produces drift between TS source and committed JSON. Mitigation: a
  Vitest test compares freshly-generated output to the committed file;
  CI catches forgotten regenerations.
- **Negative — JSON Schema consumers must accept whatever shape
  `z.toJSONSchema()` emits.** zod's emitted shape may differ from a
  hand-written equivalent (different `$defs` factoring, different
  metadata key ordering). Documented at the top of the generated
  `docs/episodes/schema.json` so external readers don't try to
  reverse-engineer the formatting.
- **Neutral — language-agnostic JSON Schema is preserved as an
  artefact, not as the source.** External tools that consume
  `docs/episodes/schema.json` directly continue to work.
