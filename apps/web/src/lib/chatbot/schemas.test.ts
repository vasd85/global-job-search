import {
  PreferencesDraftSchema,
  ConversationStateSchema,
  MessageInputSchema,
  SeniorityLevel,
  TargetRolesExtractionSchema,
  CoreSkillsExtractionSchema,
  GrowthSkillsExtractionSchema,
  AvoidSkillsExtractionSchema,
  DealBreakersExtractionSchema,
  LocationExtractionSchema,
  IndustriesExtractionSchema,
  HqGeographiesExtractionSchema,
  ProductTypesExtractionSchema,
  ExclusionsExtractionSchema,
} from "./schemas";

// ─── PreferencesDraftSchema ─────────────────────────────────────────────────

describe("PreferencesDraftSchema", () => {
  test("accepts a fully empty object", () => {
    const result = PreferencesDraftSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("accepts a fully populated object", () => {
    const full = {
      targetTitles: ["Senior QA Engineer"],
      targetSeniority: ["senior", "lead"],
      coreSkills: ["TypeScript", "React"],
      growthSkills: ["Rust"],
      avoidSkills: ["PHP"],
      dealBreakers: ["Travel >50%"],
      minSalary: 100000,
      targetSalary: 150000,
      salaryCurrency: "USD",
      preferredLocations: ["NYC", "London"],
      remotePreference: "remote_only",
      weightRole: 0.25,
      weightSkills: 0.25,
      weightLocation: 0.2,
      weightCompensation: 0.15,
      weightDomain: 0.15,
      industries: ["fintech"],
      companySizes: ["startup", "scaleup"],
      companyStages: ["series_a", "series_b"],
      workFormat: "remote_first",
      hqGeographies: ["US", "UK"],
      productTypes: ["B2B SaaS"],
      exclusions: ["outsourcing"],
    };

    const result = PreferencesDraftSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  test("rejects invalid weight values outside 0-1 range", () => {
    const tooHigh = PreferencesDraftSchema.safeParse({ weightRole: 1.5 });
    expect(tooHigh.success).toBe(false);

    const negative = PreferencesDraftSchema.safeParse({ weightRole: -0.1 });
    expect(negative.success).toBe(false);
  });

  test("rejects non-integer salary", () => {
    const result = PreferencesDraftSchema.safeParse({ minSalary: 75000.5 });
    expect(result.success).toBe(false);
  });

  test("rejects negative salary", () => {
    const result = PreferencesDraftSchema.safeParse({ minSalary: -1 });
    expect(result.success).toBe(false);
  });

  test("accepts undefined for all optional array fields", () => {
    const result = PreferencesDraftSchema.safeParse({
      targetTitles: undefined,
    });
    expect(result.success).toBe(true);
  });
});

// ─── ConversationStateSchema ────────────────────────────────────────────────

describe("ConversationStateSchema", () => {
  test("rejects missing required fields", () => {
    const result = ConversationStateSchema.safeParse({ draft: {} });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("currentStepIndex");
      expect(paths).toContain("completedSteps");
      expect(paths).toContain("status");
      expect(paths).toContain("createdAt");
      expect(paths).toContain("updatedAt");
    }
  });

  test("accepts a valid full state", () => {
    const valid = {
      currentStepIndex: 0,
      draft: {},
      completedSteps: [],
      status: "in_progress",
      createdAt: "2026-01-15T12:00:00.000Z",
      updatedAt: "2026-01-15T12:00:00.000Z",
    };

    const result = ConversationStateSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });
});

// ─── MessageInputSchema ────────────────────────────────────────────────────

describe("MessageInputSchema", () => {
  test("rejects empty string message", () => {
    const result = MessageInputSchema.safeParse({ message: "" });
    expect(result.success).toBe(false);
  });

  test("rejects missing message field", () => {
    const result = MessageInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ─── SeniorityLevel enum ───────────────────────────────────────────────────

describe("SeniorityLevel", () => {
  test.each<[string]>([["intern"], ["cto"], ["SENIOR"], [""]])(
    "rejects invalid value %s",
    (value) => {
      const result = SeniorityLevel.safeParse(value);
      expect(result.success).toBe(false);
    },
  );
});

// ─── Extraction schemas meta-fields ────────────────────────────────────────

describe("extraction schemas all share the same meta-fields structure", () => {
  const schemas = [
    { name: "TargetRolesExtraction", schema: TargetRolesExtractionSchema, field: { targetTitles: ["SWE"] } },
    { name: "CoreSkillsExtraction", schema: CoreSkillsExtractionSchema, field: { coreSkills: ["JS"] } },
    { name: "GrowthSkillsExtraction", schema: GrowthSkillsExtractionSchema, field: { growthSkills: ["Rust"] } },
    { name: "AvoidSkillsExtraction", schema: AvoidSkillsExtractionSchema, field: { avoidSkills: ["PHP"] } },
    { name: "DealBreakersExtraction", schema: DealBreakersExtractionSchema, field: { dealBreakers: ["Travel"] } },
    { name: "LocationExtraction", schema: LocationExtractionSchema, field: { preferredLocations: ["NYC"] } },
    { name: "IndustriesExtraction", schema: IndustriesExtractionSchema, field: { industries: ["fintech"] } },
    { name: "HqGeographiesExtraction", schema: HqGeographiesExtractionSchema, field: { hqGeographies: ["US"] } },
    { name: "ProductTypesExtraction", schema: ProductTypesExtractionSchema, field: { productTypes: ["B2B"] } },
    { name: "ExclusionsExtraction", schema: ExclusionsExtractionSchema, field: { exclusions: ["gambling"] } },
  ];

  test.each(schemas)(
    "$name accepts meta-fields (clarificationNeeded, clarificationQuestion, confidence)",
    ({ schema, field }) => {
      const input = {
        ...field,
        clarificationNeeded: true,
        clarificationQuestion: "What?",
        confidence: "high",
      };
      const result = schema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toHaveProperty("clarificationNeeded", true);
        expect(result.data).toHaveProperty("clarificationQuestion", "What?");
        expect(result.data).toHaveProperty("confidence", "high");
      }
    },
  );
});
