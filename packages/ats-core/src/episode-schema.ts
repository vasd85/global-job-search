import { z } from "zod";

/**
 * Episode log entry shape — one JSON object per line in
 * `docs/episodes/<YYYY-MM>.jsonl`. One entry corresponds to one
 * Work Item / one PR / one merge.
 *
 * Source of truth for both runtime validation and TypeScript types.
 * The committed `docs/episodes/schema.json` is generated from this
 * file via `z.toJSONSchema()` (see `scripts/gen-episode-schema.ts`
 * and `pnpm --filter @gjs/ats-core gen:episode-schema`).
 *
 * Schema sourced from `docs/agents/architecture.md § 9.1`.
 * `schema_version` is pinned via `z.literal(1)` — bump it (and the
 * literal) on incompatible shape changes; never break existing grep
 * contracts (per `docs/plans/agent-system.md § 6` cross-cutting
 * risks).
 *
 * Root behaviour: zod's default (`.strip()`) accepts unknown keys
 * without error. This matches the original ajv schema's
 * `additionalProperties: true` at root, allowing future fields to
 * land forward-compatibly within the same `schema_version`. Nested
 * entry shapes use `.strict()` so typos like
 * `decisions[].confidance` fail validation loudly.
 */

const reviewVerdict = z.enum(["approved", "changes-required"]);

const reviewEntrySchema = z
  .object({
    cycles: z
      .number()
      .int()
      .min(0)
      .describe(
        "Number of writer/reviewer cycles before approval. 1 = approved on first review; 2 = one round of changes-required.",
      ),
    verdict: reviewVerdict.describe(
      "Final reviewer verdict at episode close.",
    ),
    critical_findings_addressed: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "Number of Critical findings the writer addressed across all cycles. Optional.",
      ),
  })
  .strict();

const decisionEntrySchema = z
  .object({
    what: z
      .string()
      .min(1)
      .describe("The chosen approach, in one sentence."),
    why: z
      .string()
      .min(1)
      .describe("The justification — why this beat the rejected alternatives."),
    rejected: z
      .array(z.string())
      .describe(
        "Alternatives considered and not taken, each with a brief reason.",
      ),
    confidence: z
      .string()
      .min(1)
      .describe(
        "Confidence label. Recommended vocabulary per architecture § 9.3: \"verified\" (backed by tests or production metric) or \"provisional\" (works, but not proven optimal). Left as a free string for now; tighten via schema_version bump if the vocabulary stabilises.",
      ),
  })
  .strict();

const blockerEntrySchema = z
  .object({
    what: z
      .string()
      .min(1)
      .describe("What blocked progress, in one sentence."),
    resolution: z
      .string()
      .min(1)
      .describe(
        'How the blocker was cleared (or "abandoned" / "deferred").',
      ),
    duration_min: z
      .number()
      .min(0)
      .describe("Wall-clock minutes lost to this blocker."),
    tag: z
      .string()
      .min(1)
      .describe(
        "Short topical tag. See architecture § 9.3 for recommended vocabulary (external-api, tooling, requirement-unclear, flaky-test, env-config, local-context-mismatch, over-decomposition).",
      ),
  })
  .strict();

const deadEndEntrySchema = z
  .object({
    tried: z.string().min(1).describe("The approach attempted."),
    why_failed: z
      .string()
      .min(1)
      .describe(
        "Why it didn't work, in enough detail to deter future re-attempts.",
      ),
  })
  .strict();

const reviewsSchema = z
  .object({
    prd: reviewEntrySchema.optional(),
    design: reviewEntrySchema.optional(),
    plan: reviewEntrySchema.optional(),
    code: reviewEntrySchema.optional(),
  })
  .strict()
  .describe(
    "Per-phase reviewer telemetry. Keys are optional; an absent key means that reviewer did not run for this episode.",
  );

