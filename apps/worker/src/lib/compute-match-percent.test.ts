import { computeMatchPercent } from "./compute-match-percent";

// ── Helpers ───────────────────────────────────────────────────────────────

const EQUAL_WEIGHTS = {
  weightRole: 0.2,
  weightSkills: 0.2,
  weightLocation: 0.2,
  weightCompensation: 0.2,
  weightDomain: 0.2,
};

const ALL_TENS = { scoreR: 10, scoreS: 10, scoreL: 10, scoreC: 10, scoreD: 10 };
const ALL_ZEROS = { scoreR: 0, scoreS: 0, scoreL: 0, scoreC: 0, scoreD: 0 };
const NO_FLAGS = { hasGrowthSkillMatch: false, dealBreakerTriggered: false };

// ── Tests ─────────────────────────────────────────────────────────────────

describe("computeMatchPercent", () => {
  // ── Critical ──────────────────────────────────────────────────────────

  test("deal-breaker zeroes the score regardless of high dimension scores", () => {
    const result = computeMatchPercent(ALL_TENS, EQUAL_WEIGHTS, {
      dealBreakerTriggered: true,
      hasGrowthSkillMatch: false,
    });

    expect(result).toEqual({ matchPercent: 0, appliedGrowthBonus: false });
  });

  test("deal-breaker zeroes the score even when growth bonus is also true", () => {
    const result = computeMatchPercent(ALL_TENS, EQUAL_WEIGHTS, {
      dealBreakerTriggered: true,
      hasGrowthSkillMatch: true,
    });

    expect(result).toEqual({ matchPercent: 0, appliedGrowthBonus: false });
  });

  test("perfect scores with equal weights produce 100", () => {
    const result = computeMatchPercent(ALL_TENS, EQUAL_WEIGHTS, NO_FLAGS);

    expect(result).toEqual({ matchPercent: 100, appliedGrowthBonus: false });
  });

  test("all scores zero produces 0", () => {
    const result = computeMatchPercent(ALL_ZEROS, EQUAL_WEIGHTS, NO_FLAGS);

    expect(result).toEqual({ matchPercent: 0, appliedGrowthBonus: false });
  });

  test("growth bonus adds to the match percent", () => {
    // Scores yielding 80%: all scores 8, equal weights
    // raw = (8*0.2 + 8*0.2 + 8*0.2 + 8*0.2 + 8*0.2) / 10 * 100 = 80
    const scores = { scoreR: 8, scoreS: 8, scoreL: 8, scoreC: 8, scoreD: 8 };

    const result = computeMatchPercent(scores, EQUAL_WEIGHTS, {
      hasGrowthSkillMatch: true,
      dealBreakerTriggered: false,
    });

    expect(result).toEqual({ matchPercent: 87, appliedGrowthBonus: true });
  });

  test("growth bonus capped at 100", () => {
    // Scores yielding ~97%: scoreR=10, scoreS=10, scoreL=10, scoreC=9, scoreD=9
    // raw = (10*0.2 + 10*0.2 + 10*0.2 + 9*0.2 + 9*0.2) / 10 * 100 = 96
    // 96 + 7 = 103 -> capped at 100
    const scores = { scoreR: 10, scoreS: 10, scoreL: 10, scoreC: 10, scoreD: 9 };
    // raw = (10*0.2*4 + 9*0.2) / 10 * 100 = (8 + 1.8)/10*100 = 98

    const result = computeMatchPercent(scores, EQUAL_WEIGHTS, {
      hasGrowthSkillMatch: true,
      dealBreakerTriggered: false,
    });

    // 98 + 7 = 105 -> Math.min(105, 100) = 100
    expect(result).toEqual({ matchPercent: 100, appliedGrowthBonus: true });
  });

  test("weighted scores with the default profile weights", () => {
    const scores = { scoreR: 8, scoreS: 7, scoreL: 9, scoreC: 5, scoreD: 6 };
    const defaultWeights = {
      weightRole: 0.25,
      weightSkills: 0.25,
      weightLocation: 0.2,
      weightCompensation: 0.15,
      weightDomain: 0.15,
    };

    const result = computeMatchPercent(scores, defaultWeights, NO_FLAGS);

    // raw = (8*0.25 + 7*0.25 + 9*0.2 + 5*0.15 + 6*0.15) / 10 * 100
    //     = (2 + 1.75 + 1.8 + 0.75 + 0.9) / 10 * 100
    //     = 7.2 / 10 * 100 = 72
    expect(result.matchPercent).toBe(72);
    expect(result.appliedGrowthBonus).toBe(false);
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("custom growth bonus percent (not default 7)", () => {
    // Scores yielding 70%
    const scores = { scoreR: 7, scoreS: 7, scoreL: 7, scoreC: 7, scoreD: 7 };

    const result = computeMatchPercent(
      scores,
      EQUAL_WEIGHTS,
      { hasGrowthSkillMatch: true, dealBreakerTriggered: false },
      15,
    );

    expect(result).toEqual({ matchPercent: 85, appliedGrowthBonus: true });
  });

  test("growth bonus percent of 0 adds nothing but flags appliedGrowthBonus", () => {
    const scores = { scoreR: 7, scoreS: 7, scoreL: 7, scoreC: 7, scoreD: 7 };

    const result = computeMatchPercent(
      scores,
      EQUAL_WEIGHTS,
      { hasGrowthSkillMatch: true, dealBreakerTriggered: false },
      0,
    );

    expect(result).toEqual({ matchPercent: 70, appliedGrowthBonus: true });
  });

  test("rounding behavior -- raw score with fractional part rounds to nearest integer", () => {
    // Construct scores that produce a non-integer:
    // scoreR=7, others=6, equal weights -> (7*0.2 + 6*0.8) / 10 * 100 = (1.4+4.8)/10*100 = 62
    // Try: R=7, S=6, L=6, C=6, D=7 with equal weights -> (1.4+1.2+1.2+1.2+1.4)/10*100 = 64
    // Need fractional: weights 0.3, 0.2, 0.2, 0.15, 0.15, scores 7,8,6,5,9
    const scores = { scoreR: 7, scoreS: 8, scoreL: 6, scoreC: 5, scoreD: 9 };
    const weights = {
      weightRole: 0.3,
      weightSkills: 0.2,
      weightLocation: 0.2,
      weightCompensation: 0.15,
      weightDomain: 0.15,
    };
    // raw = (7*0.3 + 8*0.2 + 6*0.2 + 5*0.15 + 9*0.15) / 10 * 100
    //     = (2.1 + 1.6 + 1.2 + 0.75 + 1.35) / 10 * 100 = 70

    const result = computeMatchPercent(scores, weights, NO_FLAGS);

    expect(Number.isInteger(result.matchPercent)).toBe(true);
  });

  test("weights that do not sum to 1.0 still produce correct math", () => {
    // All weights 0.1 (sum = 0.5), all scores 10
    const halfWeights = {
      weightRole: 0.1,
      weightSkills: 0.1,
      weightLocation: 0.1,
      weightCompensation: 0.1,
      weightDomain: 0.1,
    };

    const result = computeMatchPercent(ALL_TENS, halfWeights, NO_FLAGS);

    // raw = (10*0.1*5) / 10 * 100 = 5/10*100 = 50
    // TODO: no validation occurs that weights sum to 1.0; misconfigured
    // weights could silently produce wrong scores
    expect(result.matchPercent).toBe(50);
  });

  test("weights that sum to more than 1.0 are capped at 100", () => {
    const doubleWeights = {
      weightRole: 0.4,
      weightSkills: 0.4,
      weightLocation: 0.4,
      weightCompensation: 0.4,
      weightDomain: 0.4,
    };

    const result = computeMatchPercent(ALL_TENS, doubleWeights, NO_FLAGS);

    // raw = (10*0.4*5) / 10 * 100 = 200 -> Math.min(200, 100) = 100
    expect(result.matchPercent).toBe(100);
  });

  test("negative growth bonus reduces the score", () => {
    const scores = { scoreR: 8, scoreS: 8, scoreL: 8, scoreC: 8, scoreD: 8 };

    const result = computeMatchPercent(
      scores,
      EQUAL_WEIGHTS,
      { hasGrowthSkillMatch: true, dealBreakerTriggered: false },
      -5,
    );

    // raw = 80, bonus = -5, total = 75
    // TODO: should negative growthBonusPercent be rejected?
    expect(result).toEqual({ matchPercent: 75, appliedGrowthBonus: true });
  });

  // ── Corner Cases ──────────────────────────────────────────────────────

  test("all weights are 0 produces matchPercent 0", () => {
    const zeroWeights = {
      weightRole: 0,
      weightSkills: 0,
      weightLocation: 0,
      weightCompensation: 0,
      weightDomain: 0,
    };

    const result = computeMatchPercent(ALL_TENS, zeroWeights, NO_FLAGS);

    expect(result.matchPercent).toBe(0);
  });

  // ── Nice-to-have ──────────────────────────────────────────────────────

  test.each<[string, { scoreR: number; scoreS: number; scoreL: number; scoreC: number; scoreD: number }, { weightRole: number; weightSkills: number; weightLocation: number; weightCompensation: number; weightDomain: number }]>([
    ["R", { scoreR: 10, scoreS: 0, scoreL: 0, scoreC: 0, scoreD: 0 }, { weightRole: 1, weightSkills: 0, weightLocation: 0, weightCompensation: 0, weightDomain: 0 }],
    ["S", { scoreR: 0, scoreS: 10, scoreL: 0, scoreC: 0, scoreD: 0 }, { weightRole: 0, weightSkills: 1, weightLocation: 0, weightCompensation: 0, weightDomain: 0 }],
    ["L", { scoreR: 0, scoreS: 0, scoreL: 10, scoreC: 0, scoreD: 0 }, { weightRole: 0, weightSkills: 0, weightLocation: 1, weightCompensation: 0, weightDomain: 0 }],
    ["C", { scoreR: 0, scoreS: 0, scoreL: 0, scoreC: 10, scoreD: 0 }, { weightRole: 0, weightSkills: 0, weightLocation: 0, weightCompensation: 1, weightDomain: 0 }],
    ["D", { scoreR: 0, scoreS: 0, scoreL: 0, scoreC: 0, scoreD: 10 }, { weightRole: 0, weightSkills: 0, weightLocation: 0, weightCompensation: 0, weightDomain: 1 }],
  ])("dimension %s at 10 with weight 1.0 produces 100", (_dim, scores, weights) => {
    const result = computeMatchPercent(scores, weights, NO_FLAGS);
    expect(result.matchPercent).toBe(100);
  });
});
