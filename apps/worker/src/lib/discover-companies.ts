import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output, stepCountIs } from "ai";

import {
  DiscoveryOutputSchema,
  type DiscoveredCompany,
} from "./discover-companies-schema";
import { buildDiscoveryPrompt } from "./discover-companies-prompt";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DiscoverCompaniesInput {
  apiKey: string;
  preferences: {
    industries: string[];
    companySizes: string[];
    companyStages: string[];
    productTypes: string[];
    exclusions: string[];
    hqGeographies: string[];
  };
  existingCompanyNames: string[];
  budget: number;
}

const MODEL_ID = "claude-haiku-4-5-20251001";
const MAX_STEPS = 5;

// ─── Service ────────────────────────────────────────────────────────────────

/**
 * Use Anthropic web search to discover companies matching user preferences.
 *
 * Calls generateText with the provider-defined web search tool, allowing
 * Claude to perform multiple searches and synthesize results into a
 * structured list of companies.
 *
 * Returns an empty array on any failure (API error, parse error).
 */
export async function discoverCompanies(
  input: DiscoverCompaniesInput,
): Promise<DiscoveredCompany[]> {
  const { apiKey, preferences, existingCompanyNames, budget } = input;

  const promptParts = buildDiscoveryPrompt({
    industries: preferences.industries,
    companySizes: preferences.companySizes,
    companyStages: preferences.companyStages,
    productTypes: preferences.productTypes,
    exclusions: preferences.exclusions,
    hqGeographies: preferences.hqGeographies,
    existingCompanyNames,
    budget,
  });

  try {
    const anthropic = createAnthropic({ apiKey });
    const model = anthropic(MODEL_ID);

    const result = await generateText({
      model,
      tools: {
        web_search: anthropic.tools.webSearch_20250305(),
      },
      output: Output.object({ schema: DiscoveryOutputSchema }),
      stopWhen: stepCountIs(MAX_STEPS),
      system: promptParts.system,
      prompt: promptParts.user,
    });

    const discoveryOutput = result.output;
    if (!discoveryOutput) {
      console.warn("[discover] AI returned no structured output");
      return [];
    }

    console.info(
      `[discover] AI returned ${discoveryOutput.companies.length} companies`,
    );
    return discoveryOutput.companies;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[discover] AI web search failed: ${message}`);
    return [];
  }
}
