import {
  normalizeTitle,
  classifyJob,
  classifyJobMulti,
  extractSeniority,
  SENIORITY_PREFIXES,
} from "./role-family-classifier";
import type {
  RoleFamilyDef,
  ClassificationInput,
  SeniorityLevel,
} from "./role-family-classifier";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a minimal valid RoleFamilyDef with sensible defaults. */
function makeFamily(overrides: Partial<RoleFamilyDef> = {}): RoleFamilyDef {
  return {
    slug: "test_family",
    strongMatch: ["test engineer"],
    moderateMatch: ["quality analyst"],
    departmentBoost: [],
    departmentExclude: [],
    ...overrides,
  };
}

/** Returns a minimal valid ClassificationInput with sensible defaults. */
function makeInput(
  overrides: Partial<ClassificationInput> = {},
): ClassificationInput {
  return {
    title: "Software Engineer",
    departmentRaw: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeTitle()
// ---------------------------------------------------------------------------

describe("normalizeTitle", () => {
  // -- Critical scenarios ---------------------------------------------------

  test("lowercases and trims whitespace", () => {
    expect(normalizeTitle("  Software Engineer  ")).toBe("software engineer");
  });

  test("strips a single seniority prefix", () => {
    expect(normalizeTitle("Senior Software Engineer")).toBe(
      "software engineer",
    );
  });

  test("strips stacked seniority prefixes iteratively", () => {
    expect(normalizeTitle("Senior Staff Software Engineer")).toBe(
      "software engineer",
    );
  });

  test("collapses internal whitespace after prefix stripping", () => {
    expect(normalizeTitle("Senior   Staff    Software   Engineer")).toBe(
      "software engineer",
    );
  });

  test("passes through title with no seniority prefix unchanged (except lowercase)", () => {
    expect(normalizeTitle("QA Engineer")).toBe("qa engineer");
  });

  test.each<[string, string]>([
    ["vice president of engineer", "engineer"],
    ["director of engineer", "engineer"],
    ["mid-level engineer", "engineer"],
    ["mid level engineer", "engineer"],
    ["principal engineer", "engineer"],
    ["associate engineer", "engineer"],
    ["head of engineer", "engineer"],
    ["vp of engineer", "engineer"],
    ["senior engineer", "engineer"],
    ["staff engineer", "engineer"],
    ["chief engineer", "engineer"],
    ["lead engineer", "engineer"],
    ["jr. engineer", "engineer"],
    ["sr. engineer", "engineer"],
    ["jr engineer", "engineer"],
    ["sr engineer", "engineer"],
    ["intern engineer", "engineer"],
    ["junior engineer", "engineer"],
  ])('strips prefix from "%s" -> "%s"', (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });

  // -- Important scenarios --------------------------------------------------

  test("does not strip a prefix appearing in the middle of the title", () => {
    expect(normalizeTitle("Associate Software Lead Engineer")).toBe(
      "software lead engineer",
    );
  });

  test("matches longer prefix before shorter one (vice president of vs vp of)", () => {
    expect(normalizeTitle("Vice President of Engineering")).toBe(
      "engineering",
    );
  });

  test("handles mixed-case input for prefix matching", () => {
    expect(normalizeTitle("SENIOR Software Engineer")).toBe(
      "software engineer",
    );
  });

  test("returns empty string for empty input", () => {
    expect(normalizeTitle("")).toBe("");
  });

  test("returns empty string for whitespace-only input", () => {
    expect(normalizeTitle("   ")).toBe("");
  });

  test("returns empty string when title is entirely a seniority prefix", () => {
    expect(normalizeTitle("Senior")).toBe("");
  });

  test("does not strip 'intern' from 'Internal Tools Engineer'", () => {
    // "intern " (with trailing space) prevents false stripping of "Internal", "Internship", etc.
    expect(normalizeTitle("Internal Tools Engineer")).toBe(
      "internal tools engineer",
    );
  });

  test("strips Lead from Lead Generation Specialist (known limitation)", () => {
    // TODO: Known false strip -- "Lead" is a seniority prefix but "Lead Generation Specialist"
    // is a non-seniority role. Mitigated by department_exclude in the broader system.
    expect(normalizeTitle("Lead Generation Specialist")).toBe(
      "generation specialist",
    );
  });

  test("collapses tab and newline characters", () => {
    expect(normalizeTitle("Senior\tSoftware\nEngineer")).toBe(
      "software engineer",
    );
  });

  // -- Nice-to-have scenarios -----------------------------------------------

  test("preserves unicode characters through normalization", () => {
    expect(normalizeTitle("Senior Ingenieur fur Qualitatssicherung")).toBe(
      "ingenieur fur qualitatssicherung",
    );
  });

  test("handles prefix followed by only punctuation", () => {
    expect(normalizeTitle("Sr. - ")).toBe("-");
  });

  test("handles very long titles without performance issues", () => {
    const longSuffix = "a".repeat(1000);
    const result = normalizeTitle(`Senior ${longSuffix}`);
    expect(result).toBe(longSuffix);
  });
});

// ---------------------------------------------------------------------------
// classifyJob()
// ---------------------------------------------------------------------------

describe("classifyJob", () => {
  // -- Critical scenarios ---------------------------------------------------

  test("strong match returns score 1.0 with matchType strong", () => {
    const family = makeFamily({ strongMatch: ["qa engineer"] });
    const input = makeInput({ title: "QA Engineer" });

    const result = classifyJob(family, input);

    expect(result).toEqual({
      familySlug: "test_family",
      score: 1.0,
      matchType: "strong",
      matchedPattern: "qa engineer",
    });
  });

  test("moderate match returns score 0.7 with matchType moderate", () => {
    const family = makeFamily({
      strongMatch: ["qa engineer"],
      moderateMatch: ["quality engineer"],
    });
    const input = makeInput({ title: "Quality Engineer" });

    const result = classifyJob(family, input);

    expect(result).toEqual({
      familySlug: "test_family",
      score: 0.7,
      matchType: "moderate",
      matchedPattern: "quality engineer",
    });
  });

  test("strong match takes precedence over moderate match when both match", () => {
    const family = makeFamily({
      strongMatch: ["software engineer"],
      moderateMatch: ["software engineer"],
    });
    const input = makeInput({ title: "Software Engineer" });

    const result = classifyJob(family, input);

    expect(result.score).toBe(1.0);
    expect(result.matchType).toBe("strong");
  });

  test("no match returns score 0 with matchType none", () => {
    const family = makeFamily({
      strongMatch: ["qa engineer"],
      moderateMatch: ["quality engineer"],
    });
    const input = makeInput({ title: "Office Manager" });

    const result = classifyJob(family, input);

    expect(result).toEqual({
      familySlug: "test_family",
      score: 0,
      matchType: "none",
      matchedPattern: null,
    });
  });

  test("department exclude overrides a strong title match to score 0", () => {
    const family = makeFamily({
      strongMatch: ["qa engineer"],
      departmentExclude: ["sales"],
    });
    const input = makeInput({ title: "QA Engineer", departmentRaw: "Sales" });

    const result = classifyJob(family, input);

    expect(result).toEqual({
      familySlug: "test_family",
      score: 0,
      matchType: "none",
      matchedPattern: null,
    });
  });

  test("department boost adds 0.2 to a moderate match (0.7 -> 0.9)", () => {
    const family = makeFamily({
      strongMatch: [],
      moderateMatch: ["quality engineer"],
      departmentBoost: ["qa"],
    });
    const input = makeInput({
      title: "Quality Engineer",
      departmentRaw: "QA Team",
    });

    const result = classifyJob(family, input);

    // 0.7 + 0.2 = 0.8999999999999999 in IEEE 754
    expect(result.score).toBeCloseTo(0.9, 10);
    expect(result.matchType).toBe("moderate");
  });

  test("department boost on a strong match is capped at 1.0", () => {
    const family = makeFamily({
      strongMatch: ["qa engineer"],
      departmentBoost: ["qa"],
    });
    const input = makeInput({ title: "QA Engineer", departmentRaw: "QA" });

    const result = classifyJob(family, input);

    expect(result.score).toBe(1.0);
  });

  test("department boost does not apply when base score is 0", () => {
    const family = makeFamily({
      strongMatch: [],
      moderateMatch: [],
      departmentBoost: ["qa"],
    });
    const input = makeInput({
      title: "Office Manager",
      departmentRaw: "QA Team",
    });

    const result = classifyJob(family, input);

    expect(result.score).toBe(0);
    expect(result.matchType).toBe("none");
  });

  test("null departmentRaw skips both exclude and boost checks", () => {
    const family = makeFamily({
      strongMatch: ["qa engineer"],
      departmentExclude: ["sales"],
      departmentBoost: ["qa"],
    });
    const input = makeInput({ title: "QA Engineer", departmentRaw: null });

    const result = classifyJob(family, input);

    // Strong match at 1.0, no exclude triggered, no boost applied
    expect(result.score).toBe(1.0);
  });

  // -- Important scenarios --------------------------------------------------

  test("title matching uses normalized title (seniority stripped)", () => {
    const family = makeFamily({ strongMatch: ["qa engineer"] });
    const input = makeInput({ title: "Senior QA Engineer" });

    const result = classifyJob(family, input);

    expect(result.score).toBe(1.0);
    expect(result.matchType).toBe("strong");
    expect(result.matchedPattern).toBe("qa engineer");
  });

  test("pattern matching is case-insensitive", () => {
    const family = makeFamily({ strongMatch: ["qa engineer"] });
    const input = makeInput({ title: "QA ENGINEER" });

    const result = classifyJob(family, input);

    expect(result.score).toBe(1.0);
  });

  test("department exclude matching is case-insensitive", () => {
    const family = makeFamily({
      strongMatch: ["qa engineer"],
      departmentExclude: ["sales"],
    });
    const input = makeInput({
      title: "QA Engineer",
      departmentRaw: "SALES",
    });

    const result = classifyJob(family, input);

    expect(result.score).toBe(0);
  });

  test("department boost matching is case-insensitive", () => {
    const family = makeFamily({
      strongMatch: [],
      moderateMatch: ["quality engineer"],
      departmentBoost: ["qa"],
    });
    const input = makeInput({
      title: "Quality Engineer",
      departmentRaw: "QA DEPARTMENT",
    });

    const result = classifyJob(family, input);

    expect(result.score).toBeCloseTo(0.9, 10);
  });

  test("first strong match pattern wins (early exit)", () => {
    const family = makeFamily({
      strongMatch: ["qa engineer", "test engineer"],
    });
    const input = makeInput({ title: "QA Engineer and Test Engineer" });

    const result = classifyJob(family, input);

    expect(result.matchedPattern).toBe("qa engineer");
  });

  test("first moderate match pattern wins (early exit)", () => {
    const family = makeFamily({
      strongMatch: [],
      moderateMatch: ["quality", "release engineer"],
    });
    // Normalized title "quality and release engineer" contains both "quality" and "release engineer"
    const input = makeInput({ title: "Quality and Release Engineer" });

    const result = classifyJob(family, input);

    expect(result.matchedPattern).toBe("quality");
  });

  test("empty pattern arrays produce no match", () => {
    const family = makeFamily({
      strongMatch: [],
      moderateMatch: [],
      departmentBoost: [],
      departmentExclude: [],
    });
    const input = makeInput({ title: "QA Engineer" });

    const result = classifyJob(family, input);

    expect(result.score).toBe(0);
    expect(result.matchType).toBe("none");
  });

  test("familySlug is passed through to the result", () => {
    const family = makeFamily({
      slug: "qa_testing",
      strongMatch: ["qa engineer"],
    });
    const input = makeInput({ title: "QA Engineer" });

    const result = classifyJob(family, input);

    expect(result.familySlug).toBe("qa_testing");
  });

  test("substring matching means partial title matches count", () => {
    const family = makeFamily({ strongMatch: ["qa engineer"] });
    const input = makeInput({ title: "Senior QA Engineer II" });

    const result = classifyJob(family, input);

    // Normalized: "qa engineer ii" includes "qa engineer"
    expect(result.score).toBe(1.0);
  });

  // -- Nice-to-have scenarios -----------------------------------------------

  test("department boost applies at most once even with multiple matching patterns", () => {
    // Use moderate match so the boost effect is visible (0.7 + 0.2 = 0.9, not 1.1)
    const family = makeFamily({
      strongMatch: [],
      moderateMatch: ["quality engineer"],
      departmentBoost: ["qa", "testing"],
    });
    const input = makeInput({
      title: "Quality Engineer",
      departmentRaw: "QA Testing",
    });

    const result = classifyJob(family, input);

    // Only one +0.2 applied due to break after first boost match
    expect(result.score).toBeCloseTo(0.9, 10);
  });

  test('matchType "department_only" is never produced by the current algorithm', () => {
    // TODO: The ClassificationResult type includes "department_only" for future use,
    // but the current algorithm cannot produce it because department boost only applies
    // when baseScore > 0 (which already sets matchType to "strong" or "moderate").
    // When baseScore is 0, the boost is skipped entirely.
    const family = makeFamily({
      strongMatch: [],
      moderateMatch: [],
      departmentBoost: ["qa"],
    });
    const input = makeInput({
      title: "Office Manager",
      departmentRaw: "QA Team",
    });

    const result = classifyJob(family, input);

    expect(result.matchType).not.toBe("department_only");
    expect(result.matchType).toBe("none");
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// classifyJobMulti()
// ---------------------------------------------------------------------------

describe("classifyJobMulti", () => {
  // -- Critical scenarios ---------------------------------------------------

  test("returns the highest-scoring result across families", () => {
    const familyA = makeFamily({
      slug: "moderate_family",
      strongMatch: [],
      moderateMatch: ["software engineer"],
    });
    const familyB = makeFamily({
      slug: "strong_family",
      strongMatch: ["software engineer"],
    });
    const input = makeInput({ title: "Software Engineer" });

    const result = classifyJobMulti([familyA, familyB], input);

    expect(result.familySlug).toBe("strong_family");
    expect(result.score).toBe(1.0);
    expect(result.matchType).toBe("strong");
  });

  test("empty families array returns zero-score empty result", () => {
    const input = makeInput({ title: "Software Engineer" });

    const result = classifyJobMulti([], input);

    expect(result).toEqual({
      familySlug: "",
      score: 0,
      matchType: "none",
      matchedPattern: null,
    });
  });

  test("single family returns that family's result", () => {
    const family = makeFamily({
      slug: "qa_testing",
      strongMatch: ["qa engineer"],
    });
    const input = makeInput({ title: "QA Engineer" });

    const result = classifyJobMulti([family], input);

    expect(result.familySlug).toBe("qa_testing");
    expect(result.score).toBe(1.0);
    expect(result.matchType).toBe("strong");
  });

  // -- Important scenarios --------------------------------------------------

  test("first family wins on tie (equal scores) due to strict > comparison", () => {
    const familyA = makeFamily({
      slug: "first_family",
      strongMatch: ["software engineer"],
    });
    const familyB = makeFamily({
      slug: "second_family",
      strongMatch: ["software engineer"],
    });
    const input = makeInput({ title: "Software Engineer" });

    const result = classifyJobMulti([familyA, familyB], input);

    expect(result.familySlug).toBe("first_family");
  });

  test("family excluded by department does not win even if another family has lower score", () => {
    const familyA = makeFamily({
      slug: "excluded_family",
      strongMatch: ["qa engineer"],
      departmentExclude: ["sales"],
    });
    const familyB = makeFamily({
      slug: "moderate_family",
      strongMatch: [],
      moderateMatch: ["qa engineer"],
    });
    const input = makeInput({ title: "QA Engineer", departmentRaw: "Sales" });

    const result = classifyJobMulti([familyA, familyB], input);

    expect(result.familySlug).toBe("moderate_family");
    expect(result.score).toBe(0.7);
  });

  test("three families (max user selection) returns the highest scorer", () => {
    const familyA = makeFamily({
      slug: "no_match",
      strongMatch: ["backend developer"],
      moderateMatch: [],
    });
    const familyB = makeFamily({
      slug: "moderate_match",
      strongMatch: [],
      moderateMatch: ["software engineer"],
    });
    const familyC = makeFamily({
      slug: "strong_match",
      strongMatch: ["software engineer"],
    });
    const input = makeInput({ title: "Software Engineer" });

    const result = classifyJobMulti([familyA, familyB, familyC], input);

    expect(result.familySlug).toBe("strong_match");
    expect(result.score).toBe(1.0);
  });

  test("result from empty families is a fresh object, not a shared reference", () => {
    const input = makeInput();

    const result1 = classifyJobMulti([], input);
    const result2 = classifyJobMulti([], input);

    expect(result1).toEqual(result2);
    expect(result1).not.toBe(result2);
  });

  test("all families scoring 0 returns the empty result shape", () => {
    const familyA = makeFamily({
      slug: "family_a",
      strongMatch: ["backend developer"],
      moderateMatch: [],
    });
    const familyB = makeFamily({
      slug: "family_b",
      strongMatch: ["frontend developer"],
      moderateMatch: [],
    });
    const input = makeInput({ title: "Office Manager" });

    const result = classifyJobMulti([familyA, familyB], input);

    // When no family matches, best stays as EMPTY_RESULT spread (0 > 0 is false)
    expect(result).toEqual({
      familySlug: "",
      score: 0,
      matchType: "none",
      matchedPattern: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Negative / Adversarial Scenarios
// ---------------------------------------------------------------------------

describe("adversarial inputs", () => {
  describe("title edge cases", () => {
    test("title containing only seniority prefixes normalizes to empty string", () => {
      expect(normalizeTitle("Senior Staff Lead")).toBe("");
    });

    test("leading special characters prevent prefix stripping", () => {
      // The dash precedes "senior", so startsWith("senior") fails
      const result = normalizeTitle("  - Senior QA Engineer -  ");
      expect(result).toBe("- senior qa engineer -");
    });

    test("HTML entities in title do not break classification", () => {
      const family = makeFamily({ strongMatch: ["qa"] });
      const input = makeInput({ title: "QA &amp; Test Engineer" });

      const result = classifyJob(family, input);

      // "qa &amp; test engineer" includes "qa"
      expect(result.score).toBe(1.0);
    });
  });

  describe("department edge cases", () => {
    test("substring false positive in department exclude (hr in Chrome)", () => {
      // TODO: This is a real false positive from substring includes() matching.
      // "hr" in departmentExclude falsely excludes departments containing "chr", "thr", etc.
      // The seed data uses "hr" and "human resources" -- the short "hr" pattern is risky.
      // Consider using word-boundary matching or longer patterns to avoid this.
      const family = makeFamily({
        strongMatch: ["software engineer"],
        departmentExclude: ["hr"],
      });
      const input = makeInput({
        title: "Software Engineer",
        departmentRaw: "Chrome Engineering",
      });

      const result = classifyJob(family, input);

      // "chrome engineering" includes "hr" (in "chrome") -> falsely excluded
      expect(result.score).toBe(0);
    });

    test("substring false positive in department boost (data in metadata)", () => {
      // TODO: This documents a substring false positive in department boost.
      // "metadata operations" includes "data" -> falsely boosted.
      // Lower risk than exclude since it only adds 0.2, but should be addressed.
      // Note: The original scenario cited "qa" in "squad" but that is not actually
      // a contiguous substring. This test uses "data" in "metadata" instead.
      const family = makeFamily({
        strongMatch: [],
        moderateMatch: ["software engineer"],
        departmentBoost: ["data"],
      });
      const input = makeInput({
        title: "Software Engineer",
        departmentRaw: "Metadata Operations",
      });

      const result = classifyJob(family, input);

      // "metadata operations" includes "data" -> boost applied
      expect(result.score).toBeCloseTo(0.9, 10);
    });

    test("empty string departmentRaw bypasses department checks (falsy)", () => {
      const family = makeFamily({
        strongMatch: ["qa engineer"],
        departmentExclude: ["sales"],
        departmentBoost: ["qa"],
      });
      const input = makeInput({ title: "QA Engineer", departmentRaw: "" });

      const result = classifyJob(family, input);

      // Empty string is falsy after toLowerCase(), so department checks are skipped
      expect(result.score).toBe(1.0);
    });
  });

  describe("pattern edge cases", () => {
    test("empty string pattern matches every title", () => {
      // TODO: This is a critical correctness issue. If any pattern array contains
      // an empty string, every title will match because "anything".includes("") is
      // always true in JavaScript. The classifier does not validate patterns.
      // This should be guarded against with input validation in seed data or at insert time.
      const family = makeFamily({ strongMatch: [""] });
      const input = makeInput({ title: "Anything At All" });

      const result = classifyJob(family, input);

      expect(result.score).toBe(1.0);
    });

    test("pattern with leading/trailing whitespace fails to match", () => {
      // TODO: Patterns must be trimmed. If patterns come from a database or user
      // input in the future, untrimmed patterns would silently fail to match.
      // Consider trimming patterns in classifyJob or validating at insert time.
      const family = makeFamily({ strongMatch: [" qa engineer "] });
      const input = makeInput({ title: "QA Engineer" });

      const result = classifyJob(family, input);

      // "qa engineer".includes(" qa engineer ") is false -- leading space prevents match
      expect(result.score).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Corner Cases
// ---------------------------------------------------------------------------

describe("corner cases", () => {
  test("moderate + boost floating-point arithmetic is close to 0.9", () => {
    // 0.7 + 0.2 = 0.8999999999999999 in IEEE 754.
    // Use toBeCloseTo to handle this correctly.
    const family = makeFamily({
      strongMatch: [],
      moderateMatch: ["quality engineer"],
      departmentBoost: ["qa"],
    });
    const input = makeInput({
      title: "Quality Engineer",
      departmentRaw: "QA",
    });

    const result = classifyJob(family, input);

    expect(result.score).toBeCloseTo(0.9, 10);
    // The score should be above the >= 0.5 threshold used downstream
    expect(result.score).toBeGreaterThanOrEqual(0.5);
  });

  test("classifyJob returns raw scores (threshold is a downstream concern)", () => {
    const family = makeFamily({
      strongMatch: [],
      moderateMatch: ["quality engineer"],
    });
    const input = makeInput({ title: "Quality Engineer" });

    const result = classifyJob(family, input);

    // classifyJob returns the numeric score, not a boolean pass/fail
    expect(result.score).toBe(0.7);
    expect(typeof result.score).toBe("number");
  });

  test("two families with the same slug but different patterns are handled independently", () => {
    const familyA = makeFamily({
      slug: "qa_testing",
      strongMatch: ["backend developer"],
      moderateMatch: [],
    });
    const familyB = makeFamily({
      slug: "qa_testing",
      strongMatch: ["software engineer"],
      moderateMatch: [],
    });
    const input = makeInput({ title: "Software Engineer" });

    const result = classifyJobMulti([familyA, familyB], input);

    // Second family matches, so its result is returned
    expect(result.familySlug).toBe("qa_testing");
    expect(result.score).toBe(1.0);
  });

  test("first matching strong pattern in array is returned, not the longest", () => {
    const family = makeFamily({
      strongMatch: ["test", "test engineer"],
    });
    const input = makeInput({ title: "Test Engineer" });

    const result = classifyJob(family, input);

    // "test" is the first pattern that matches "test engineer"
    expect(result.matchedPattern).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// extractSeniority()
// ---------------------------------------------------------------------------

describe("extractSeniority", () => {
  // -- Critical scenarios ---------------------------------------------------

  test.each<[string, SeniorityLevel]>([
    ["Vice President of Engineering", "vp"],
    ["Director of Engineering", "director"],
    ["Mid-Level Engineer", "mid"],
    ["Mid Level Engineer", "mid"],
    ["Principal Engineer", "senior"],
    ["Associate Engineer", "junior"],
    ["Head of Engineering", "director"],
    ["VP of Engineering", "vp"],
    ["Senior Engineer", "senior"],
    ["Staff Engineer", "senior"],
    ["Chief Technology Officer", "vp"],
    ["Lead Engineer", "lead"],
    ["Jr. Engineer", "junior"],
    ["Sr. Engineer", "senior"],
    ["Jr Developer", "junior"],
    ["Sr Developer", "senior"],
    ["Intern Software Engineer", "junior"],
    ["Junior Developer", "junior"],
    ["Manager of QA", "manager"],
  ])(
    'maps "%s" to "%s"',
    (title, expected) => {
      expect(extractSeniority(title)).toBe(expected);
    },
  );

  test.each<[string]>([
    ["Software Engineer"],
    ["QA Engineer"],
    ["Data Analyst"],
  ])(
    'returns null for title with no seniority marker: "%s"',
    (title) => {
      expect(extractSeniority(title)).toBeNull();
    },
  );

  test.each<[string]>([
    ["SENIOR ENGINEER"],
    ["senior engineer"],
    ["Senior Engineer"],
    ["sEnIoR eNgInEeR"],
  ])(
    'is case-insensitive: "%s" returns "senior"',
    (title) => {
      expect(extractSeniority(title)).toBe("senior");
    },
  );

  test.each<[string]>([
    ["Engineering Manager"],
    ["Product Manager"],
    ["Test Manager"],
  ])(
    'detects suffix "manager" via includes() fallback: "%s"',
    (title) => {
      expect(extractSeniority(title)).toBe("manager");
    },
  );

  test("trims leading/trailing whitespace before prefix matching", () => {
    expect(extractSeniority("  Senior Engineer  ")).toBe("senior");
  });

  test("trims whitespace before fallback manager matching", () => {
    expect(extractSeniority("  Engineering Manager  ")).toBe("manager");
  });

  // -- Important scenarios --------------------------------------------------

  test("longest prefix wins due to SENIORITY_MAP ordering (vice president of vs vp of)", () => {
    // "vice president of" is before "vp of" in the map and matches first
    expect(extractSeniority("Vice President of Engineering")).toBe("vp");
  });

  test("first matching prefix wins for stacked prefixes", () => {
    // "senior" appears before "staff" in SENIORITY_MAP
    expect(extractSeniority("Senior Staff Engineer")).toBe("senior");
  });

  test('"manager" in the prefix position uses the prefix path, not the fallback', () => {
    // "manager" is the last entry in SENIORITY_MAP. startsWith("manager") matches.
    // Both paths produce "manager", but the prefix path is exercised first.
    expect(extractSeniority("Manager of Engineering")).toBe("manager");
  });

  test("empty string returns null", () => {
    expect(extractSeniority("")).toBeNull();
  });

  test.each<[string]>([
    ["   "],
    ["\t"],
    ["\n"],
  ])(
    'whitespace-only input "%s" returns null',
    (title) => {
      expect(extractSeniority(title)).toBeNull();
    },
  );

  test.each<[string, SeniorityLevel]>([
    ["Senior", "senior"],
    ["Lead", "lead"],
    ["Junior", "junior"],
    ["Manager", "manager"],
  ])(
    'title that is exactly a seniority prefix "%s" returns "%s"',
    (title, expected) => {
      expect(extractSeniority(title)).toBe(expected);
    },
  );

  test("seniority marker mid-title is not detected by startsWith", () => {
    // "Experienced Senior-level Engineer" does not start with "senior"
    expect(extractSeniority("Experienced Senior-level Engineer")).toBeNull();
  });

  // -- Nice-to-have scenarios -----------------------------------------------

  test("unicode characters in title do not cause errors", () => {
    expect(extractSeniority("Senior Ingenieur fur Qualitatssicherung")).toBe(
      "senior",
    );
  });

  test("very long title does not cause issues", () => {
    expect(extractSeniority("Senior " + "a".repeat(10000))).toBe("senior");
  });
});

// ---------------------------------------------------------------------------
// extractSeniority -- Negative / False-Positive Scenarios
// ---------------------------------------------------------------------------

describe("extractSeniority -- false positives and adversarial inputs", () => {
  // -- Critical scenarios ---------------------------------------------------

  test.each<[string]>([
    ["Account Manager"],
    ["Office Manager"],
    ["Project Manager"],
    ["Customer Success Manager"],
    ["Risk Manager"],
  ])(
    // TODO: The includes("manager") fallback matches ANY title containing "manager"
    // regardless of whether it is an engineering/technical management role. These
    // are expected results given the current implementation, but this is intentionally
    // broad and may cause false matches for users targeting "manager" seniority.
    // Level 3 LLM scoring handles precision downstream.
    '"manager" substring false positive: "%s" returns "manager"',
    (title) => {
      expect(extractSeniority(title)).toBe("manager");
    },
  );

  test.each<[string]>([
    ["Submanager of Operations"],
    ["Filemanager Developer"],
  ])(
    // TODO: The includes("manager") check has no word-boundary protection.
    // "submanager" and "filemanager" contain the substring "manager" and are
    // falsely matched. While these specific titles are unlikely in real data,
    // this documents the false-positive surface area. Consider word-boundary
    // matching in a future iteration.
    '"manager" substring false positive in compound words: "%s" returns "manager"',
    (title) => {
      expect(extractSeniority(title)).toBe("manager");
    },
  );

  test('"intern " prefix requires trailing space -- does not match "Internal"', () => {
    // SENIORITY_MAP has "intern " (with trailing space), so
    // "internal tools engineer".startsWith("intern ") is false
    expect(extractSeniority("Internal Tools Engineer")).toBeNull();
  });

  test('"jr " pattern requires trailing space -- does not match "Jruby"', () => {
    expect(extractSeniority("Jruby Developer")).toBeNull();
  });

  test('"sr " pattern requires trailing space -- does not match "Sre"', () => {
    // SRE (Site Reliability Engineer) is a common title
    expect(extractSeniority("Sre Engineer")).toBeNull();
  });

  test.each<[string]>([
    ["Associate Sales Representative"],
    ["Associate Marketing Coordinator"],
  ])(
    // "associate" maps to "junior" -- the function cannot distinguish technical
    // from non-technical associate roles. Department filtering happens downstream.
    '"associate" prefix matches non-technical roles: "%s" returns "junior"',
    (title) => {
      expect(extractSeniority(title)).toBe("junior");
    },
  );

  // -- Important scenarios --------------------------------------------------

  test('"lead" prefix false positive on "Lead Generation Specialist"', () => {
    // TODO: Known limitation matching normalizeTitle behavior. "Lead Generation
    // Specialist" is not a leadership role but is classified as "lead" seniority.
    // Mitigated by department_exclude in the broader system.
    expect(extractSeniority("Lead Generation Specialist")).toBe("lead");
  });

  test('"staff" maps to "senior", not a distinct level', () => {
    // Deliberate mapping: "principal" and "staff" map to "senior" as the
    // closest SeniorityLevel value.
    expect(extractSeniority("Staff Engineer")).toBe("senior");
  });

  test('"principal" also maps to "senior"', () => {
    expect(extractSeniority("Principal Software Engineer")).toBe("senior");
  });

  test('"head of" maps to "director"', () => {
    expect(extractSeniority("Head of Engineering")).toBe("director");
  });

  test.each<[string]>([
    ["Chief Technology Officer"],
    ["Chief Architect"],
  ])(
    '"chief" maps to "vp": "%s"',
    (title) => {
      expect(extractSeniority(title)).toBe("vp");
    },
  );
});

// ---------------------------------------------------------------------------
// SENIORITY_MAP vs SENIORITY_PREFIXES consistency
// ---------------------------------------------------------------------------

describe("SENIORITY_MAP vs SENIORITY_PREFIXES consistency", () => {
  // We cannot directly import SENIORITY_MAP since it is not exported.
  // However, we can verify the contract through extractSeniority behavior:
  // every SENIORITY_PREFIXES entry should be recognized by extractSeniority.

  test("every SENIORITY_PREFIXES entry is recognized by extractSeniority", () => {
    for (const prefix of SENIORITY_PREFIXES) {
      // Construct a title that starts with the prefix
      const title = `${prefix}Software Engineer`;
      const result = extractSeniority(title);
      expect(result).not.toBeNull();
    }
  });

  test('"manager" is detected by extractSeniority but is NOT in SENIORITY_PREFIXES', () => {
    // This documents the intentional divergence: "manager" is in SENIORITY_MAP
    // (used by extractSeniority) but NOT in SENIORITY_PREFIXES (used by normalizeTitle).
    // normalizeTitle does not strip "manager" from titles, but extractSeniority detects it.
    expect(SENIORITY_PREFIXES).not.toContain("manager");
    expect(extractSeniority("Manager of Engineering")).toBe("manager");
  });
});

// ---------------------------------------------------------------------------
// SeniorityLevel type -- runtime validation
// ---------------------------------------------------------------------------

describe("SeniorityLevel value set", () => {
  const VALID_LEVELS: SeniorityLevel[] = [
    "junior",
    "mid",
    "senior",
    "lead",
    "manager",
    "director",
    "vp",
  ];

  test("all values returned by extractSeniority are valid SeniorityLevel members", () => {
    // Exercise every SENIORITY_MAP entry plus the includes("manager") fallback
    const titles = [
      "Vice President of Engineering",
      "Director of Engineering",
      "Mid-Level Engineer",
      "Mid Level Engineer",
      "Principal Engineer",
      "Associate Engineer",
      "Head of Engineering",
      "VP of Engineering",
      "Senior Engineer",
      "Staff Engineer",
      "Chief Technology Officer",
      "Lead Engineer",
      "Jr. Engineer",
      "Sr. Engineer",
      "Jr Developer",
      "Sr Developer",
      "Intern Software Engineer",
      "Junior Developer",
      "Manager of QA",
      "Engineering Manager", // fallback path
    ];

    for (const title of titles) {
      const result = extractSeniority(title);
      expect(result).not.toBeNull();
      expect(VALID_LEVELS).toContain(result);
    }
  });
});
