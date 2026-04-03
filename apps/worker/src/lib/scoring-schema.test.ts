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
});
