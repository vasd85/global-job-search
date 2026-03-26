import { z } from "zod";

// ─── Enums ─────────────────────────────────────────────────────────────────

export const SeniorityLevel = z.enum([
  "junior",
  "mid",
  "senior",
  "lead",
  "manager",
  "director",
  "vp",
]);
export type SeniorityLevel = z.infer<typeof SeniorityLevel>;

export const RemotePreference = z.enum([
  "remote_only",
  "hybrid_ok",
  "onsite_ok",
  "any",
]);
export type RemotePreference = z.infer<typeof RemotePreference>;

export const CompanySize = z.enum(["startup", "scaleup", "enterprise"]);
export type CompanySize = z.infer<typeof CompanySize>;

export const CompanyStage = z.enum([
  "seed",
  "series_a",
  "series_b",
  "series_c",
  "late_stage",
  "public",
]);
export type CompanyStage = z.infer<typeof CompanyStage>;

export const WorkFormat = z.enum(["remote_first", "hybrid", "onsite"]);
export type WorkFormat = z.infer<typeof WorkFormat>;

export const ConversationStatus = z.enum([
  "in_progress",
  "review",
  "completed",
]);
export type ConversationStatus = z.infer<typeof ConversationStatus>;

export const ExtractionConfidence = z.enum(["high", "medium", "low"]);
export type ExtractionConfidence = z.infer<typeof ExtractionConfidence>;

// ─── Location Preference Tiers ──────────────────────────────────────────────

/** Work format per tier — more expressive than the global RemotePreference enum. */
export const TierWorkFormat = z.enum([
  "remote",
  "relocation",
  "hybrid",
  "onsite",
]);
export type TierWorkFormat = z.infer<typeof TierWorkFormat>;

/** How the geographic scope of a tier is expressed. */
export const LocationScopeType = z.enum([
  "countries",
  "regions",
  "timezones",
  "cities",
  "any",
]);
export type LocationScopeType = z.infer<typeof LocationScopeType>;

/** Geographic scope for a single location preference tier. */
export const LocationScopeSchema = z.object({
  type: LocationScopeType,
  /** Included locations/regions/timezone ranges */
  include: z
    .array(z.string())
    .describe("List of included locations, regions, timezone ranges, or cities"),
  /** Excluded locations within the scope (e.g., 'Cyprus' excluded from 'EU') */
  exclude: z
    .array(z.string())
    .optional()
    .describe("Locations explicitly excluded from the scope"),
});
export type LocationScope = z.infer<typeof LocationScopeSchema>;

/** A single ranked location preference tier. */
export const LocationPreferenceTierSchema = z.object({
  /** 1-based rank: 1 = most preferred */
  rank: z
    .number()
    .int()
    .min(1)
    .describe("Priority rank, 1 = most preferred"),
  /** Work formats acceptable for this tier (can be multiple) */
  workFormats: z
    .array(TierWorkFormat)
    .min(1)
    .describe("Acceptable work formats for this tier"),
  /** Geographic scope for this tier */
  scope: LocationScopeSchema,
  /** Free-text qualitative constraint, if any */
  qualitativeConstraint: z
    .string()
    .optional()
    .describe(
      "Qualitative constraint like 'countries with similar living standards' or 'tech hub cities'",
    ),
  /** User's original phrasing for this tier (aids review and debugging) */
  originalText: z
    .string()
    .optional()
    .describe("The user's original phrasing that produced this tier"),
});
export type LocationPreferenceTier = z.infer<
  typeof LocationPreferenceTierSchema
>;

/** Full location preferences: an ordered collection of tiers. */
export const LocationPreferencesSchema = z.object({
  tiers: z
    .array(LocationPreferenceTierSchema)
    .min(1)
    .max(5)
    .describe("Ranked location preference tiers, ordered by priority"),
});
export type LocationPreferences = z.infer<typeof LocationPreferencesSchema>;

// ─── Preference Draft (all fields optional — filled incrementally) ─────────

