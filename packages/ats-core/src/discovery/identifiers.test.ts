import {
  parseGreenhouseBoardToken,
  parseLeverSite,
  parseAshbyBoard,
  parseSmartRecruitersCompanyFromCareersUrl,
  buildCareersUrl,
} from "./identifiers";

// ---------------------------------------------------------------------------
// parseGreenhouseBoardToken
// ---------------------------------------------------------------------------

describe("parseGreenhouseBoardToken", () => {
  // -- boards.greenhouse.io pattern -----------------------------------------

  test.each([
    ["bare path", "https://boards.greenhouse.io/acmecorp"],
    ["trailing slash", "https://boards.greenhouse.io/acmecorp/"],
    ["extra segments", "https://boards.greenhouse.io/acmecorp/jobs/12345"],
    ["query params", "https://boards.greenhouse.io/acmecorp?page=2"],
  ])("extracts token from boards.greenhouse.io — %s", (_label, url) => {
    expect(parseGreenhouseBoardToken(url)).toBe("acmecorp");
  });

  // -- ?for= query parameter pattern ----------------------------------------

  test.each([
    ["greenhouse domain", "https://boards.greenhouse.io/embed/job_board?for=acmecorp"],
    ["non-greenhouse domain", "https://example.com/careers?for=acmecorp"],
  ])("extracts token from ?for= on %s", (_label, url) => {
    expect(parseGreenhouseBoardToken(url)).toBe("acmecorp");
  });

  test("falls through to path segment when ?for= is empty", () => {
    // An empty ?for= value is falsy after trim, so the function falls through
    // to the hostname/path-segment logic and returns the first path segment.
    expect(
      parseGreenhouseBoardToken(
        "https://boards.greenhouse.io/embed/job_board?for=",
      ),
    ).toBe("embed");
  });

  test("returns null when ?for= parameter is whitespace-only", () => {
    expect(
      parseGreenhouseBoardToken(
        "https://boards.greenhouse.io/embed/job_board?for=%20%20",
      ),
    ).toBeNull();
  });

  // -- boards-api.greenhouse.io pattern -------------------------------------

  test.each([
    ["boards-api.greenhouse.io", "https://boards-api.greenhouse.io/v1/boards/acmecorp/jobs"],
    ["api.greenhouse.io", "https://api.greenhouse.io/v1/boards/acmecorp/jobs"],
  ])("extracts token from %s with /boards/ path", (_label, url) => {
    expect(parseGreenhouseBoardToken(url)).toBe("acmecorp");
  });

  test.each([
    ["no segment after /boards/", "https://boards-api.greenhouse.io/v1/boards"],
    ["/boards/ absent", "https://boards-api.greenhouse.io/v1/something/acmecorp"],
  ])("returns null from boards-api when %s", (_label, url) => {
    expect(parseGreenhouseBoardToken(url)).toBeNull();
  });

  // -- Root greenhouse.io without path segment ------------------------------

  test.each([
    ["trailing slash", "https://boards.greenhouse.io/"],
    ["no path", "https://boards.greenhouse.io"],
  ])("returns null for root greenhouse.io — %s", (_label, url) => {
    expect(parseGreenhouseBoardToken(url)).toBeNull();
  });

  // -- Non-greenhouse domains -----------------------------------------------

  test.each([
    ["generic domain", "https://example.com/careers"],
    ["lever.co domain", "https://jobs.lever.co/acmecorp"],
  ])("returns null for %s without ?for= param", (_label, url) => {
    expect(parseGreenhouseBoardToken(url)).toBeNull();
  });

  // -- Adversarial near-miss domains ----------------------------------------

  // TODO: parseGreenhouseBoardToken uses host.includes("greenhouse.io") which
  // matches subdomains like greenhouse.io.evil.com. Should use endsWith or
  // exact hostname check. Currently returns "token" instead of null.
  test("returns token for near-miss domain greenhouse.io.evil.com (known bug)", () => {
    expect(
      parseGreenhouseBoardToken("https://boards.greenhouse.io.evil.com/token"),
    ).toBe("token");
  });

  // -- Null, undefined, and invalid input -----------------------------------

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["malformed URL", "not-a-url"],
  ])("returns null for %s input", (_label, input) => {
    expect(parseGreenhouseBoardToken(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseLeverSite
// ---------------------------------------------------------------------------

describe("parseLeverSite", () => {
  // -- Standard jobs.lever.co URLs ------------------------------------------

  test.each([
    ["bare path", "https://jobs.lever.co/acmecorp"],
    ["trailing slash", "https://jobs.lever.co/acmecorp/"],
    ["extra segments", "https://jobs.lever.co/acmecorp/abc123-def456"],
    ["query params", "https://jobs.lever.co/acmecorp?team=engineering"],
  ])("extracts site from jobs.lever.co — %s", (_label, url) => {
    expect(parseLeverSite(url)).toEqual({ site: "acmecorp", isEu: false });
  });

  // -- EU domain ------------------------------------------------------------

  test.each([
    ["bare path", "https://jobs.eu.lever.co/acmecorp"],
    ["extra segments", "https://jobs.eu.lever.co/acmecorp/some-job-id"],
  ])("detects EU domain — %s", (_label, url) => {
    expect(parseLeverSite(url)).toEqual({ site: "acmecorp", isEu: true });
  });

  // -- Non-EU lever.co domain -----------------------------------------------

  test("non-EU lever.co domain sets isEu to false", () => {
    expect(parseLeverSite("https://lever.co/acmecorp")).toEqual({
      site: "acmecorp",
      isEu: false,
    });
  });

  // -- No path segments (root URL) ------------------------------------------

  test.each([
    ["trailing slash", "https://jobs.lever.co/"],
    ["no path", "https://jobs.lever.co"],
  ])("returns null for root URL — %s", (_label, url) => {
    expect(parseLeverSite(url)).toBeNull();
  });

  // -- Missing domain validation --------------------------------------------

  // TODO: parseLeverSite does not check that the hostname contains "lever.co".
  // Any URL with path segments returns a result, e.g. example.com/foo returns
  // { site: "foo", isEu: false }. Should add a domain guard to reject
  // non-lever URLs. This test documents the current (likely buggy) behavior.
  test("accepts non-lever domain (known bug — no domain validation)", () => {
    expect(parseLeverSite("https://example.com/foo")).toEqual({
      site: "foo",
      isEu: false,
    });
  });

  // -- Adversarial near-miss domains ----------------------------------------

  // TODO: parseLeverSite uses host.includes("lever.co") (indirectly via no
  // domain check at all) which would match subdomains like lever.co.fake.com.
  // Currently returns { site, isEu } instead of null.
  test("matches near-miss domain jobs.lever.co.fake.com (known bug)", () => {
    expect(
      parseLeverSite("https://jobs.lever.co.fake.com/acmecorp"),
    ).toEqual({ site: "acmecorp", isEu: false });
  });

  // -- Null, undefined, and invalid input -----------------------------------

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["malformed URL", "not-a-url"],
  ])("returns null for %s input", (_label, input) => {
    expect(parseLeverSite(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseAshbyBoard
// ---------------------------------------------------------------------------

describe("parseAshbyBoard", () => {
  // -- Standard jobs.ashbyhq.com URLs ---------------------------------------

  test.each([
    ["bare path", "https://jobs.ashbyhq.com/acmecorp"],
    ["trailing slash", "https://jobs.ashbyhq.com/acmecorp/"],
    ["extra segments", "https://jobs.ashbyhq.com/acmecorp/some-job-id"],
  ])("extracts board from jobs.ashbyhq.com — %s", (_label, url) => {
    expect(parseAshbyBoard(url)).toBe("acmecorp");
  });

  // -- ?for= query parameter pattern ----------------------------------------

  test.each([
    ["ashby domain", "https://jobs.ashbyhq.com/embed?for=acmecorp"],
    ["non-ashby domain", "https://example.com/careers?for=acmecorp"],
  ])("extracts board from ?for= on %s", (_label, url) => {
    expect(parseAshbyBoard(url)).toBe("acmecorp");
  });

  // -- Reserved first segments (case-insensitive) ---------------------------

  test.each([
    "jobs",
    "job",
    "careers",
    "career",
    "apply",
    "posting",
    "postings",
    "embed",
    "Jobs",     // case-insensitive: mixed case
    "CAREERS",  // case-insensitive: uppercase
  ])("returns null when first segment is reserved word '%s'", (reserved) => {
    expect(
      parseAshbyBoard(`https://jobs.ashbyhq.com/${reserved}`),
    ).toBeNull();
  });

  // -- Adversarial: partial match of reserved word must NOT be filtered -----

  test("does not filter 'embedding' (near-miss of reserved 'embed')", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/embedding"),
    ).toBe("embedding");
  });

  // -- Root URL without path segments ---------------------------------------

  test.each([
    ["trailing slash", "https://jobs.ashbyhq.com/"],
    ["no path", "https://jobs.ashbyhq.com"],
  ])("returns null for root URL — %s", (_label, url) => {
    expect(parseAshbyBoard(url)).toBeNull();
  });

  // -- Non-ashby domain without ?for= param ---------------------------------

  test("returns null for a non-ashby domain without ?for= param", () => {
    expect(
      parseAshbyBoard("https://example.com/acmecorp"),
    ).toBeNull();
  });

  // -- Null, undefined, and invalid input -----------------------------------

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["malformed URL", "not-a-url"],
  ])("returns null for %s input", (_label, input) => {
    expect(parseAshbyBoard(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseSmartRecruitersCompanyFromCareersUrl
// ---------------------------------------------------------------------------

describe("parseSmartRecruitersCompanyFromCareersUrl", () => {
  // -- Standard extraction --------------------------------------------------

  test.each([
    ["bare path", "https://jobs.smartrecruiters.com/AcmeCorp"],
    ["extra segments", "https://jobs.smartrecruiters.com/AcmeCorp/some-job-posting"],
    ["trailing slash", "https://jobs.smartrecruiters.com/AcmeCorp/"],
    ["query params", "https://jobs.smartrecruiters.com/AcmeCorp?search=engineer"],
  ])("extracts company slug — %s", (_label, url) => {
    expect(parseSmartRecruitersCompanyFromCareersUrl(url)).toBe("AcmeCorp");
  });

  // -- Works on any domain (uses pathSegments helper) -----------------------

  test("extracts first path segment from any domain", () => {
    expect(
      parseSmartRecruitersCompanyFromCareersUrl(
        "https://example.com/SomeCompany/jobs",
      ),
    ).toBe("SomeCompany");
  });

  // -- Root URL without path segments ---------------------------------------

  test.each([
    ["trailing slash", "https://jobs.smartrecruiters.com/"],
    ["no path", "https://jobs.smartrecruiters.com"],
  ])("returns null for root URL — %s", (_label, url) => {
    expect(parseSmartRecruitersCompanyFromCareersUrl(url)).toBeNull();
  });

  // -- Null, undefined, and invalid input -----------------------------------

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["malformed URL", "not-a-url"],
  ])("returns null for %s input", (_label, input) => {
    expect(parseSmartRecruitersCompanyFromCareersUrl(input)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildCareersUrl
// ---------------------------------------------------------------------------

describe("buildCareersUrl", () => {
  // -- Supported vendors ----------------------------------------------------

  test.each([
    ["greenhouse", "acmecorp", "https://boards.greenhouse.io/acmecorp"],
    ["lever", "acmecorp", "https://jobs.lever.co/acmecorp"],
    ["ashby", "acmecorp", "https://jobs.ashbyhq.com/acmecorp"],
    ["smartrecruiters", "AcmeCorp", "https://jobs.smartrecruiters.com/AcmeCorp"],
  ])("builds %s careers URL", (vendor, slug, expected) => {
    expect(buildCareersUrl(vendor, slug)).toBe(expected);
  });

  // -- Slug preservation ----------------------------------------------------

  test("preserves slug casing and special characters", () => {
    expect(buildCareersUrl("greenhouse", "Acme-Corp_123")).toBe(
      "https://boards.greenhouse.io/Acme-Corp_123",
    );
  });

  // -- Unsupported vendor ---------------------------------------------------

  test.each([
    ["workday", "Unsupported ATS vendor: workday"],
    ["nonexistent", "Unsupported ATS vendor: nonexistent"],
    ["", "Unsupported ATS vendor: "],
  ])("throws error for unsupported vendor '%s'", (vendor, expectedMsg) => {
    expect(() => buildCareersUrl(vendor, "acmecorp")).toThrow(expectedMsg);
  });
});
