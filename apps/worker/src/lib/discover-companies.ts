import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";

import {
  DiscoveryOutputSchema,
  type DiscoveredCompany,
  type DiscoveryOutput,
} from "./discover-companies-schema";
import { buildDiscoveryPrompt } from "./discover-companies-prompt";
import { debug } from "./logger";

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
const MAX_STEPS = 20;

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

    debug("discover", "Calling generateText", {
      modelId: MODEL_ID,
      maxSteps: MAX_STEPS,
      promptSummary: promptParts.user.slice(0, 200),
    });

    const result = await generateText({
      model,
      tools: {
        web_search: anthropic.tools.webSearch_20250305(),
      },
      stopWhen: stepCountIs(MAX_STEPS),
      system: promptParts.system,
      prompt: promptParts.user,
    });

    const rawText = result.text ?? "";
    debug("discover", "generateText returned", {
      stepCount: result.steps?.length,
      textLength: rawText.length,
    });

    const discoveryOutput = tryExtractJson(rawText);
    if (!discoveryOutput || discoveryOutput.companies.length === 0) {
      debug("discover", "No companies parsed from model text", {
        rawTextPreview: rawText.slice(0, 500),
      });
      console.warn("[discover] AI returned no parseable companies");
      return [];
    }

    console.info(
      `[discover] AI returned ${discoveryOutput.companies.length} companies`,
    );
    return discoveryOutput.companies;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[discover] AI web search failed: ${message}`);
    if (stack) {
      debug("discover", "Error stack trace", { stack });
    }
    return [];
  }
}

// ─── Fallback JSON extraction ──────────────────────────────────────────────

/**
 * Try to extract and validate a DiscoveryOutput from model text that isn't
 * pure JSON. Handles markdown-fenced JSON, JSON embedded in prose, etc.
 */
function tryExtractJson(text: string): DiscoveryOutput | null {
  // 1. Try stripping markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    const parsed = safeParse(fenceMatch[1]);
    if (parsed) return parsed;
  }

  // 2. Handle concatenated JSON objects from multi-step output.
  //    The AI SDK concatenates each step's output, producing e.g.:
  //    {"companies": []}{"companies": []}{"companies": [{...data...}]}
  //    Split on }{ boundaries and try each fragment (last one usually has data).
  if (text.includes("}{")) {
    const fragments = text.split(/\}\s*\{/).map((frag, i, arr) => {
      if (i === 0) return frag + "}";
      if (i === arr.length - 1) return "{" + frag;
      return "{" + frag + "}";
    });
    // Try fragments in reverse — last step most likely has the real data
    for (let i = fragments.length - 1; i >= 0; i--) {
      const parsed = safeParse(fragments[i]);
      if (parsed && parsed.companies.length > 0) return parsed;
    }
    // If none had data, try any valid one
    for (let i = fragments.length - 1; i >= 0; i--) {
      const parsed = safeParse(fragments[i]);
      if (parsed) return parsed;
    }
  }

  // 3. Try finding the first { ... } that looks like our schema
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart !== -1 && braceEnd > braceStart) {
    const parsed = safeParse(text.slice(braceStart, braceEnd + 1));
    if (parsed) return parsed;
  }

  return null;
}

function safeParse(jsonStr: string): DiscoveryOutput | null {
  try {
    const raw: unknown = JSON.parse(jsonStr);
    const result = DiscoveryOutputSchema.safeParse(raw);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
