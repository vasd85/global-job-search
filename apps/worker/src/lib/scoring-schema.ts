import { z } from "zod";

/** Zod schema for the structured LLM scoring output (RSLCD dimensions). */
export const ScoringOutputSchema = z.object({
  scoreR: z.number().int().min(0).max(10),
  scoreS: z.number().int().min(0).max(10),
  scoreL: z.number().int().min(0).max(10),
  scoreC: z.number().int().min(0).max(10),
  scoreD: z.number().int().min(0).max(10),
  matchReason: z.string().max(500),
  evidenceQuotes: z.array(z.string().max(200)).max(5),
  hasGrowthSkillMatch: z.boolean(),
  dealBreakerTriggered: z.boolean(),
  dealBreakerReason: z.string().max(200).optional(),
});

export type ScoringOutput = z.infer<typeof ScoringOutputSchema>;
