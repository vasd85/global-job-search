import { ScoringOutputSchema } from "./scoring-schema";

// ── Helpers ───────────────────────────────────────────────────────────────

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

  test("score out of range (11) is rejected", () => {
    expect(() => ScoringOutputSchema.parse(validOutput({ scoreR: 11 }))).toThrow();
  });

  test("score out of range (-1) is rejected", () => {
    expect(() => ScoringOutputSchema.parse(validOutput({ scoreR: -1 }))).toThrow();
  });

  test("non-integer score (5.5) is rejected", () => {
    expect(() => ScoringOutputSchema.parse(validOutput({ scoreR: 5.5 }))).toThrow();
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

  test("matchReason exceeding 500 chars is rejected", () => {
    expect(() =>
      ScoringOutputSchema.parse(validOutput({ matchReason: "a".repeat(501) })),
    ).toThrow();
  });

  test("matchReason at exactly 500 chars is accepted", () => {
    const result = ScoringOutputSchema.parse(validOutput({ matchReason: "a".repeat(500) }));
    expect(result.matchReason).toHaveLength(500);
  });

  test("evidenceQuotes with more than 5 elements is rejected", () => {
    expect(() =>
      ScoringOutputSchema.parse(
        validOutput({ evidenceQuotes: ["a", "b", "c", "d", "e", "f"] }),
      ),
    ).toThrow();
  });

  test("evidenceQuote element exceeding 200 chars is rejected", () => {
    expect(() =>
      ScoringOutputSchema.parse(
        validOutput({ evidenceQuotes: ["a".repeat(201)] }),
      ),
    ).toThrow();
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
});
