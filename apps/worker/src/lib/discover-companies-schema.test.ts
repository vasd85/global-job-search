import { ZodError } from "zod";
import {
  DiscoveredCompanySchema,
  DiscoveryOutputSchema,
} from "./discover-companies-schema";

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeValidCompany(overrides: Record<string, unknown> = {}) {
  return {
    name: "Acme",
    website: "https://acme.com",
    careersUrl: "https://boards.greenhouse.io/acme",
    industry: ["saas"],
    reasoning: "good match",
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("DiscoveredCompanySchema", () => {
  // ── Critical ──────────────────────────────────────────────────────────

  test("valid company object passes schema validation", () => {
    const result = DiscoveredCompanySchema.parse(makeValidCompany());

    expect(result).toEqual(
      expect.objectContaining({
        name: "Acme",
        website: "https://acme.com",
        careersUrl: "https://boards.greenhouse.io/acme",
        industry: ["saas"],
        reasoning: "good match",
      }),
    );
  });

  test("careersUrl is null (allowed by schema)", () => {
    const result = DiscoveredCompanySchema.parse(
      makeValidCompany({
        careersUrl: null,
        industry: [],
        reasoning: "no careers page found",
      }),
    );

    expect(result.careersUrl).toBeNull();
  });

  test("missing required field throws ZodError", () => {
    const valid = makeValidCompany();
    const withoutName = {
      website: valid.website,
      careersUrl: valid.careersUrl,
      industry: valid.industry,
      reasoning: valid.reasoning,
    };

    expect(() => DiscoveredCompanySchema.parse(withoutName)).toThrow(
      ZodError,
    );
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("empty industry array is valid", () => {
    const result = DiscoveredCompanySchema.parse(
      makeValidCompany({ industry: [] }),
    );

    expect(result.industry).toEqual([]);
  });

  test("extra fields are stripped (default Zod strip behavior)", () => {
    const result = DiscoveredCompanySchema.parse(
      makeValidCompany({ extraField: "surprise" }),
    );

    expect(result).not.toHaveProperty("extraField");
  });
});

describe("DiscoveryOutputSchema", () => {
  test("wraps companies array", () => {
    const result = DiscoveryOutputSchema.parse({
      companies: [makeValidCompany()],
    });

    expect(result.companies).toHaveLength(1);
    expect(result.companies[0].name).toBe("Acme");
  });

  test("empty companies array is valid", () => {
    const result = DiscoveryOutputSchema.parse({ companies: [] });
    expect(result.companies).toEqual([]);
  });
});
