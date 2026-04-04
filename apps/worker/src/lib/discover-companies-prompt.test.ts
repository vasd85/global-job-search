import {
  buildDiscoveryPrompt,
  type DiscoveryPromptInput,
} from "./discover-companies-prompt";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeInput(
  overrides: Partial<DiscoveryPromptInput> = {},
): DiscoveryPromptInput {
  return {
    industries: [],
    companySizes: [],
    companyStages: [],
    productTypes: [],
    exclusions: [],
    hqGeographies: [],
    existingCompanyNames: [],
    budget: 20,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("buildDiscoveryPrompt", () => {
  // ── Critical ──────────────────────────────────────────────────────────

  test("all preferences populated -- criteria, exclusions, and budget appear in user prompt", () => {
    const { system, user } = buildDiscoveryPrompt(
      makeInput({
        industries: ["fintech", "saas"],
        companySizes: ["50-200"],
        companyStages: ["series_b"],
        productTypes: ["b2b"],
        exclusions: ["Stripe"],
        hqGeographies: ["US"],
        existingCompanyNames: ["Acme Corp"],
        budget: 10,
      }),
    );

    // System prompt identity
    expect(system).toContain("company research assistant");

    // All criteria present in user prompt
    expect(user).toContain("fintech, saas");
    expect(user).toContain("50-200");
    expect(user).toContain("series_b");
    expect(user).toContain("b2b");
    expect(user).toContain("US");

    // Both user exclusions and existing company names in exclusion list
    expect(user).toContain("Stripe");
    expect(user).toContain("Acme Corp");

    // Budget
    expect(user).toContain("up to 10 companies");
  });

  test("all preferences empty -- each criteria shows 'None specified', exclusions show 'None'", () => {
    const { user } = buildDiscoveryPrompt(makeInput());

    expect(user).toContain("Industries: None specified");
    expect(user).toContain("Company Sizes: None specified");
    expect(user).toContain("Company Stages: None specified");
    expect(user).toContain("Product Types: None specified");
    expect(user).toContain("HQ Geographies: None specified");

    // Exclusions section: "None" when both arrays are empty
    expect(user).toMatch(
      /## Companies to Exclude.*\n\nNone\n/s,
    );
  });

  test("exclusions only from existingCompanyNames, no user exclusions", () => {
    const { user } = buildDiscoveryPrompt(
      makeInput({
        exclusions: [],
        existingCompanyNames: ["Google", "Meta"],
      }),
    );

    // OR logic: existingCompanyNames populates the list even if exclusions is empty
    expect(user).toContain("Google, Meta");
    expect(user).not.toContain("None\n\n## Budget");
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("budget of 1 (minimum useful value) appears in prompt", () => {
    const { user } = buildDiscoveryPrompt(makeInput({ budget: 1 }));
    expect(user).toContain("up to 1 companies");
  });

  test("large existing company names list (150+) -- all names appear, no truncation", () => {
    const names = Array.from({ length: 150 }, (_, i) => `Company ${i}`);
    const { user } = buildDiscoveryPrompt(
      makeInput({ existingCompanyNames: names }),
    );

    // All 150 names appear comma-separated
    for (const name of [names[0], names[74], names[149]]) {
      expect(user).toContain(name);
    }
    // Verify they're comma-separated
    expect(user).toContain("Company 0, Company 1");
  });

  test("system prompt is stable -- contains expected ATS domain references", () => {
    const { system } = buildDiscoveryPrompt(makeInput());

    expect(system).toMatch(/^You are a company research assistant/);
    expect(system).toContain("boards.greenhouse.io");
    expect(system).toContain("jobs.lever.co");
    expect(system).toContain("jobs.ashbyhq.com");
    expect(system).toContain("jobs.smartrecruiters.com");
  });

  test("special characters in preference values pass through verbatim", () => {
    const { user } = buildDiscoveryPrompt(
      makeInput({
        industries: ["AI & ML", "developer_tools"],
      }),
    );

    expect(user).toContain("AI & ML, developer_tools");
  });
});
