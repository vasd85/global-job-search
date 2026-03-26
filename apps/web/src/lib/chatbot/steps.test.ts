import { STEPS, getStepBySlug, getStepIndex, TOTAL_STEPS } from "./steps";

// ─── STEPS array structure ──────────────────────────────────────────────────

describe("STEPS", () => {
  const EXPECTED_SLUGS = [
    "target_roles",
    "target_seniority",
    "core_skills",
    "growth_skills",
    "avoid_skills",
    "deal_breakers",
    "salary",
    "location",
    "industries",
    "company_sizes",
    "company_stages",
    "work_format",
    "hq_geographies",
    "product_types",
    "exclusions",
    "dimension_weights",
    "review",
  ];

  test("has exactly 17 steps in the expected order", () => {
    expect(STEPS).toHaveLength(17);
    const slugs = STEPS.map((s) => s.slug);
    expect(slugs).toEqual(EXPECTED_SLUGS);
  });

  test("every free_text and hybrid step has an extractionSchema", () => {
    const freeTextOrHybrid = STEPS.filter(
      (s) => s.inputType === "free_text" || s.inputType === "hybrid",
    );
    expect(freeTextOrHybrid.length).toBeGreaterThan(0);
    for (const step of freeTextOrHybrid) {
      expect(step.extractionSchema).toBeTruthy();
    }
  });

  test("every structured step has a structuredConfig (except review)", () => {
    const structured = STEPS.filter(
      (s) => s.inputType === "structured" && s.slug !== "review",
    );
    expect(structured.length).toBeGreaterThan(0);
    for (const step of structured) {
      expect(step.structuredConfig).toBeTruthy();
    }
  });

  test("no hybrid step currently uses structuredConfig", () => {
    // Location step was previously the only hybrid step with structuredConfig
    // but was converted to free_text for the tier-based location model.
    const hybridWithConfig = STEPS.filter(
      (s) => s.inputType === "hybrid" && s.structuredConfig,
    );
    expect(hybridWithConfig.length).toBe(0);
  });

  test("the review step is last and has no fields", () => {
    const review = STEPS[STEPS.length - 1];
    expect(review).toBeDefined();
    expect(review!.slug).toBe("review");
    expect(review!.fields).toEqual([]);
    expect(review!.required).toBe(true);
    expect(review!.skippable).toBe(false);
  });

  test("required steps are not skippable", () => {
    const requiredSteps = STEPS.filter((s) => s.required);
    expect(requiredSteps.length).toBeGreaterThan(0);
    for (const step of requiredSteps) {
      expect(step.skippable).toBe(false);
    }
  });

  test("every step has a non-empty question string", () => {
    for (const step of STEPS) {
      expect(step.question).toBeTruthy();
      expect(typeof step.question).toBe("string");
    }
  });

  test("no duplicate slugs in STEPS", () => {
    const slugs = STEPS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

// ─── TOTAL_STEPS ────────────────────────────────────────────────────────────

describe("TOTAL_STEPS", () => {
  test("equals STEPS.length", () => {
    expect(TOTAL_STEPS).toBe(STEPS.length);
    expect(TOTAL_STEPS).toBe(17);
  });
});

// ─── getStepBySlug ──────────────────────────────────────────────────────────

describe("getStepBySlug", () => {
  test("returns correct step for valid slug", () => {
    const step = getStepBySlug("target_roles");
    expect(step).toBeDefined();
    expect(step!.slug).toBe("target_roles");
  });

  test("returns undefined for unknown slug", () => {
    const step = getStepBySlug("nonexistent");
    expect(step).toBeUndefined();
  });
});

// ─── getStepIndex ───────────────────────────────────────────────────────────

describe("getStepIndex", () => {
  test("returns correct index for valid slug", () => {
    expect(getStepIndex("target_roles")).toBe(0);
  });

  test("returns -1 for unknown slug", () => {
    expect(getStepIndex("nonexistent")).toBe(-1);
  });
});

// ─── toOptions label formatting ─────────────────────────────────────────────

describe("toOptions label formatting", () => {
  test("converts underscore-separated values to title case labels", () => {
    const step = getStepBySlug("company_stages");
    expect(step).toBeDefined();
    const options = step!.structuredConfig?.options;
    expect(options).toBeDefined();

    const seriesA = options!.find((o: { value: string }) => o.value === "series_a");
    expect(seriesA).toEqual({ value: "series_a", label: "Series A" });
  });

  // TODO: "vp" is converted to "Vp" not "VP". The regex `\b\w` capitalizes
  // only the first character of each word boundary, and "vp" is treated as
  // one word. This may be a UX issue -- "VP" is the conventional rendering.
  test("converts 'vp' to 'Vp' (not 'VP' - potential UX issue)", () => {
    const step = getStepBySlug("target_seniority");
    expect(step).toBeDefined();
    const options = step!.structuredConfig?.options;
    expect(options).toBeDefined();

    const vp = options!.find((o) => o.value === "vp");
    expect(vp).toEqual({ value: "vp", label: "Vp" });
  });
});
