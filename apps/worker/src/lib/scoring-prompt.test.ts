import { buildScoringPrompt, type ScoringPromptParams } from "./scoring-prompt";

// ── Helpers ───────────────────────────────────────────────────────────────

function fullParams(overrides: Partial<ScoringPromptParams> = {}): ScoringPromptParams {
  return {
    job: {
      title: "Senior Software Engineer",
      descriptionText: "Build amazing products with TypeScript.",
      locationRaw: "New York, NY",
      workplaceType: "hybrid",
      salaryRaw: "$150,000 - $180,000",
      url: "https://example.com/job/123",
      ...overrides.job,
    },
    company: {
      name: "Acme Corp",
      industry: ["Technology", "SaaS"],
      ...overrides.company,
    },
    profile: {
      targetTitles: ["Senior Engineer", "Staff Engineer"],
      targetSeniority: ["senior", "staff"],
      coreSkills: ["TypeScript", "React", "Node.js"],
      growthSkills: ["Rust", "Go"],
      avoidSkills: ["PHP"],
      dealBreakers: ["mandatory onsite 5 days"],
      preferredLocations: ["NYC", "SF"],
      remotePreference: "hybrid_ok",
      locationPreferences: null,
      minSalary: 140000,
      targetSalary: 180000,
      salaryCurrency: "USD",
      preferredIndustries: ["Technology", "Finance"],
      ...overrides.profile,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("buildScoringPrompt", () => {
  // ── Critical ──────────────────────────────────────────────────────────

  test("full profile produces prompt containing all sections", () => {
    const params = fullParams();
    const { system, user } = buildScoringPrompt(params);

    // System prompt is the constant SYSTEM_PROMPT
    expect(system).toContain("You are a job matching evaluator");
    expect(system).toContain("Role Fit (scoreR)");
    expect(system).toContain("Skills Fit (scoreS)");

    // User prompt contains job data
    expect(user).toContain("Senior Software Engineer");
    expect(user).toContain("Acme Corp");
    expect(user).toContain("Build amazing products with TypeScript.");
    expect(user).toContain("New York, NY");
    expect(user).toContain("hybrid");
    expect(user).toContain("$150,000 - $180,000");
    expect(user).toContain("https://example.com/job/123");
    expect(user).toContain("Technology, SaaS");

    // User prompt contains profile data
    expect(user).toContain("Senior Engineer, Staff Engineer");
    expect(user).toContain("senior, staff");
    expect(user).toContain("TypeScript, React, Node.js");
    expect(user).toContain("Rust, Go");
    expect(user).toContain("PHP");
    expect(user).toContain("mandatory onsite 5 days");
    expect(user).toContain("NYC, SF");
    expect(user).toContain("hybrid_ok");
    expect(user).toContain("140000-180000 USD");
    expect(user).toContain("Technology, Finance");
  });

  test("null description produces 'No description available'", () => {
    const params = fullParams({ job: { ...fullParams().job, descriptionText: null } });
    const { user } = buildScoringPrompt(params);

    expect(user).toContain("No description available");
  });

  test("description truncated at 4000 chars", () => {
    const longDescription = "x".repeat(5000);
    const params = fullParams({
      job: { ...fullParams().job, descriptionText: longDescription },
    });
    const { user } = buildScoringPrompt(params);

    expect(user).toContain("x".repeat(4000) + "... [truncated]");
    expect(user).not.toContain("x".repeat(4001));
  });

  test("description at exactly 4000 chars is NOT truncated", () => {
    const exactDescription = "y".repeat(4000);
    const params = fullParams({
      job: { ...fullParams().job, descriptionText: exactDescription },
    });
    const { user } = buildScoringPrompt(params);

    expect(user).toContain(exactDescription);
    expect(user).not.toContain("[truncated]");
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("all nullable profile fields are null", () => {
    const params = fullParams({
      profile: {
        targetTitles: null,
        targetSeniority: null,
        coreSkills: null,
        growthSkills: null,
        avoidSkills: null,
        dealBreakers: null,
        preferredLocations: null,
        remotePreference: null,
        locationPreferences: null,
        minSalary: null,
        targetSalary: null,
        salaryCurrency: null,
        preferredIndustries: null,
      },
    });
    const { user } = buildScoringPrompt(params);

    // Arrays render as "None specified"
    expect(user).toMatch(/Target Roles: None specified/);
    expect(user).toMatch(/Target Seniority: None specified/);
    expect(user).toMatch(/Core Skills: None specified/);
    expect(user).toMatch(/Growth Skills.*: None specified/);
    expect(user).toMatch(/Avoid Skills.*: None specified/);
    expect(user).toMatch(/Deal-Breakers: None specified/);
    expect(user).toMatch(/Location Preferences: None specified/);
    expect(user).toMatch(/Preferred Industries: None specified/);

    // Null remotePreference renders as "any"
    expect(user).toMatch(/Remote Preference: any/);

    // Null salary renders as "Not specified"
    expect(user).toMatch(/Salary Range: Not specified/);
  });

  test("empty arrays produce 'None specified'", () => {
    const params = fullParams({
      profile: {
        ...fullParams().profile,
        targetTitles: [],
        coreSkills: [],
        growthSkills: [],
      },
    });
    const { user } = buildScoringPrompt(params);

    expect(user).toMatch(/Target Roles: None specified/);
    expect(user).toMatch(/Core Skills: None specified/);
    expect(user).toMatch(/Growth Skills.*: None specified/);
  });

  test("salary with only minSalary", () => {
    const params = fullParams({
      profile: {
        ...fullParams().profile,
        minSalary: 100000,
        targetSalary: null,
        salaryCurrency: "EUR",
      },
    });
    const { user } = buildScoringPrompt(params);

    expect(user).toContain("At least 100000 EUR");
  });

  test("salary with only targetSalary and null currency defaults to USD", () => {
    const params = fullParams({
      profile: {
        ...fullParams().profile,
        minSalary: null,
        targetSalary: 150000,
        salaryCurrency: null,
      },
    });
    const { user } = buildScoringPrompt(params);

    expect(user).toContain("Up to 150000 USD");
  });

  test("salary with both min and target", () => {
    const params = fullParams({
      profile: {
        ...fullParams().profile,
        minSalary: 100000,
        targetSalary: 150000,
        salaryCurrency: "GBP",
      },
    });
    const { user } = buildScoringPrompt(params);

    expect(user).toContain("100000-150000 GBP");
  });

  test("locationPreferences is a JSON object, preferredLocations is null", () => {
    const params = fullParams({
      profile: {
        ...fullParams().profile,
        preferredLocations: null,
        locationPreferences: { tier1: ["NYC"], tier2: ["SF"] },
      },
    });
    const { user } = buildScoringPrompt(params);

    expect(user).toContain(JSON.stringify({ tier1: ["NYC"], tier2: ["SF"] }));
  });

  test("both preferredLocations and locationPreferences present -- preferredLocations takes priority", () => {
    const params = fullParams({
      profile: {
        ...fullParams().profile,
        preferredLocations: ["NYC", "SF"],
        locationPreferences: { tier1: ["NYC"] },
      },
    });
    const { user } = buildScoringPrompt(params);

    expect(user).toMatch(/Location Preferences: NYC, SF/);
    expect(user).not.toContain("tier1");
  });

  // ── Nice-to-have ──────────────────────────────────────────────────────

  test("description at 4001 chars is truncated", () => {
    const description = "z".repeat(4001);
    const params = fullParams({
      job: { ...fullParams().job, descriptionText: description },
    });
    const { user } = buildScoringPrompt(params);

    expect(user).toContain("... [truncated]");
  });

  // ── Corner Cases ──────────────────────────────────────────────────────

  test("locationPreferences is an array (not object) -- treated as JSON object", () => {
    const params = fullParams({
      profile: {
        ...fullParams().profile,
        preferredLocations: null,
        locationPreferences: ["NYC", "SF"],
      },
    });
    const { user } = buildScoringPrompt(params);

    // Arrays are objects in JS, so typeof check passes
    expect(user).toContain(JSON.stringify(["NYC", "SF"]));
  });
});
