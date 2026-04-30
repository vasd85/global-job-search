import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";
import {
  EpisodeSchema,
  generateEpisodeSchemaJson,
  type Episode,
} from "./episode-schema";

// Resolve the committed JSON Schema path relative to this file.
// packages/ats-core/src/<file>  →  repo root  →  docs/episodes/schema.json
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_JSON_PATH = path.resolve(
  __dirname,
  "../../../docs/episodes/schema.json",
);

// Pinned, byte-equivalent (whitespace-normalised) copy of
// docs/agents/architecture.md § 9.1. Inlined deliberately so a markdown
// reflow can't silently change the test input. Em-dashes preserved at
// `decisions[0].rejected[*]` and `learnings[0]` — do not "fix" to ASCII.
const CANONICAL_EXAMPLE: Episode = {
  schema_version: 1,
  episode_id: "2026-04-28-fix-greenhouse-rate-limit-GJS-42",
  feature_slug: "fix-greenhouse-rate-limit",
  task_id: "GJS-42",
  task_type: "fix",
  status: "merged",
  started_at: "2026-04-28T10:15:00Z",
  completed_at: "2026-04-28T11:42:00Z",

  branch: "fix/greenhouse-backoff-GJS-42",
  pr_url: "https://github.com/vasd85/global-job-search/pull/123",
  plane_work_item_id: "GJS-42",
  plane_epic_id: "GJS-40",
  prd_link: "docs/product/fix-greenhouse-rate-limit.md",
  design_link: null,
  plan_link: "docs/plans/fix-greenhouse-rate-limit.md",
  session_ids: ["1124e18f-3963-43d3-93ce-424420a57222"],

  phases_run: ["research", "prd", "plan", "tasks", "implement", "review"],
  parallel_with: ["GJS-43"],

  reviews: {
    prd: { cycles: 1, verdict: "approved" },
    plan: { cycles: 2, verdict: "approved", critical_findings_addressed: 3 },
    code: { cycles: 1, verdict: "approved" },
  },

  duration_min_total: 87,
  duration_min_by_phase: {
    research: 12,
    prd: 18,
    plan: 22,
    implement: 30,
    review: 5,
  },
  files_touched_count: 4,
  test_count_added: 6,

  decisions: [
    {
      what: "exponential backoff with 5 max retries, jitter 100-500ms",
      why: "3 retries miss 4xx storms in production; jitter prevents thundering herd",
      rejected: [
        "circuit breaker — overkill for this scope",
        "fixed delay — uneven load",
      ],
      confidence: "verified",
    },
  ],
  blockers: [
    {
      what: "Greenhouse 429 responses lack standard Retry-After header",
      resolution: "extracted from response body via vendor wrapper",
      duration_min: 25,
      tag: "external-api",
    },
  ],
  dead_ends: [
    {
      tried: "react-query default retry config",
      why_failed: "doesn't expose Retry-After header to caller code",
    },
  ],
  learnings: [
    "Greenhouse 429s lack standard headers — extractor needs vendor-specific wrapper",
  ],
  tags: ["extractor", "greenhouse", "rate-limit"],
};

// Helper: deep clone the canonical example so per-test mutations
// don't leak between tests.
function validCanonical(): Episode {
  return structuredClone(CANONICAL_EXAMPLE);
}

