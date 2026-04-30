import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ValidateFunction, type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

// Resolve schema path relative to this file: packages/ats-core/src/<file> -> repo root.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, "../../../docs/episodes/schema.json");

// Pinned, byte-equivalent (whitespace-normalised) copy of docs/agents/architecture.md § 9.1.
// Inlined deliberately so a markdown reflow can't silently change the test input.
const CANONICAL_EXAMPLE = {
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
} as const;

type EpisodeFixture = Record<string, unknown>;

function validCanonical(): EpisodeFixture {
  return structuredClone(CANONICAL_EXAMPLE) as EpisodeFixture;
}

let validate: ValidateFunction;

beforeAll(() => {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8")) as Record<string, unknown>;
  // Draft 2020-12 entrypoint — required because the schema declares
  // $schema: "https://json-schema.org/draft/2020-12/schema".
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  // Register date-time / uri / etc. so format keywords aren't no-ops at runtime.
  addFormats(ajv);
  validate = ajv.compile(schema);
});

function expectError(
  errors: ErrorObject[] | null | undefined,
  predicate: (e: ErrorObject) => boolean,
): void {
  expect(errors).toBeTruthy();
  expect(errors!.some(predicate)).toBe(true);
}

describe("episode-log JSON Schema", () => {
  // Scenario 1 — happy path
  describe("happy path", () => {
    test("accepts the canonical architecture § 9.1 example", () => {
      const fixture = validCanonical();
      const ok = validate(fixture);

      expect(validate.errors).toBeNull();
      expect(ok).toBe(true);
    });
  });

  // Scenario 2 — required-field enforcement (representative)
  describe("required fields", () => {
    test("rejects an episode missing top-level schema_version", () => {
      const fixture = validCanonical();
      delete fixture.schema_version;

      const ok = validate(fixture);

      expect(ok).toBe(false);
      expectError(
        validate.errors,
        (e) =>
          e.keyword === "required" &&
          (e.params as { missingProperty?: string }).missingProperty === "schema_version",
      );
    });
  });

  // Scenario 3 — enum + const enforcement (combined)
  describe("enum and const enforcement", () => {
    type EnumConstCase = {
      label: string;
      mutate: (fixture: EpisodeFixture) => void;
      expectedKeyword: "enum" | "const";
      expectedInstancePath: string;
    };

    const cases: EnumConstCase[] = [
      {
        label: "rejects unknown task_type 'chord' (typo for 'chore')",
        mutate: (fixture) => {
          fixture.task_type = "chord";
        },
        expectedKeyword: "enum",
        expectedInstancePath: "/task_type",
      },
      {
        label: "rejects schema_version other than the pinned const 1",
        mutate: (fixture) => {
          fixture.schema_version = 2;
        },
        expectedKeyword: "const",
        expectedInstancePath: "/schema_version",
      },
    ];

    test.each(cases)("$label", ({ mutate, expectedKeyword, expectedInstancePath }) => {
      const fixture = validCanonical();
      mutate(fixture);

      const ok = validate(fixture);

      expect(ok).toBe(false);
      expectError(
        validate.errors,
        (e) => e.keyword === expectedKeyword && e.instancePath === expectedInstancePath,
      );
    });
  });

  // Scenario 4 — nullable-field acceptance (standalone-mode replay)
  describe("nullable fields", () => {
    test("accepts null for documented-nullable auto-extracted fields", () => {
      const fixture = validCanonical();
      fixture.prd_link = null;
      fixture.design_link = null;
      fixture.plan_link = null;
      fixture.duration_min_total = null;
      fixture.duration_min_by_phase = null;
      fixture.files_touched_count = null;
      fixture.test_count_added = null;

      const ok = validate(fixture);

      expect(validate.errors).toBeNull();
      expect(ok).toBe(true);
    });
  });

  // Scenario 5 — empty arrays accepted
  describe("collection fields", () => {
    test("accepts empty arrays for all collection-typed required fields", () => {
      const fixture = validCanonical();
      fixture.parallel_with = [];
      fixture.session_ids = [];
      fixture.phases_run = [];
      fixture.decisions = [];
      fixture.blockers = [];
      fixture.dead_ends = [];
      fixture.learnings = [];
      fixture.tags = [];

      const ok = validate(fixture);

      expect(validate.errors).toBeNull();
      expect(ok).toBe(true);
    });
  });

  // Scenario 6 — additionalProperties boundary (nested vs root)
  describe("additionalProperties boundary", () => {
    type AdditionalPropsCase = {
      label: string;
      mutate: (fixture: EpisodeFixture) => void;
      expectValid: boolean;
      // Used only when expectValid is false.
      expectedInstancePath?: string;
      expectedAdditionalProperty?: string;
    };

    const cases: AdditionalPropsCase[] = [
      {
        label: "rejects an unknown key inside a decisions[] entry",
        mutate: (fixture) => {
          const decisions = fixture.decisions as Array<Record<string, unknown>>;
          decisions[0].extra = "x";
        },
        expectValid: false,
        expectedInstancePath: "/decisions/0",
        expectedAdditionalProperty: "extra",
      },
      {
        label: "accepts an unknown top-level key (root is forward-compat)",
        mutate: (fixture) => {
          fixture.experimental_field = "x";
        },
        expectValid: true,
      },
    ];

    test.each(cases)(
      "$label",
      ({ mutate, expectValid, expectedInstancePath, expectedAdditionalProperty }) => {
        const fixture = validCanonical();
        mutate(fixture);

        const ok = validate(fixture);

        if (expectValid) {
          expect(validate.errors).toBeNull();
          expect(ok).toBe(true);
          return;
        }

        expect(ok).toBe(false);
        expectError(
          validate.errors,
          (e) =>
            e.keyword === "additionalProperties" &&
            e.instancePath === expectedInstancePath &&
            (e.params as { additionalProperty?: string }).additionalProperty ===
              expectedAdditionalProperty,
        );
      },
    );
  });

  // Scenario 7 — reviews sub-shape: verdict enum + sparse keys
  describe("reviews sub-shape", () => {
    type ReviewsCase = {
      label: string;
      mutate: (fixture: EpisodeFixture) => void;
      expectValid: boolean;
      expectedInstancePath?: string;
    };

    const cases: ReviewsCase[] = [
      {
        label: "rejects reviews.code.verdict not in the enum",
        mutate: (fixture) => {
          const reviews = fixture.reviews as Record<string, Record<string, unknown>>;
          reviews.code.verdict = "rejected";
        },
        expectValid: false,
        expectedInstancePath: "/reviews/code/verdict",
      },
      {
        label: "accepts an empty reviews object (all reviewer keys absent)",
        mutate: (fixture) => {
          fixture.reviews = {};
        },
        expectValid: true,
      },
    ];

    test.each(cases)("$label", ({ mutate, expectValid, expectedInstancePath }) => {
      const fixture = validCanonical();
      mutate(fixture);

      const ok = validate(fixture);

      if (expectValid) {
        expect(validate.errors).toBeNull();
        expect(ok).toBe(true);
        return;
      }

      expect(ok).toBe(false);
      expectError(
        validate.errors,
        (e) => e.keyword === "enum" && e.instancePath === expectedInstancePath,
      );
    });
  });
});
