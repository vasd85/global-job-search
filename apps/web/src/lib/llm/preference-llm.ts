import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject, generateText } from "ai";
import { z } from "zod";

import type { PreferencesDraft } from "@/lib/chatbot/schemas";
import { getStepBySlug } from "@/lib/chatbot/steps";
import {
  buildExtractionPrompt,
  buildSummaryPrompt,
  buildClarificationPrompt,
  buildRoleFamilyExpansionPrompt,
} from "./prompts";

// ─── Interface ──────────────────────────────────────────────────────────────

export interface PreferenceCollectionLlm {
  extractPartialPreferences(input: {
    userText: string;
    currentStep: string;
    currentDraft: PreferencesDraft;
  }): Promise<Record<string, unknown>>;

  summarizeDraft(input: { currentDraft: PreferencesDraft }): Promise<string>;

  proposeClarification(input: {
    userText: string;
    currentStep: string;
    currentDraft: PreferencesDraft;
  }): Promise<string>;

  proposeRoleFamilyExpansion(input: {
    targetRole: string;
    existingFamilies: string[];
  }): Promise<RoleFamilyExpansionResult>;
}

// ─── Role Family Expansion Schema ──────────────────────────────────────────

const RoleFamilyExpansionSchema = z.object({
  fitsExisting: z
    .boolean()
    .describe("Whether the title fits an existing role family"),
  existingFamily: z
    .string()
    .optional()
    .describe("The existing family it fits into, if fitsExisting is true"),
  suggestedFamily: z
    .string()
    .optional()
    .describe("Suggested new family name, if fitsExisting is false"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("How confident the suggestion is"),
});

export type RoleFamilyExpansionResult = z.infer<
  typeof RoleFamilyExpansionSchema
>;

// ─── Constants ──────────────────────────────────────────────────────────────

const MODEL_ID = "claude-sonnet-4-20250514";

// ─── Factory ────────────────────────────────────────────────────────────────

/**
 * Create a PreferenceCollectionLlm instance using the user's BYOK Anthropic key.
 * The apiKey is decrypted server-side and never reaches the client.
 */
export function createPreferenceLlm(apiKey: string): PreferenceCollectionLlm {
  const anthropic = createAnthropic({ apiKey });
  const model = anthropic(MODEL_ID);

  return {
    async extractPartialPreferences({ userText, currentStep, currentDraft }) {
      const step = getStepBySlug(currentStep);
      if (!step) {
        throw new PreferenceLlmError(
          `Unknown conversation step: ${currentStep}`,
        );
      }
      if (!step.extractionSchema) {
        throw new PreferenceLlmError(
          `Step "${currentStep}" does not have an extraction schema`,
        );
      }

      const { system, prompt } = buildExtractionPrompt(
        userText,
        step,
        currentDraft,
      );

      const result = await generateObject({
        model,
        schema: step.extractionSchema,
        system,
        prompt,
      });

      return result.object as Record<string, unknown>;
    },

    async summarizeDraft({ currentDraft }) {
      const { system, prompt } = buildSummaryPrompt(currentDraft);

      const { text } = await generateText({
        model,
        system,
        prompt,
      });

      return text;
    },

    async proposeClarification({ userText, currentStep, currentDraft }) {
      const step = getStepBySlug(currentStep);
      if (!step) {
        throw new PreferenceLlmError(
          `Unknown conversation step: ${currentStep}`,
        );
      }

      const { system, prompt } = buildClarificationPrompt(
        userText,
        step,
        currentDraft,
      );

      const { text } = await generateText({
        model,
        system,
        prompt,
      });

      return text;
    },

    async proposeRoleFamilyExpansion({ targetRole, existingFamilies }) {
      const { system, prompt } = buildRoleFamilyExpansionPrompt(
        targetRole,
        existingFamilies,
      );

      const result = await generateObject({
        model,
        schema: RoleFamilyExpansionSchema,
        system,
        prompt,
      });

      return result.object;
    },
  };
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class PreferenceLlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreferenceLlmError";
  }
}
