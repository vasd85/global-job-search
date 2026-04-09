import { ExtractedSignalsSchema, ScoringOutputSchema } from "./scoring-schema";

// ── Helpers ───────────────────────────────────────────────────────────────

function validSignals(overrides: Record<string, unknown> = {}) {
  return {
    visaSponsorship: "unknown" as const,
    relocationPackage: "unknown" as const,
    workAuthRestriction: "unknown" as const,
    languageRequirements: [] as string[],
    travelPercent: null,
    securityClearance: null,
    shiftPattern: null,
    ...overrides,
  };
}

function validOutput(overrides: Record<string, unknown> = {}) {
  return {
    scoreR: 5,
    scoreS: 8,
    scoreL: 3,
    scoreC: 10,
    scoreD: 0,
    matchReason: "Good fit for the role",
    evidenceQuotes: ["quote1"],
    hasGrowthSkillMatch: true,
    dealBreakerTriggered: false,
    extractedSignals: validSignals(),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("ScoringOutputSchema", () => {
  // ── Critical ──────────────────────────────────────────────────────────

  test("valid full object passes validation", () => {
    const input = validOutput();
    const result = ScoringOutputSchema.parse(input);

    expect(result).toEqual(input);
  });

  test("out-of-range score (11) passes schema — clamped in handler", () => {
    // Anthropic rejects all numeric constraints (min/max/int).
    // Clamping to 0-10 and rounding happens in the handler.
    const result = ScoringOutputSchema.parse(validOutput({ scoreR: 11 }));
    expect(result.scoreR).toBe(11);
  });

  test("negative score (-1) passes schema — clamped in handler", () => {
    const result = ScoringOutputSchema.parse(validOutput({ scoreR: -1 }));
    expect(result.scoreR).toBe(-1);
  });

  test("non-integer score (5.5) passes schema — rounded in handler", () => {
    const result = ScoringOutputSchema.parse(validOutput({ scoreR: 5.5 }));
    expect(result.scoreR).toBe(5.5);
  });

  // ── Important ─────────────────────────────────────────────────────────

  test.each<[string, number]>([
    ["scoreR", 0], ["scoreR", 10],
    ["scoreS", 0], ["scoreS", 10],
    ["scoreL", 0], ["scoreL", 10],
    ["scoreC", 0], ["scoreC", 10],
    ["scoreD", 0], ["scoreD", 10],
  ])("boundary value %s=%d is accepted", (field, value) => {
    const result = ScoringOutputSchema.parse(validOutput({ [field]: value }));
    expect(result[field as keyof typeof result]).toBe(value);
  });

  test("dealBreakerReason is optional", () => {
    const input = validOutput();
    // Ensure no dealBreakerReason field at all
    delete (input as Record<string, unknown>).dealBreakerReason;

    const result = ScoringOutputSchema.parse(input);
    expect(result.dealBreakerReason).toBeUndefined();
  });

  test("dealBreakerReason is accepted when present", () => {
    const result = ScoringOutputSchema.parse(
      validOutput({ dealBreakerReason: "Requires 10+ years experience" }),
    );
    expect(result.dealBreakerReason).toBe("Requires 10+ years experience");
  });

  test("empty evidenceQuotes array is accepted", () => {
    const result = ScoringOutputSchema.parse(validOutput({ evidenceQuotes: [] }));
    expect(result.evidenceQuotes).toEqual([]);
  });

  // ── extractedSignals contract ─────────────────────────────────────────

  test("extractedSignals is required (omitting it fails validation)", () => {
    const input = validOutput();
    delete (input as Record<string, unknown>).extractedSignals;

    expect(() => ScoringOutputSchema.parse(input)).toThrow();
  });

  test("extractedSignals propagates through the parsed output", () => {
    const signals = validSignals({
      visaSponsorship: "yes",
      languageRequirements: ["en", "de"],
      travelPercent: 25,
    });
    const result = ScoringOutputSchema.parse(validOutput({ extractedSignals: signals }));

    expect(result.extractedSignals).toEqual(signals);
  });
});

describe("ExtractedSignalsSchema", () => {
  // ── Critical: enum constraints ────────────────────────────────────────

  test("default unknown signals object passes validation", () => {
    const input = validSignals();
    const result = ExtractedSignalsSchema.parse(input);

    expect(result).toEqual(input);
  });

  test.each(["yes", "no", "unknown"] as const)(
    "visaSponsorship accepts %s",
    (value) => {
      const result = ExtractedSignalsSchema.parse(
        validSignals({ visaSponsorship: value }),
      );
      expect(result.visaSponsorship).toBe(value);
    },
  );

  test.each(["yes", "no", "unknown"] as const)(
    "relocationPackage accepts %s",
    (value) => {
      const result = ExtractedSignalsSchema.parse(
        validSignals({ relocationPackage: value }),
      );
      expect(result.relocationPackage).toBe(value);
    },
  );

  test.each([
    "none",
    "citizens_only",
    "residents_only",
    "region_only",
    "unknown",
  ] as const)("workAuthRestriction accepts %s", (value) => {
    const result = ExtractedSignalsSchema.parse(
      validSignals({ workAuthRestriction: value }),
    );
    expect(result.workAuthRestriction).toBe(value);
  });

  test("workAuthRestriction rejects unrelated string", () => {
    expect(() =>
      ExtractedSignalsSchema.parse(
        validSignals({ workAuthRestriction: "locals_only" }),
      ),
    ).toThrow();
  });

  test("visaSponsorship rejects unrelated string", () => {
    expect(() =>
      ExtractedSignalsSchema.parse(
        validSignals({ visaSponsorship: "maybe" }),
      ),
    ).toThrow();
  });

  // ── Important: nullable / array fields ────────────────────────────────

  test("languageRequirements accepts empty array", () => {
    const result = ExtractedSignalsSchema.parse(
      validSignals({ languageRequirements: [] }),
    );
    expect(result.languageRequirements).toEqual([]);
  });

  test("languageRequirements accepts populated array", () => {
    const result = ExtractedSignalsSchema.parse(
      validSignals({ languageRequirements: ["en", "de-b2"] }),
    );
    expect(result.languageRequirements).toEqual(["en", "de-b2"]);
  });

  test("travelPercent accepts null", () => {
    const result = ExtractedSignalsSchema.parse(
      validSignals({ travelPercent: null }),
    );
    expect(result.travelPercent).toBeNull();
  });

  test("travelPercent accepts integer", () => {
    const result = ExtractedSignalsSchema.parse(
      validSignals({ travelPercent: 25 }),
    );
    expect(result.travelPercent).toBe(25);
  });

  test("travelPercent over 100 still parses (clamped in handler)", () => {
    // Anthropic structured output rejects min/max/int Zod constraints,
    // so the schema accepts any number; the handler clamps to 0-100.
    const result = ExtractedSignalsSchema.parse(
      validSignals({ travelPercent: 150 }),
    );
    expect(result.travelPercent).toBe(150);
  });

  test("securityClearance accepts null", () => {
    const result = ExtractedSignalsSchema.parse(
      validSignals({ securityClearance: null }),
    );
    expect(result.securityClearance).toBeNull();
  });

  test("securityClearance accepts string", () => {
    const result = ExtractedSignalsSchema.parse(
      validSignals({ securityClearance: "US Secret" }),
    );
    expect(result.securityClearance).toBe("US Secret");
  });

  test("shiftPattern accepts null", () => {
    const result = ExtractedSignalsSchema.parse(
      validSignals({ shiftPattern: null }),
    );
    expect(result.shiftPattern).toBeNull();
  });

  test("shiftPattern accepts string", () => {
    const result = ExtractedSignalsSchema.parse(
      validSignals({ shiftPattern: "rotating on-call" }),
    );
    expect(result.shiftPattern).toBe("rotating on-call");
  });

  // ── Required fields ──────────────────────────────────────────────────

  test("missing visaSponsorship fails validation", () => {
    const input = validSignals();
    delete (input as Record<string, unknown>).visaSponsorship;
    expect(() => ExtractedSignalsSchema.parse(input)).toThrow();
  });

  test("missing languageRequirements fails validation", () => {
    const input = validSignals();
    delete (input as Record<string, unknown>).languageRequirements;
    expect(() => ExtractedSignalsSchema.parse(input)).toThrow();
  });
});
