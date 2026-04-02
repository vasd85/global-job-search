interface Scores {
  scoreR: number;
  scoreS: number;
  scoreL: number;
  scoreC: number;
  scoreD: number;
}

interface Weights {
  weightRole: number;
  weightSkills: number;
  weightLocation: number;
  weightCompensation: number;
  weightDomain: number;
}

interface ScoringFlags {
  hasGrowthSkillMatch: boolean;
  dealBreakerTriggered: boolean;
}

interface MatchPercentResult {
  matchPercent: number;
  appliedGrowthBonus: boolean;
}

/**
 * Compute the final matchPercent from RSLCD scores, user weights,
 * growth bonus, and deal-breaker logic.
 *
 * Each score is 0-10, weights should sum to ~1.0, result is 0-100.
 */
export function computeMatchPercent(
  scores: Scores,
  weights: Weights,
  scoringFlags: ScoringFlags,
  growthBonusPercent = 7,
): MatchPercentResult {
  // Deal-breaker immediately zeros the score
  if (scoringFlags.dealBreakerTriggered) {
    return { matchPercent: 0, appliedGrowthBonus: false };
  }

  // Weighted sum: each score (0-10) * weight, divided by 10, scaled to 100
  const raw =
    (scores.scoreR * weights.weightRole +
      scores.scoreS * weights.weightSkills +
      scores.scoreL * weights.weightLocation +
      scores.scoreC * weights.weightCompensation +
      scores.scoreD * weights.weightDomain) /
    10 *
    100;

  let matchPercent = raw;
  let appliedGrowthBonus = false;

  // Growth bonus: add bonus if job matches a growth skill
  if (scoringFlags.hasGrowthSkillMatch) {
    matchPercent += growthBonusPercent;
    appliedGrowthBonus = true;
  }

  // Cap at 100 and round to nearest integer
  matchPercent = Math.round(Math.min(matchPercent, 100));

  return { matchPercent, appliedGrowthBonus };
}
