import type {
  ConversationState,
  PreferencesDraft,
  DraftValidationResult,
} from "./schemas";
import { ConversationStateSchema } from "./schemas";
import { STEPS, getStepIndex } from "./steps";

// ─── State Creation ────────────────────────────────────────────────────────

/** Create a fresh conversation state with an empty draft at step 0. */
export function createInitialState(): ConversationState {
  const now = new Date().toISOString();
  return {
    currentStepIndex: 0,
    draft: {},
    completedSteps: [],
    status: "in_progress",
    createdAt: now,
    updatedAt: now,
  };
}

// ─── State Mutations (all return new state, never mutate) ──────────────────

/** Merge extracted fields from a step into the draft. */
export function applyExtraction(
  state: ConversationState,
  stepSlug: string,
  extraction: Record<string, unknown>,
): ConversationState {
  // Strip LLM meta-fields that are not part of the draft
  const META_KEYS = new Set([
    "confidence",
    "clarificationNeeded",
    "clarificationQuestion",
  ]);
  const draftFields = Object.fromEntries(
    Object.entries(extraction).filter(([key]) => !META_KEYS.has(key)),
  );

  const updatedDraft = { ...state.draft, ...draftFields };
  const completedSteps = state.completedSteps.includes(stepSlug)
    ? state.completedSteps
    : [...state.completedSteps, stepSlug];

  return {
    ...state,
    draft: updatedDraft,
    completedSteps,
    updatedAt: new Date().toISOString(),
  };
}

/** Advance to the next step in the sequence. */
export function advanceStep(state: ConversationState): ConversationState {
  const nextIndex = state.currentStepIndex + 1;

  // If we've passed the last step, move to review
  if (nextIndex >= STEPS.length) {
    return {
      ...state,
      currentStepIndex: STEPS.length - 1,
      status: "review",
      updatedAt: new Date().toISOString(),
    };
  }

  // If the next step is the review step, transition to review status
  const nextStep = STEPS[nextIndex];
  if (nextStep && nextStep.slug === "review") {
    return {
      ...state,
      currentStepIndex: nextIndex,
      status: "review",
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    ...state,
    currentStepIndex: nextIndex,
    updatedAt: new Date().toISOString(),
  };
}

/** Skip the current step (only allowed for skippable steps). */
export function skipCurrentStep(state: ConversationState): ConversationState {
  const currentStep = STEPS[state.currentStepIndex];
  if (!currentStep || !currentStep.skippable) {
    return state;
  }

  const completedSteps = state.completedSteps.includes(currentStep.slug)
    ? state.completedSteps
    : [...state.completedSteps, currentStep.slug];

  return advanceStep({
    ...state,
    completedSteps,
    updatedAt: new Date().toISOString(),
  });
}

/** Jump to a specific step by slug (used during review editing). */
export function goToStep(
  state: ConversationState,
  stepSlug: string,
): ConversationState {
  const index = getStepIndex(stepSlug);
  if (index === -1) return state;

  const step = STEPS[index];
  return {
    ...state,
    currentStepIndex: index,
    status: step?.slug === "review" ? "review" : "in_progress",
    updatedAt: new Date().toISOString(),
  };
}

/** Mark the conversation as completed. */
export function markCompleted(state: ConversationState): ConversationState {
  return {
    ...state,
    status: "completed",
    updatedAt: new Date().toISOString(),
  };
}

// ─── Validation ────────────────────────────────────────────────────────────

/** Required fields that must be present in the draft before finalization. */
const REQUIRED_DRAFT_FIELDS: { field: keyof PreferencesDraft; stepSlug: string }[] = [
  { field: "targetTitles", stepSlug: "target_roles" },
  { field: "targetSeniority", stepSlug: "target_seniority" },
  { field: "coreSkills", stepSlug: "core_skills" },
  { field: "locationPreferences", stepSlug: "location" },
  { field: "industries", stepSlug: "industries" },
  { field: "companySizes", stepSlug: "company_sizes" },
];

/** Check whether all required fields are populated in the draft. */
export function validateDraft(draft: PreferencesDraft): DraftValidationResult {
  const missingRequired: string[] = [];

  for (const { field, stepSlug } of REQUIRED_DRAFT_FIELDS) {
    const value = draft[field];
    if (value === undefined || value === null) {
      missingRequired.push(stepSlug);
      continue;
    }
    // For locationPreferences, check that tiers array is non-empty
    if (field === "locationPreferences" && typeof value === "object" && !Array.isArray(value)) {
      const lp = value as { tiers?: unknown[] };
      if (!lp.tiers || lp.tiers.length === 0) {
        missingRequired.push(stepSlug);
      }
      continue;
    }
    // For arrays, check they have at least one item
    if (Array.isArray(value) && value.length === 0) {
      missingRequired.push(stepSlug);
    }
  }

  return {
    valid: missingRequired.length === 0,
    missingRequired,
  };
}

// ─── Serialization ─────────────────────────────────────────────────────────

/**
 * Parse a JSONB state value from the database.
 * Uses lenient parsing: if the strict schema fails (e.g., enum values
 * changed between deploys), falls back to casting the raw value.
 * This prevents schema evolution from crashing in-progress conversations.
 */
export function deserializeState(raw: unknown): ConversationState {
  const result = ConversationStateSchema.safeParse(raw);
  if (result.success) return result.data;

  // Fallback: trust the JSONB structure, which was valid when it was written
  console.warn("Conversation state schema mismatch, using raw state:", result.error.message);
  return raw as ConversationState;
}

/** Serialize state for storage — returns a plain object safe for JSONB. */
export function serializeState(
  state: ConversationState,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
}

// ─── Default Weights ───────────────────────────────────────────────────────

/** Default dimension weights, applied when user skips the weights step. */
export const DEFAULT_WEIGHTS: Pick<
  PreferencesDraft,
  | "weightRole"
  | "weightSkills"
  | "weightLocation"
  | "weightCompensation"
  | "weightDomain"
> = {
  weightRole: 0.25,
  weightSkills: 0.25,
  weightLocation: 0.2,
  weightCompensation: 0.15,
  weightDomain: 0.15,
};

/** Apply default weights to the draft if no weights are set. */
export function applyDefaultWeights(
  draft: PreferencesDraft,
): PreferencesDraft {
  if (
    draft.weightRole !== undefined &&
    draft.weightSkills !== undefined &&
    draft.weightLocation !== undefined &&
    draft.weightCompensation !== undefined &&
    draft.weightDomain !== undefined
  ) {
    return draft;
  }
  return { ...draft, ...DEFAULT_WEIGHTS };
}
