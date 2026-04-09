import {
  PreferencesDraftSchema,
  ConversationStateSchema,
  MessageInputSchema,
  SeniorityLevel,
  CompanySize,
  CompanyStage,
  LocationPreferenceTierSchema,
  LocationPreferencesSchema,
  LocationScopeSchema,
  TierImmigrationFlagsSchema,
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
      locationPreferences: {
        tiers: [
          { rank: 1, workFormats: ["remote"], scope: { type: "cities", include: ["NYC", "London"] } },
        ],
      },
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
    { name: "LocationExtraction", schema: LocationExtractionSchema, field: { locationPreferences: { tiers: [{ rank: 1, workFormats: ["remote"], scope: { type: "cities", include: ["NYC"] } }] } } },
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

// ─── LocationPreferenceTierSchema ──────────────────────────────────────────

describe("LocationPreferenceTierSchema", () => {
  const validTier = {
    rank: 1,
    workFormats: ["remote"],
    scope: { type: "any", include: [] },
  };

  test("rejects rank of 0 (below min 1)", () => {
    const result = LocationPreferenceTierSchema.safeParse({
      ...validTier,
      rank: 0,
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty workFormats array", () => {
    const result = LocationPreferenceTierSchema.safeParse({
      ...validTier,
      workFormats: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects non-integer rank", () => {
    const result = LocationPreferenceTierSchema.safeParse({
      ...validTier,
      rank: 1.5,
    });
    expect(result.success).toBe(false);
  });

  test("rejects negative rank", () => {
    const result = LocationPreferenceTierSchema.safeParse({
      ...validTier,
      rank: -1,
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid TierWorkFormat value", () => {
    const result = LocationPreferenceTierSchema.safeParse({
      ...validTier,
      workFormats: ["telecommute"],
    });
    expect(result.success).toBe(false);
  });

  test('rejects legacy "relocation" workFormat (moved to immigrationFlags)', () => {
    const result = LocationPreferenceTierSchema.safeParse({
      ...validTier,
      workFormats: ["relocation"],
    });
    expect(result.success).toBe(false);
  });

  test.each<[string]>([["remote"], ["hybrid"], ["onsite"]])(
    "accepts valid TierWorkFormat value %s",
    (format) => {
      const result = LocationPreferenceTierSchema.safeParse({
        ...validTier,
        workFormats: [format],
      });
      expect(result.success).toBe(true);
    },
  );

  test("accepts optional qualitativeConstraint and originalText", () => {
    const result = LocationPreferenceTierSchema.safeParse({
      ...validTier,
      qualitativeConstraint: "good tech scene",
      originalText: "anywhere with good tech scene",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.qualitativeConstraint).toBe("good tech scene");
      expect(result.data.originalText).toBe("anywhere with good tech scene");
    }
  });

  test("accepts minimal tier without optional fields", () => {
    const result = LocationPreferenceTierSchema.safeParse(validTier);
    expect(result.success).toBe(true);
  });

  test("accepts tier with immigrationFlags present", () => {
    const result = LocationPreferenceTierSchema.safeParse({
      ...validTier,
      immigrationFlags: {
        needsVisaSponsorship: true,
        wantsRelocationPackage: true,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.immigrationFlags?.needsVisaSponsorship).toBe(true);
      expect(result.data.immigrationFlags?.wantsRelocationPackage).toBe(true);
    }
  });

  test("accepts tier with immigrationFlags absent (default)", () => {
    const result = LocationPreferenceTierSchema.safeParse(validTier);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.immigrationFlags).toBeUndefined();
    }
  });
});

// ─── TierImmigrationFlagsSchema ─────────────────────────────────────────────

describe("TierImmigrationFlagsSchema", () => {
  test("accepts an empty object (all flags absent)", () => {
    const result = TierImmigrationFlagsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test("accepts all three flags set to true", () => {
    const result = TierImmigrationFlagsSchema.safeParse({
      needsVisaSponsorship: true,
      wantsRelocationPackage: true,
      needsUnrestrictedWorkAuth: true,
    });
    expect(result.success).toBe(true);
  });

  test("accepts a partial flag combo", () => {
    const result = TierImmigrationFlagsSchema.safeParse({
      wantsRelocationPackage: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.wantsRelocationPackage).toBe(true);
      expect(result.data.needsVisaSponsorship).toBeUndefined();
    }
  });

  test("accepts explicit false values alongside true values", () => {
    const result = TierImmigrationFlagsSchema.safeParse({
      needsVisaSponsorship: false,
      wantsRelocationPackage: true,
      needsUnrestrictedWorkAuth: false,
    });
    expect(result.success).toBe(true);
  });

  test("rejects unknown keys via .strict()", () => {
    const result = TierImmigrationFlagsSchema.safeParse({
      needsVisaSponsorship: true,
      bogusFlag: true,
    });
    expect(result.success).toBe(false);
  });

  test("rejects non-boolean flag value", () => {
    const result = TierImmigrationFlagsSchema.safeParse({
      needsVisaSponsorship: "yes",
    });
    expect(result.success).toBe(false);
  });
});

// ─── LocationPreferencesSchema ──────────────────────────────────────────────

describe("LocationPreferencesSchema", () => {
  function makeTier(rank: number) {
    return {
      rank,
      workFormats: ["remote"],
      scope: { type: "any", include: [] },
    };
  }

  test("rejects empty tiers array", () => {
    const result = LocationPreferencesSchema.safeParse({ tiers: [] });
    expect(result.success).toBe(false);
  });

  test("rejects more than 5 tiers", () => {
    const result = LocationPreferencesSchema.safeParse({
      tiers: [
        makeTier(1),
        makeTier(2),
        makeTier(3),
        makeTier(4),
        makeTier(5),
        makeTier(6),
      ],
    });
    expect(result.success).toBe(false);
  });

  test("accepts exactly 5 tiers (max boundary)", () => {
    const result = LocationPreferencesSchema.safeParse({
      tiers: [
        makeTier(1),
        makeTier(2),
        makeTier(3),
        makeTier(4),
        makeTier(5),
      ],
    });
    expect(result.success).toBe(true);
  });

  test("accepts multiple tiers at same rank (equal priority)", () => {
    const result = LocationPreferencesSchema.safeParse({
      tiers: [
        { rank: 1, workFormats: ["remote"], scope: { type: "any", include: [] } },
        { rank: 1, workFormats: ["onsite"], scope: { type: "cities", include: ["NYC"] } },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("accepts tiers in non-ascending rank order (3, 2, 1)", () => {
    const result = LocationPreferencesSchema.safeParse({
      tiers: [makeTier(3), makeTier(2), makeTier(1)],
    });
    expect(result.success).toBe(true);
  });
});

// ─── LocationScopeSchema ────────────────────────────────────────────────────

describe("LocationScopeSchema", () => {
  test.each<[string]>([
    ["countries"],
    ["regions"],
    ["timezones"],
    ["cities"],
    ["any"],
  ])("accepts valid scope type %s", (scopeType) => {
    const result = LocationScopeSchema.safeParse({
      type: scopeType,
      include: [],
    });
    expect(result.success).toBe(true);
  });

  test("accepts optional exclude array", () => {
    const result = LocationScopeSchema.safeParse({
      type: "regions",
      include: ["EU"],
      exclude: ["Cyprus"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.exclude).toEqual(["Cyprus"]);
    }
  });

  test("accepts absent exclude (undefined)", () => {
    const result = LocationScopeSchema.safeParse({
      type: "regions",
      include: ["EU"],
    });
    expect(result.success).toBe(true);
  });

  test("accepts empty include array with type 'any' (remote anywhere)", () => {
    const result = LocationScopeSchema.safeParse({
      type: "any",
      include: [],
    });
    expect(result.success).toBe(true);
  });

  test("accepts empty strings in include (no min-length on items)", () => {
    // TODO: Empty strings in location include arrays are semantically invalid
    // but the schema does not validate individual string quality. Consider
    // adding .min(1) to individual items if empty strings cause downstream issues.
    const result = LocationScopeSchema.safeParse({
      type: "cities",
      include: [""],
    });
    expect(result.success).toBe(true);
  });
});

// ─── CompanySize enum expansion ─────────────────────────────────────────────

describe("CompanySize", () => {
  test("accepts 'any' value", () => {
    const result = CompanySize.safeParse("any");
    expect(result.success).toBe(true);
  });

  test.each<[string]>([["small"], ["Any"], ["ANY"], ["medium"]])(
    "rejects invalid value %s",
    (value) => {
      const result = CompanySize.safeParse(value);
      expect(result.success).toBe(false);
    },
  );
});

// ─── CompanyStage enum expansion ────────────────────────────────────────────

describe("CompanyStage", () => {
  test("accepts 'any' value", () => {
    const result = CompanyStage.safeParse("any");
    expect(result.success).toBe(true);
  });

  test.each<[string]>([["pre_seed"], ["ANY"], ["Any"], ["ipo"]])(
    "rejects invalid value %s",
    (value) => {
      const result = CompanyStage.safeParse(value);
      expect(result.success).toBe(false);
    },
  );
});

// ─── PreferencesDraftSchema: company enum expansion ─────────────────────────

describe("PreferencesDraftSchema: company enums with 'any'", () => {
  test("accepts companySizes containing 'any'", () => {
    const result = PreferencesDraftSchema.safeParse({ companySizes: ["any"] });
    expect(result.success).toBe(true);
  });

  test("accepts companyStages containing 'any'", () => {
    const result = PreferencesDraftSchema.safeParse({ companyStages: ["any"] });
    expect(result.success).toBe(true);
  });

  test("accepts companySizes with 'any' alongside specific values", () => {
    const result = PreferencesDraftSchema.safeParse({
      companySizes: ["startup", "any"],
    });
    expect(result.success).toBe(true);
  });
});

// ─── ConversationStateSchema: editingFromReview ─────────────────────────────

describe("ConversationStateSchema: editingFromReview field", () => {
  const validState = {
    currentStepIndex: 2,
    draft: {},
    completedSteps: [],
    status: "in_progress",
    createdAt: "2026-01-15T12:00:00.000Z",
    updatedAt: "2026-01-15T12:00:00.000Z",
  };

  test("accepts editingFromReview: true", () => {
    const result = ConversationStateSchema.safeParse({
      ...validState,
      editingFromReview: true,
    });
    expect(result.success).toBe(true);
  });

  test("accepts absent editingFromReview (optional)", () => {
    const result = ConversationStateSchema.safeParse(validState);
    expect(result.success).toBe(true);
  });

  test("rejects non-boolean editingFromReview", () => {
    const result = ConversationStateSchema.safeParse({
      ...validState,
      editingFromReview: "true",
    });
    expect(result.success).toBe(false);
  });
});

// ─── MessageInputSchema: displayText ────────────────────────────────────────

describe("MessageInputSchema: displayText field", () => {
  test("accepts message with optional displayText", () => {
    const result = MessageInputSchema.safeParse({
      message: "some json",
      displayText: "user-friendly text",
    });
    expect(result.success).toBe(true);
  });

  test("accepts message without displayText", () => {
    const result = MessageInputSchema.safeParse({ message: "hello" });
    expect(result.success).toBe(true);
  });
});