describe("EpisodeSchema (zod)", () => {
  // Sanity check: the canonical example compiles into a known-valid
  // input. If the schema rejects this, every other test is misleading.
  beforeAll(() => {
    const result = EpisodeSchema.safeParse(CANONICAL_EXAMPLE);
    if (!result.success) {
      throw new Error(
        `Canonical example fails baseline validation: ${JSON.stringify(
          result.error.issues,
          null,
          2,
        )}`,
      );
    }
  });

  // -- Scenario 1: Happy path -------------------------------------------
  test("accepts the canonical architecture § 9.1 example", () => {
    const result = EpisodeSchema.safeParse(CANONICAL_EXAMPLE);
    expect(result.success).toBe(true);
  });

  // -- Scenario 2: Required-field enforcement (representative) ----------
  test("rejects an episode missing a top-level required field", () => {
    const fixture = validCanonical() as Partial<Episode>;
    delete fixture.schema_version;

    const result = EpisodeSchema.safeParse(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(
      result.error.issues.some(
        (issue) =>
          issue.path.length === 1 && issue.path[0] === "schema_version",
      ),
    ).toBe(true);
  });

  // -- Scenario 3: Enum + const enforcement ----------------------------
  test.each([
    {
      name: "task_type outside the enum",
      mutate: (f: Episode) => {
        (f as unknown as { task_type: string }).task_type = "chord";
      },
      expectedPath: ["task_type"],
    },
    {
      name: "schema_version other than const 1",
      mutate: (f: Episode) => {
        (f as unknown as { schema_version: number }).schema_version = 2;
      },
      expectedPath: ["schema_version"],
    },
  ])("rejects $name", ({ mutate, expectedPath }) => {
    const fixture = validCanonical();
    mutate(fixture);

    const result = EpisodeSchema.safeParse(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(
      result.error.issues.some(
        (issue) =>
          issue.path.length === expectedPath.length &&
          issue.path.every((p, i) => p === expectedPath[i]),
      ),
    ).toBe(true);
  });

  // -- Scenario 4: Nullable-field acceptance (standalone-mode replay) --
  test("accepts null for documented-nullable auto-extracted fields", () => {
    const fixture = validCanonical();
    fixture.prd_link = null;
    fixture.design_link = null;
    fixture.plan_link = null;
    fixture.duration_min_total = null;
    fixture.duration_min_by_phase = null;
    fixture.files_touched_count = null;
    fixture.test_count_added = null;

    const result = EpisodeSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  // -- Scenario 5: Empty arrays accepted -------------------------------
  test("accepts empty arrays for collection fields", () => {
    const fixture = validCanonical();
    fixture.parallel_with = [];
    fixture.session_ids = [];
    fixture.phases_run = [];
    fixture.decisions = [];
    fixture.blockers = [];
    fixture.dead_ends = [];
    fixture.learnings = [];
    fixture.tags = [];

    const result = EpisodeSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  // -- Scenario 6: additionalProperties polarity (nested vs root) ------
  test("rejects extras inside decisions[] items (nested strict)", () => {
    const fixture = validCanonical();
    (
      fixture.decisions[0] as unknown as { extra: string }
    ).extra = "x";

    const result = EpisodeSchema.safeParse(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;

    // zod 4 reports unknown keys in strict objects with code === "unrecognized_keys"
    // and an empty-or-shallow path; the keys themselves live in `keys`.
    expect(
      result.error.issues.some(
        (issue) =>
          issue.code === "unrecognized_keys" &&
          "keys" in issue &&
          Array.isArray((issue as { keys: unknown }).keys) &&
          ((issue as { keys: string[] }).keys).includes("extra"),
      ),
    ).toBe(true);
  });

  test("accepts extras at the root (loose forward-compat)", () => {
    const fixture = validCanonical() as Episode & Record<string, unknown>;
    fixture.experimental_field = "x";

    const result = EpisodeSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  // -- Scenario 7: reviews shape — verdict enum + sparse keys ----------
  test("rejects unknown reviews.code.verdict", () => {
    const fixture = validCanonical();
    if (!fixture.reviews.code) {
      throw new Error("canonical example must define reviews.code");
    }
    (fixture.reviews.code as unknown as { verdict: string }).verdict =
      "rejected";

    const result = EpisodeSchema.safeParse(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(
      result.error.issues.some(
        (issue) =>
          issue.path.length === 3 &&
          issue.path[0] === "reviews" &&
          issue.path[1] === "code" &&
          issue.path[2] === "verdict",
      ),
    ).toBe(true);
  });

  test("accepts a reviews object with no keys", () => {
    const fixture = validCanonical();
    fixture.reviews = {};

    const result = EpisodeSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  // -- Drift detection: generated JSON Schema matches committed file ---
  // If this fails, run `pnpm --filter @gjs/ats-core gen:episode-schema`
  // and commit the regenerated `docs/episodes/schema.json`.
  test("docs/episodes/schema.json matches z.toJSONSchema(EpisodeSchema)", () => {
    const expected = generateEpisodeSchemaJson();
    const actual = readFileSync(SCHEMA_JSON_PATH, "utf-8");
    expect(actual).toBe(expected);
  });
});
