import { z } from "zod";

/**
 * Zod schema for the structured LLM scoring output (RSLCD dimensions).
 *
 * Scores use z.number() (not .int()) because Anthropic's structured output
 * rejects min/max constraints on the "integer" JSON Schema type.
 * Values are rounded to integers after parsing in the handler.
 */
export const ScoringOutputSchema = z.object({
  scoreR: z.number().min(0).max(10),
  scoreS: z.number().min(0).max(10),
  scoreL: z.number().min(0).max(10),
  scoreC: z.number().min(0).max(10),
  scoreD: z.number().min(0).max(10),
  matchReason: z.string(),
  evidenceQuotes: z.array(z.string()),
  hasGrowthSkillMatch: z.boolean(),
  dealBreakerTriggered: z.boolean(),
  dealBreakerReason: z.string().optional(),
});

export type ScoringOutput = z.infer<typeof ScoringOutputSchema>;