export const PreferencesDraftSchema = z.object({
  // Job preferences (maps to user_profiles)
  targetTitles: z.array(z.string()).optional(),
  targetSeniority: z.array(SeniorityLevel).optional(),
  coreSkills: z.array(z.string()).optional(),
  growthSkills: z.array(z.string()).optional(),
  avoidSkills: z.array(z.string()).optional(),
  dealBreakers: z.array(z.string()).optional(),
  minSalary: z.number().int().positive().optional(),
  targetSalary: z.number().int().positive().optional(),
  salaryCurrency: z.string().optional(),
  locationPreferences: LocationPreferencesSchema.optional(),
  // Deprecated: kept for backward compat with in-progress conversations
  preferredLocations: z.array(z.string()).optional(),
  remotePreference: RemotePreference.optional(),

  // Dimension weights (defaults applied at finalization)
  weightRole: z.number().min(0).max(1).optional(),
  weightSkills: z.number().min(0).max(1).optional(),
  weightLocation: z.number().min(0).max(1).optional(),
  weightCompensation: z.number().min(0).max(1).optional(),
  weightDomain: z.number().min(0).max(1).optional(),

  // Company preferences (maps to user_company_preferences)
  industries: z.array(z.string()).optional(),
  companySizes: z.array(CompanySize).optional(),
  companyStages: z.array(CompanyStage).optional(),
  workFormat: WorkFormat.optional(),
  hqGeographies: z.array(z.string()).optional(),
  productTypes: z.array(z.string()).optional(),
  exclusions: z.array(z.string()).optional(),
});
export type PreferencesDraft = z.infer<typeof PreferencesDraftSchema>;

// ─── Conversation State (persisted as JSONB) ───────────────────────────────

