import {
  normalizeEmploymentType,
  normalizePostedDate,
} from "./field-normalizers";

// ---------------------------------------------------------------------------
// normalizeEmploymentType
// ---------------------------------------------------------------------------

describe("normalizeEmploymentType", () => {
  test.each<[string, string]>([
    ["full-time", "full_time"],
    ["Full-time", "full_time"],
    ["FULL-TIME", "full_time"],
    ["fulltime", "full_time"],
    ["FullTime", "full_time"],
    ["full time", "full_time"],
    ["Full Time", "full_time"],
    ["permanent", "full_time"],
    ["Permanent", "full_time"],
  ])("'%s' maps to full_time", (input, expected) => {
    expect(normalizeEmploymentType(input)).toBe(expected);
  });

  test.each<[string, string]>([
    ["part-time", "part_time"],
    ["Part-Time", "part_time"],
    ["parttime", "part_time"],
    ["PartTime", "part_time"],
    ["part time", "part_time"],
  ])("'%s' maps to part_time", (input, expected) => {
    expect(normalizeEmploymentType(input)).toBe(expected);
  });

  test.each<[string, string]>([
    ["contract", "contract"],
    ["Contract", "contract"],
    ["contractor", "contract"],
    ["Contractor", "contract"],
  ])("'%s' maps to contract", (input, expected) => {
    expect(normalizeEmploymentType(input)).toBe(expected);
  });

  test.each<[string, string]>([
    ["intern", "intern"],
    ["Intern", "intern"],
    ["internship", "intern"],
    ["Internship", "intern"],
  ])("'%s' maps to intern", (input, expected) => {
    expect(normalizeEmploymentType(input)).toBe(expected);
  });

  test.each<[string, string]>([
    ["temp", "temp"],
    ["Temp", "temp"],
    ["temporary", "temp"],
    ["Temporary", "temp"],
  ])("'%s' maps to temp", (input, expected) => {
    expect(normalizeEmploymentType(input)).toBe(expected);
  });

  test.each([
    "freelance",
    "gig",
    "seasonal",
    "casual",
    "weird value",
    "1099",
  ])("'%s' is unrecognized and returns null", (input) => {
    expect(normalizeEmploymentType(input)).toBeNull();
  });

  test("null input returns null", () => {
    expect(normalizeEmploymentType(null)).toBeNull();
  });

  test("empty string returns null", () => {
    expect(normalizeEmploymentType("")).toBeNull();
  });

  test("whitespace-only string returns null", () => {
    expect(normalizeEmploymentType("   ")).toBeNull();
  });

  test("trims surrounding whitespace before matching", () => {
    expect(normalizeEmploymentType("  Full-Time  ")).toBe("full_time");
  });
});

// ---------------------------------------------------------------------------
// normalizePostedDate
// ---------------------------------------------------------------------------

describe("normalizePostedDate", () => {
  // -- ISO 8601 ----------------------------------------------------------

  test("parses YYYY-MM-DD into a Date", () => {
    const result = normalizePostedDate("2026-01-15");
    expect(result).toEqual(new Date("2026-01-15"));
  });

  test("parses full ISO timestamps into a Date", () => {
    const result = normalizePostedDate("2026-01-15T10:00:00Z");
    expect(result).toEqual(new Date("2026-01-15T10:00:00Z"));
  });

  test("parses ISO timestamps with millisecond precision", () => {
    const result = normalizePostedDate("2026-01-15T10:00:00.123Z");
    expect(result).toEqual(new Date("2026-01-15T10:00:00.123Z"));
  });

  // -- Long-form fallback ------------------------------------------------

  test("parses long-form date strings via Date constructor", () => {
    // `new Date("January 15, 2025")` parses in local time. Verify the
    // result is a valid Date for the expected calendar day in the
    // runtime's local timezone, rather than asserting UTC fields.
    const result = normalizePostedDate("January 15, 2025");
    expect(result).toBeInstanceOf(Date);
    expect(result?.getFullYear()).toBe(2025);
    expect(result?.getMonth()).toBe(0);
    expect(result?.getDate()).toBe(15);
  });

  // -- Relative dates ----------------------------------------------------

  test("'today' resolves to start-of-day of pollTimestamp", () => {
    const pollTimestamp = new Date("2026-04-08T15:42:00Z");
    const result = normalizePostedDate("today", pollTimestamp);
    expect(result).toEqual(new Date("2026-04-08T00:00:00Z"));
  });

  test("'yesterday' resolves to one day before pollTimestamp", () => {
    const pollTimestamp = new Date("2026-04-08T12:00:00Z");
    const result = normalizePostedDate("yesterday", pollTimestamp);
    expect(result).toEqual(new Date("2026-04-07T00:00:00Z"));
  });

  test("'N days ago' resolves to N days before pollTimestamp", () => {
    const pollTimestamp = new Date("2026-04-08T12:00:00Z");
    const result = normalizePostedDate("3 days ago", pollTimestamp);
    expect(result).toEqual(new Date("2026-04-05T00:00:00Z"));
  });

  test("'1 day ago' (singular) resolves to one day before pollTimestamp", () => {
    const pollTimestamp = new Date("2026-04-08T12:00:00Z");
    const result = normalizePostedDate("1 day ago", pollTimestamp);
    expect(result).toEqual(new Date("2026-04-07T00:00:00Z"));
  });

  test("'N weeks ago' resolves to N*7 days before pollTimestamp", () => {
    const pollTimestamp = new Date("2026-04-08T12:00:00Z");
    const result = normalizePostedDate("2 weeks ago", pollTimestamp);
    expect(result).toEqual(new Date("2026-03-25T00:00:00Z"));
  });

  test("'1 week ago' (singular) resolves to seven days before pollTimestamp", () => {
    const pollTimestamp = new Date("2026-04-08T12:00:00Z");
    const result = normalizePostedDate("1 week ago", pollTimestamp);
    expect(result).toEqual(new Date("2026-04-01T00:00:00Z"));
  });

  test("relative dates without pollTimestamp return null", () => {
    expect(normalizePostedDate("today")).toBeNull();
    expect(normalizePostedDate("yesterday")).toBeNull();
    expect(normalizePostedDate("2 days ago")).toBeNull();
    expect(normalizePostedDate("3 weeks ago")).toBeNull();
  });

  // -- Unparseable inputs ------------------------------------------------

  test.each(["foo bar", "not a date", "soon", "next week"])(
    "'%s' returns null when unparseable",
    (input) => {
      expect(normalizePostedDate(input)).toBeNull();
    },
  );

  test("null input returns null", () => {
    expect(normalizePostedDate(null)).toBeNull();
  });

  test("empty string returns null", () => {
    expect(normalizePostedDate("")).toBeNull();
  });

  test("whitespace-only string returns null", () => {
    expect(normalizePostedDate("   ")).toBeNull();
  });
});