export const EpisodeSchema = z
  .object({
    schema_version: z
      .literal(1)
      .describe(
        "Schema version for forward-compat migrations. Bump on incompatible shape changes; never break existing grep contracts.",
      ),
    episode_id: z
      .string()
      .min(1)
      .describe(
        "Stable id of the form <YYYY-MM-DD>-<feature-slug>-<task-id>.",
      ),
    feature_slug: z
      .string()
      .min(1)
      .describe(
        "Kebab-case slug for the parent feature; matches docs/product/<slug>.md when present.",
      ),
    task_id: z
      .string()
      .min(1)
      .describe("Plane Work Item code (e.g. GJS-42)."),
    task_type: z
      .enum(["feat", "fix", "refactor", "chore", "docs", "test"])
      .describe(
        'Conventional Commits type. Must stay in sync with CLAUDE.md "Git" section and docs/agents/plane/tasks.md § 6.',
      ),
    status: z
      .enum(["merged"])
      .describe(
        'Terminal episode status. Episodes are only logged after PR merge, so the only value emitted today is "merged". Future statuses (e.g. "abandoned") would require a schema_version bump.',
      ),
    started_at: z
      .iso
      .datetime()
      .describe(
        "ISO 8601 UTC timestamp; first scratchpad write or first phase-state.md update for this task.",
      ),
    completed_at: z
      .iso
      .datetime()
      .describe(
        "ISO 8601 UTC timestamp; PR mergedAt per gh pr view --json mergedAt.",
      ),
    branch: z
      .string()
      .min(1)
      .describe("Git branch the implementation lived on before merge."),
    pr_url: z.url().describe("Full GitHub PR URL."),
    plane_work_item_id: z
      .string()
      .min(1)
      .describe("Plane Work Item code (typically equals task_id)."),
    plane_epic_id: z
      .string()
      .min(1)
      .describe("Plane Epic code that this Work Item rolls up to."),
    prd_link: z
      .string()
      .nullable()
      .describe(
        "Repo-relative path to the PRD on main, or null if the episode predates docs/product/ (standalone-mode replay of an old PR).",
      ),
    design_link: z
      .string()
      .nullable()
      .describe(
        "Repo-relative path to the design on main, null if /design was skipped (trivial feature) or the episode predates docs/designs/.",
      ),
    plan_link: z
      .string()
      .nullable()
      .describe(
        "Repo-relative path to the plan on main, or null if standalone-mode replay.",
      ),
    session_ids: z
      .array(z.string())
      .describe(
        "Machine-local pointers into .claude/logs/<skill>/<run-dir>/ via the skill-logger meta.json. May be empty if skill-logger meta.json is missing for this run — see architecture § 9.6.",
      ),
    phases_run: z
      .array(z.string())
      .describe(
        'Phase names that ran for this episode, in order. Free-form strings; common values are "research", "prd", "design", "plan", "tasks", "implement", "review".',
      ),
    parallel_with: z
      .array(z.string())
      .describe(
        "Sibling Work Item ids that ran in parallel with this one. Human-curated at log time; may be empty.",
      ),
    reviews: reviewsSchema,
    duration_min_total: z
      .number()
      .min(0)
      .nullable()
      .describe(
        "Total wall-clock minutes start to merge. Null when not auto-extractable (standalone-mode replay).",
      ),
    duration_min_by_phase: z
      .record(z.string(), z.number().min(0))
      .nullable()
      .describe(
        "Per-phase wall-clock minutes. Null when not auto-extractable.",
      ),
    files_touched_count: z
      .number()
      .int()
      .min(0)
      .nullable()
      .describe(
        "Files changed in the merged PR (git diff). Null when not auto-extractable.",
      ),
    test_count_added: z
      .number()
      .int()
      .min(0)
      .nullable()
      .describe(
        "Net test cases added in the merged PR. Null when not auto-extractable.",
      ),
    decisions: z
      .array(decisionEntrySchema)
      .describe(
        "Architecturally significant choices made during this episode.",
      ),
    blockers: z
      .array(blockerEntrySchema)
      .describe(
        "Friction encountered during this episode that delayed progress.",
      ),
    dead_ends: z
      .array(deadEndEntrySchema)
      .describe(
        'Approaches tried and abandoned. Useful for future grep against "have we tried X?".',
      ),
    learnings: z
      .array(z.string())
      .describe(
        "One-line distilled lessons. Captured here so they remain greppable even when the source PR is forgotten.",
      ),
    tags: z
      .array(z.string())
      .describe(
        "Free-form topical tags for grep-based discovery. See architecture § 9.3 for recommended vocabularies.",
      ),
  })
  .loose()
  .describe(
    "One JSON object per line in docs/episodes/<YYYY-MM>.jsonl. One entry corresponds to one Work Item / one PR / one merge.",
  );

export type Episode = z.infer<typeof EpisodeSchema>;

/**
 * Serialise `EpisodeSchema` as a draft-2020-12 JSON Schema string,
 * with the metadata header expected by `docs/episodes/schema.json`.
 *
 * Used by both `scripts/gen-episode-schema.ts` (to produce the
 * committed file) and `episode-schema.test.ts` (to drift-check that
 * the committed file matches the current zod source). Keeping both
 * paths through one helper means a single edit suffices when the
 * metadata changes.
 */
export function generateEpisodeSchemaJson(): string {
  const generated = z.toJSONSchema(EpisodeSchema);
  const withMetadata = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://github.com/vasd85/global-job-search/docs/episodes/schema.json",
    title: "Episode log entry",
    description:
      "Generated from packages/ats-core/src/episode-schema.ts via z.toJSONSchema(); do not edit by hand. Regenerate via `pnpm --filter @gjs/ats-core gen:episode-schema`. Source schema corresponds to docs/agents/architecture.md § 9.1. See ADR-0003 for the choice of zod over ajv.",
    ...generated,
  };
  return JSON.stringify(withMetadata, null, 2) + "\n";
}