export const ConversationStateSchema = z.object({
  currentStepIndex: z.number().int().min(0),
  draft: PreferencesDraftSchema,
  completedSteps: z.array(z.string()),
  status: ConversationStatus,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConversationState = z.infer<typeof ConversationStateSchema>;

// ─── Extraction Schemas (one per step type, used by generateObject) ────────

export const TargetRolesExtractionSchema = z.object({
  targetTitles: z
    .array(z.string())
    .describe("Job titles the user is looking for"),
  confidence: ExtractionConfidence.describe(
    "How confident you are in the extraction",
  ),
  clarificationNeeded: z
    .boolean()
    .describe("Whether the input needs clarification"),
  clarificationQuestion: z
    .string()
    .optional()
    .describe("Follow-up question if clarification needed"),
});
export type TargetRolesExtraction = z.infer<typeof TargetRolesExtractionSchema>;

export const CoreSkillsExtractionSchema = z.object({
  coreSkills: z
    .array(z.string())
    .describe("Skills the user is strong at and wants to keep using"),
  confidence: ExtractionConfidence.describe(
    "How confident you are in the extraction",
  ),
  clarificationNeeded: z
    .boolean()
    .describe("Whether the input needs clarification"),
  clarificationQuestion: z
    .string()
    .optional()
    .describe("Follow-up question if clarification needed"),
});
export type CoreSkillsExtraction = z.infer<typeof CoreSkillsExtractionSchema>;

export const GrowthSkillsExtractionSchema = z.object({
  growthSkills: z
    .array(z.string())
    .describe("Skills the user wants to learn or grow into"),
  confidence: ExtractionConfidence.describe(
    "How confident you are in the extraction",
  ),
  clarificationNeeded: z
    .boolean()
    .describe("Whether the input needs clarification"),
  clarificationQuestion: z
    .string()
    .optional()
    .describe("Follow-up question if clarification needed"),
});
export type GrowthSkillsExtraction = z.infer<
  typeof GrowthSkillsExtractionSchema
>;

export const AvoidSkillsExtractionSchema = z.object({
  avoidSkills: z
    .array(z.string())
    .describe("Skills or technologies the user wants to avoid"),
  confidence: ExtractionConfidence.describe(
    "How confident you are in the extraction",
  ),
  clarificationNeeded: z
    .boolean()
    .describe("Whether the input needs clarification"),
  clarificationQuestion: z
    .string()
    .optional()
    .describe("Follow-up question if clarification needed"),
});
export type AvoidSkillsExtraction = z.infer<typeof AvoidSkillsExtractionSchema>;

export const DealBreakersExtractionSchema = z.object({
  dealBreakers: z
    .array(z.string())
    .describe(
      "Absolute deal-breakers for the user (e.g., requires security clearance, travel >50%)",
    ),
  confidence: ExtractionConfidence.describe(
    "How confident you are in the extraction",
  ),
  clarificationNeeded: z
    .boolean()
    .describe("Whether the input needs clarification"),
  clarificationQuestion: z
    .string()
    .optional()
    .describe("Follow-up question if clarification needed"),
});
export type DealBreakersExtraction = z.infer<
  typeof DealBreakersExtractionSchema
>;

export const LocationExtractionSchema = z.object({
  locationPreferences: LocationPreferencesSchema.describe(
    "Ranked location preference tiers extracted from the user's input",
  ),
  confidence: ExtractionConfidence.describe(
    "How confident you are in the extraction",
  ),
  clarificationNeeded: z
    .boolean()
    .describe("Whether the input needs clarification"),
  clarificationQuestion: z
    .string()
    .optional()
    .describe("Follow-up question if clarification needed"),
});
export type LocationExtraction = z.infer<typeof LocationExtractionSchema>;

export const IndustriesExtractionSchema = z.object({
  industries: z
    .array(z.string())
    .describe(
      "Industries or domains the user is interested in (e.g., fintech, AI/ML, healthtech)",
    ),
  confidence: ExtractionConfidence.describe(
    "How confident you are in the extraction",
  ),
  clarificationNeeded: z
    .boolean()
    .describe("Whether the input needs clarification"),
  clarificationQuestion: z
    .string()
    .optional()
    .describe("Follow-up question if clarification needed"),
});
export type IndustriesExtraction = z.infer<typeof IndustriesExtractionSchema>;

export const HqGeographiesExtractionSchema = z.object({
  hqGeographies: z
    .array(z.string())
    .describe(
      "Preferred company HQ locations (affects timezone, visa, culture)",
    ),
  confidence: ExtractionConfidence.describe(
    "How confident you are in the extraction",
  ),
  clarificationNeeded: z
    .boolean()
    .describe("Whether the input needs clarification"),
  clarificationQuestion: z
    .string()
    .optional()
    .describe("Follow-up question if clarification needed"),
});
export type HqGeographiesExtraction = z.infer<
  typeof HqGeographiesExtractionSchema
>;

export const ProductTypesExtractionSchema = z.object({
  productTypes: z
    .array(z.string())
    .describe(
      "Types of products the user is interested in (e.g., B2B, B2C, developer tools, infra)",
    ),
  confidence: ExtractionConfidence.describe(
    "How confident you are in the extraction",
  ),
  clarificationNeeded: z
    .boolean()
    .describe("Whether the input needs clarification"),
  clarificationQuestion: z
    .string()
    .optional()
    .describe("Follow-up question if clarification needed"),
});
export type ProductTypesExtraction = z.infer<
  typeof ProductTypesExtractionSchema
>;

export const ExclusionsExtractionSchema = z.object({
  exclusions: z
    .array(z.string())
    .describe(
      "Explicit company or industry exclusions (e.g., outsourcing, agencies, gambling)",
    ),
  confidence: ExtractionConfidence.describe(
    "How confident you are in the extraction",
  ),
  clarificationNeeded: z
    .boolean()
    .describe("Whether the input needs clarification"),
  clarificationQuestion: z
    .string()
    .optional()
    .describe("Follow-up question if clarification needed"),
});
export type ExclusionsExtraction = z.infer<typeof ExclusionsExtractionSchema>;

// ─── API Input/Output Schemas ──────────────────────────────────────────────

export const MessageInputSchema = z.object({
  message: z.string().min(1),
  displayText: z.string().optional(),
});
export type MessageInput = z.infer<typeof MessageInputSchema>;

// ─── Step Input Types ──────────────────────────────────────────────────────

export const StepInputType = z.enum(["free_text", "structured", "hybrid"]);
export type StepInputType = z.infer<typeof StepInputType>;

export const StructuredControlType = z.enum([
  "multi_select",
  "single_select",
  "slider",
  "range",
]);
export type StructuredControlType = z.infer<typeof StructuredControlType>;

export const StructuredOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type StructuredOption = z.infer<typeof StructuredOptionSchema>;

export const StructuredControlConfigSchema = z.object({
  type: StructuredControlType,
  options: z.array(StructuredOptionSchema).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});
export type StructuredControlConfig = z.infer<
  typeof StructuredControlConfigSchema
>;

// ─── Draft Validation Result ───────────────────────────────────────────────

export interface DraftValidationResult {
  valid: boolean;
  missingRequired: string[];
}
