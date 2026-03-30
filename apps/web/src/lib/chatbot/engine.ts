import type { ConversationState, StructuredControlConfig } from "./schemas";
import { STEPS } from "./steps";
import type { ConversationStep } from "./steps";
import {
  createInitialState,
  applyExtraction,
  advanceStep,
  skipCurrentStep,
  applyDefaultWeights,
} from "./state";
import type { PreferenceCollectionLlm } from "@/lib/llm/preference-llm";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Sentinel value sent by the Skip button in the UI. */
const SKIP_SENTINEL = "__SKIP__";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EngineMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProcessMessageResult {
  updatedState: ConversationState;
  assistantMessage: string;
  structuredControls?: StructuredControlConfig;
  messages: EngineMessage[];
}

export interface InitializeConversationResult {
  state: ConversationState;
  assistantMessage: string;
  structuredControls?: StructuredControlConfig;
  messages: EngineMessage[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build the structured controls config for a step, if applicable. */
function getStructuredControls(
  step: ConversationStep | undefined,
): StructuredControlConfig | undefined {
  if (!step) return undefined;
  if (step.inputType === "free_text") return undefined;
  return step.structuredConfig;
}

/** Build the assistant greeting message for a step. */
function buildStepMessage(step: ConversationStep): string {
  if (step.helpText) {
    return `${step.question}\n\n${step.helpText}`;
  }
  return step.question;
}

// ─── Initialize Conversation ────────────────────────────────────────────────

/**
 * Initialize a new conversation, returning the first step's question and controls.
 * Does not require an LLM instance since the first message is deterministic.
 */
export function initializeConversation(): InitializeConversationResult {
  const state = createInitialState();
  const firstStep = STEPS[0];

  if (!firstStep) {
    throw new EngineError("No conversation steps defined");
  }

  const assistantMessage = buildStepMessage(firstStep);

  return {
    state,
    assistantMessage,
    structuredControls: getStructuredControls(firstStep),
    messages: [{ role: "assistant", content: assistantMessage }],
  };
}

// ─── Process Message ────────────────────────────────────────────────────────

/**
 * Process a user message through the conversation engine.
 *
 * Flow:
 * 1. If message is SKIP_SENTINEL and step is skippable, skip without LLM call
 * 2. If current step is structured-only, parse JSON directly (no LLM needed)
 * 3. If free_text/hybrid, call LLM to extract structured data
 * 4. If extraction says clarificationNeeded, return clarification (don't advance)
 * 5. Apply extraction to draft
 * 6. Advance to next step
 * 7. If entering review status, generate summary via LLM
 * 8. Build assistant response from next step
 * 9. Return updated state + response + structured controls
 *
 * The engine returns messages to persist but does not manage DB storage directly.
 * That responsibility belongs to the API route layer.
 */
export async function processMessage(
  state: ConversationState,
  userMessage: string,
  llm: PreferenceCollectionLlm | null,
): Promise<ProcessMessageResult> {
  const currentStep = STEPS[state.currentStepIndex];
  if (!currentStep) {
    throw new EngineError(
      `Invalid step index: ${String(state.currentStepIndex)}`,
    );
  }

  const messages: EngineMessage[] = [{ role: "user", content: userMessage }];

  let newState = state;

  // 1. Handle skip
  if (userMessage === SKIP_SENTINEL) {
    if (!currentStep.skippable) {
      const errorMsg =
        "This step is required and cannot be skipped. Please provide your answer.";
      messages.push({ role: "assistant", content: errorMsg });
      return {
        updatedState: newState,
        assistantMessage: errorMsg,
        structuredControls: getStructuredControls(currentStep),
        messages,
      };
    }

    newState = skipCurrentStep(newState);
    newState = applyDefaultWeightsIfNeeded(newState);
    return buildAdvanceResponse(newState, llm, messages);
  }

  // 2. Structured-only steps: parse JSON directly, no LLM needed
  if (currentStep.inputType === "structured") {
    const parsed = parseStructuredInput(userMessage, currentStep);
    newState = applyExtraction(newState, currentStep.slug, parsed);
    newState = advanceStep(newState);
    newState = applyDefaultWeightsIfNeeded(newState);
    return buildAdvanceResponse(newState, llm, messages);
  }

  // 3. Free-text or hybrid steps require LLM
  if (!llm) {
    throw new EngineError(
      "LLM service required for free-text/hybrid steps but not provided",
    );
  }

  const extraction = await llm.extractPartialPreferences({
    userText: userMessage,
    currentStep: currentStep.slug,
    currentDraft: newState.draft,
  });

  // 4. If clarification needed, ask follow-up and don't advance
  if (extraction.clarificationNeeded) {
    const clarification =
      typeof extraction.clarificationQuestion === "string" &&
      extraction.clarificationQuestion.length > 0
        ? extraction.clarificationQuestion
        : await llm.proposeClarification({
            userText: userMessage,
            currentStep: currentStep.slug,
            currentDraft: newState.draft,
          });

    messages.push({ role: "assistant", content: clarification });

    return {
      updatedState: newState,
      assistantMessage: clarification,
      structuredControls: getStructuredControls(currentStep),
      messages,
    };
  }

  // 5. Apply extraction to draft
  newState = applyExtraction(newState, currentStep.slug, extraction);

  // 6. Advance to next step
  newState = advanceStep(newState);
  newState = applyDefaultWeightsIfNeeded(newState);

  return buildAdvanceResponse(newState, llm, messages);
}

// ─── Internal Helpers ──────────────────────────────────────────────────────

/**
 * Build the response after advancing to the next step.
 * Handles review step summary generation and normal step messages.
 */
async function buildAdvanceResponse(
  state: ConversationState,
  llm: PreferenceCollectionLlm | null,
  messages: EngineMessage[],
): Promise<ProcessMessageResult> {
  const nextStep = STEPS[state.currentStepIndex];

  let assistantMessage: string;

  if (state.status === "review") {
    // At the review step, generate a summary of all collected preferences
    if (llm) {
      assistantMessage = await llm.summarizeDraft({
        currentDraft: state.draft,
      });
    } else {
      // Fallback: use the review step's static question if no LLM available
      assistantMessage = nextStep
        ? nextStep.question
        : "Here is a summary of your preferences. Please review and confirm.";
    }
  } else if (nextStep) {
    assistantMessage = buildStepMessage(nextStep);
  } else {
    assistantMessage = "All steps completed. Please review your preferences.";
  }

  messages.push({ role: "assistant", content: assistantMessage });

  return {
    updatedState: state,
    assistantMessage,
    structuredControls: getStructuredControls(nextStep),
    messages,
  };
}

/**
 * Parse structured input from the UI (JSON-serialized form values).
 * Structured controls serialize their selections as JSON strings.
 */
function parseStructuredInput(
  input: string,
  step: ConversationStep,
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(input);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new EngineError(
        `Structured input for step "${step.slug}" must be a JSON object`,
      );
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof EngineError) throw error;
    throw new EngineError(
      `Invalid JSON input for structured step "${step.slug}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Apply default dimension weights when entering review if the user
 * skipped the weights step or hasn't set them yet.
 */
function applyDefaultWeightsIfNeeded(
  state: ConversationState,
): ConversationState {
  if (state.status !== "review") return state;
  const updatedDraft = applyDefaultWeights(state.draft);
  if (updatedDraft === state.draft) return state;
  return {
    ...state,
    draft: updatedDraft,
    updatedAt: new Date().toISOString(),
  };
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}
