import { createLogger } from "@gjs/logger";

const log = createLogger("prompt");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DiscoveryPromptInput {
  industries: string[];
  companySizes: string[];
  companyStages: string[];
  productTypes: string[];
  exclusions: string[];
  hqGeographies: string[];
  existingCompanyNames: string[];
  budget: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function joinOrNone(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "None specified";
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a company research assistant. Use web search to discover companies matching the user's criteria. Return structured data about each company.

## Instructions

- Search the web for companies that match ALL the criteria specified by the user.
- For each company you find, include the direct careers/jobs page URL if you can find it.
- If you cannot find a careers URL, set careersUrl to null. Do NOT guess or hallucinate a URL.
- Prefer companies that use Greenhouse, Lever, Ashby, or SmartRecruiters for their job boards, as these are the supported ATS platforms.
- Look for URLs on these domains: boards.greenhouse.io, jobs.lever.co, jobs.ashbyhq.com, jobs.smartrecruiters.com.
- Return industry tags in lowercase (e.g., "fintech", "developer_tools", "saas").
- Do not return companies that the user has listed as exclusions or already known.
- Focus on quality over quantity — only return companies that genuinely match the criteria.

## Output Format

After completing your web searches, respond with a single JSON object (no markdown fences, no prose before or after):

{"companies": [{"name": "...", "website": "...", "careersUrl": "..." or null, "industry": ["..."], "reasoning": "..."}]}`;

/**
 * Build the system and user prompts for the AI company discovery web search.
 */
export function buildDiscoveryPrompt(input: DiscoveryPromptInput): {
  system: string;
  user: string;
} {
  const {
    industries,
    companySizes,
    companyStages,
    productTypes,
    exclusions,
    hqGeographies,
    existingCompanyNames,
    budget,
  } = input;

  const exclusionList =
    exclusions.length > 0 || existingCompanyNames.length > 0
      ? [...exclusions, ...existingCompanyNames].join(", ")
      : "None";

  const user = `## Search Criteria

Industries: ${joinOrNone(industries)}
Company Sizes: ${joinOrNone(companySizes)}
Company Stages: ${joinOrNone(companyStages)}
Product Types: ${joinOrNone(productTypes)}
HQ Geographies: ${joinOrNone(hqGeographies)}

## Companies to Exclude (already known or excluded by user)

${exclusionList}

## Budget

Return up to ${budget} companies. Prioritize the best matches first.

## Task

Search the web to find companies matching the criteria above. For each company, find their careers/jobs page URL (especially on Greenhouse, Lever, Ashby, or SmartRecruiters). Return structured results.`;

  log.debug(
    {
      systemPromptLength: SYSTEM_PROMPT.length,
      userPromptLength: user.length,
      excludedCompanyCount: existingCompanyNames.length,
    },
    "Built discovery prompt",
  );

  return { system: SYSTEM_PROMPT, user };
}
