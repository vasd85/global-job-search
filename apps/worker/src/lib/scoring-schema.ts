import { z } from "zod";

/**
 * Signals extracted from the job description during the same L3 LLM call
 * that produces the scoring output. These are persisted to the `job` row
 * so that Level 2 filters for subsequent users can consume them without
 * re-invoking the LLM (cache warm-up / L3 → L2 promotion hypothesis,
 * plan §8).
 *
 * IMPORTANT: silence is NOT a "no" answer. The LLM must emit `"unknown"`
 * when the description does not clearly answer a given question. Emitting
 * `"no"` means the description explicitly said so (e.g. "no sponsorship
 * available", "must be based in the US", "locals only").
 */
export const ExtractedSignalsSchema = z.object({
  visaSponsorship: z
    .enum(["yes", "no", "unknown"])
    .describe(
      '"yes" only if the description explicitly offers visa sponsorship (H1B, blue card, skilled worker visa, etc). "no" only if it explicitly says sponsorship is not available. Otherwise "unknown".',
    ),
  relocationPackage: z
    .enum(["yes", "no", "unknown"])
    .describe(
      '"yes" only if a relocation package or paid relocation is explicitly offered. "no" only if the description says no relocation support. Otherwise "unknown".',
    ),
  workAuthRestriction: z
    .enum(["none", "citizens_only", "residents_only", "region_only", "unknown"])
    .describe(
      '"none" if the description does not restrict work authorization. "citizens_only" for "must be a US citizen" / country-specific citizen requirement. "residents_only" for "must have existing work authorization for any US employer" / "must hold a valid residence permit" — candidate needs their own permit. "region_only" for "EU citizens only" / "UK residents only" / multi-country region bundles. "unknown" if silence.',
    ),
  languageRequirements: z
    .array(z.string())
    .describe(
      'Explicit required languages. BCP-47 tags preferred ("en", "de", "fr"). Empty array if silence. Include proficiency when explicit (e.g. ["en-native", "de-b2"]) but the simple tag is fine.',
    ),
  travelPercent: z
    .number()
    .nullable()
    .describe(
      "Estimated required travel as a percent of working time, 0-100. null if silence.",
    ),
  securityClearance: z
    .string()
    .nullable()
    .describe(
      'Explicit clearance requirement ("US Secret", "UK SC", "NATO Cosmic"). null if silence.',
    ),
  shiftPattern: z
    .string()
    .nullable()
    .describe(
      'Shift/on-call description if explicit ("rotating on-call", "overnight shift", "24/7 ops"). null if silence.',
    ),
});

export type ExtractedSignals = z.infer<typeof ExtractedSignalsSchema>;

/**
 * Zod schema for the structured LLM scoring output (RSLCD dimensions).
 *
 * No min/max/int constraints on scores — Anthropic's structured output
 * rejects these JSON Schema properties entirely. The prompt instructs
 * 0-10 integer scores; the handler clamps and rounds after parsing.
 *
 * `extractedSignals` carries the per-job signals that the same LLM call
 * extracts from the description text. They are persisted on the `job` row
 * so future L2 filters do not need to re-invoke the LLM.
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
  extractedSignals: ExtractedSignalsSchema.describe(
    "Structured signals extracted from the description. Prefer 'unknown' / null / [] when the description does not address the point — do not guess.",
  ),
});

export type ScoringOutput = z.infer<typeof ScoringOutputSchema>;
