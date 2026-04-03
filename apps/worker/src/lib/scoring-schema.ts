import { z } from "zod";

/**
 * Zod schema for the structured LLM scoring output (RSLCD dimensions).
 *
 * No min/max/int constraints on scores — Anthropic's structured output
 * rejects these JSON Schema properties entirely. The prompt instructs
 * 0-10 integer scores; the handler clamps and rounds after parsing.
 */
export const ScoringOutputSchema = z.object({
  scoreR: z.number().describe("Role Fit score 0-10"),
  scoreS: z.number().describe("Skills Fit score 0-10"),
  scoreL: z.number().describe("Location Fit score 0-10"),
  scoreC: z.number().describe("Compensation Fit score 0-10"),
  scoreD: z.number().describe("Domain Fit score 0-10"),
  matchReason: z.string().describe("1-2 sentence summary of the match"),
  evidenceQuotes: z.array(z.string()).describe("Up to 5 supporting quotes from the job description"),
  hasGrowthSkillMatch: z.boolean(),
  dealBreakerTriggered: z.boolean(),
  dealBreakerReason: z.string().optional(),
});

export type ScoringOutput = z.infer<typeof ScoringOutputSchema>;
