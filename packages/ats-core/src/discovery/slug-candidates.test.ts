import { generateSlugCandidates } from "./slug-candidates";

// ---------------------------------------------------------------------------
// generateSlugCandidates
// ---------------------------------------------------------------------------

describe("generateSlugCandidates", () => {
  // -- Critical: Core transformation contract --------------------------------

  describe("multi-word company produces all transformation types", () => {
    const result = generateSlugCandidates("Acme Corp");

    it("includes lowercase-stripped (transform 1)", () => {
      expect(result).toContain("acmecorp");
    });

    it("includes hyphenated (transform 2)", () => {
      expect(result).toContain("acme-corp");
    });

    it("includes underscored (transform 4)", () => {
      expect(result).toContain("acme_corp");
    });

    it("includes brand word (transform 5)", () => {
      expect(result).toContain("acme");
    });

    it("includes CamelCase (transform 6)", () => {
      expect(result).toContain("AcmeCorp");
    });
  });

  describe("suffix stripping generates both stripped and unstripped variants", () => {
    const result = generateSlugCandidates("Acme Inc.");

    it("includes candidates from stripped name", () => {
      expect(result).toContain("acme");
    });

    it("includes candidates from original name", () => {
      expect(result).toContain("acmeinc");
    });

    it("places suffix-stripped candidates before original-name candidates", () => {
      const acmeIdx = result.indexOf("acme");
      const acmeIncIdx = result.indexOf("acmeinc");
      expect(acmeIdx).toBeLessThan(acmeIncIdx);
    });
  });

  it("handles domain-style company name with dot", () => {
    const result = generateSlugCandidates("Bill.com");
    // Transform 1 strips non-alphanumeric, so dot is removed
    expect(result).toContain("billcom");
    // Transform 2 replaces non-alphanumeric with hyphens
    expect(result).toContain("bill-com");
  });

  it("returns results for single-word name without duplicates or empty entries", () => {
    const result = generateSlugCandidates("Stripe");
    expect(result).toContain("stripe");
    expect(result).toContain("Stripe");
    // No empty strings
    expect(result.every((s) => s.length > 0)).toBe(true);
  });

  test.each([
    ["empty string", ""],
    ["spaces only", "   "],
    ["tab and newline", "\t\n"],
  ])("returns empty array for %s", (_label, input) => {
    expect(generateSlugCandidates(input)).toEqual([]);
  });

  it("deduplicates candidates (single-word name)", () => {
    const result = generateSlugCandidates("Stripe");
    // transforms 1 and 3 both produce "stripe" for single words
    const stripeCount = result.filter((c) => c === "stripe").length;
    expect(stripeCount).toBe(1);
  });

  it("excludes candidates shorter than 2 characters", () => {
    const result = generateSlugCandidates("A");
    // Single char "a" must NOT appear (MIN_SLUG_LENGTH = 2)
    expect(result).not.toContain("a");
    // All candidates should be at least 2 chars
    expect(result.every((c) => c.length >= 2)).toBe(true);
  });

  // -- Important: Suffix and brand-word edge cases ----------------------------

  it("skips articles when extracting brand word", () => {
    const result = generateSlugCandidates("The Acme Company");
    // Brand word should be "acme", not "the"
    expect(result).toContain("acme");
  });

  it("returns null brand word when all words are skip-words", () => {
    const result = generateSlugCandidates("The A");
    // Both words are in SKIP_WORDS, so no brand-word candidate
    // But other transforms should still produce output
    expect(result).toContain("thea");
    expect(result).toContain("the-a");
    expect(result.length).toBeGreaterThan(0);
  });

  test.each([
    ["Acme Inc", "acme"],
    ["Acme Inc.", "acme"],
    ["Acme LLC", "acme"],
    ["Acme Ltd", "acme"],
    ["Acme Ltd.", "acme"],
    ["Acme Corp", "acme"],
    ["Acme Corp.", "acme"],
    ["Acme Co", "acme"],
    ["Acme Co.", "acme"],
    ["Acme GmbH", "acme"],
    ["Acme AG", "acme"],
    ["Acme S.A.", "acme"],
    ["Acme PLC", "acme"],
  ])("strips suffix from %s and produces %s", (input, expected) => {
    const result = generateSlugCandidates(input);
    expect(result).toContain(expected);
  });

  test.each([
    ["Acme INC"],
    ["Acme inc"],
    ["Acme LLC"],
  ])("suffix stripping is case-insensitive: %s", (input) => {
    const result = generateSlugCandidates(input);
    expect(result).toContain("acme");
  });

  it("produces correct CamelCase for multi-word name", () => {
    const result = generateSlugCandidates("palo alto networks");
    expect(result).toContain("PaloAltoNetworks");
  });

  it("handles special characters in company name", () => {
    const result = generateSlugCandidates("C3.ai");
    expect(result).toContain("c3ai");
    expect(result).toContain("c3-ai");
  });

  it("collapses consecutive whitespace in hyphens and underscores", () => {
    const result = generateSlugCandidates("Acme  Corp");
    expect(result).toContain("acme-corp");
    expect(result).toContain("acme_corp");
    // No double hyphens or underscores
    expect(result).not.toContain("acme--corp");
    expect(result).not.toContain("acme__corp");
  });

  it("passes two-character slug through minimum length filter", () => {
    const result = generateSlugCandidates("AI Corp");
    // "ai" is 2 chars, >= MIN_SLUG_LENGTH=2, so it must be included
    expect(result).toContain("ai");
  });

  it("does not strip suffix from single-word name that matches a suffix", () => {
    const result = generateSlugCandidates("Inc");
    // The words.length <= 1 guard prevents stripping
    expect(result).toContain("inc");
    expect(result).toContain("Inc");
  });

  // -- Nice-to-have ----------------------------------------------------------

  it("strips GmbH suffix and generates candidates for remaining name", () => {
    const result = generateSlugCandidates("Konig GmbH");
    expect(result).toContain("konig");
  });

  it("handles very long company name without explosion", () => {
    const result = generateSlugCandidates(
      "The International Business Machines Corporation of North America Inc."
    );
    // Should produce a reasonable number of candidates
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(50);
    // All transforms applied
    expect(result.some((c) => c.includes("-"))).toBe(true); // hyphenated
    expect(result.some((c) => c.includes("_"))).toBe(true); // underscored
  });

  it("preserves numbers in candidates", () => {
    const result = generateSlugCandidates("3M");
    expect(result).toContain("3m");
  });

  it("trims leading and trailing whitespace before processing", () => {
    const padded = generateSlugCandidates("  Acme Corp  ");
    const normal = generateSlugCandidates("Acme Corp");
    expect(padded).toEqual(normal);
  });
});
