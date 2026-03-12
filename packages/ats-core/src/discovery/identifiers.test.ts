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

  test("extracts token from boards.greenhouse.io/{token}", () => {
    expect(
      parseGreenhouseBoardToken("https://boards.greenhouse.io/acmecorp"),
    ).toBe("acmecorp");
  });

  test("extracts token from boards.greenhouse.io/{token} with trailing slash", () => {
    expect(
      parseGreenhouseBoardToken("https://boards.greenhouse.io/acmecorp/"),
    ).toBe("acmecorp");
  });

  test("extracts token when additional path segments follow the token", () => {
    expect(
      parseGreenhouseBoardToken(
        "https://boards.greenhouse.io/acmecorp/jobs/12345",
      ),
    ).toBe("acmecorp");
  });

  test("extracts token with query parameters present", () => {
    expect(
      parseGreenhouseBoardToken(
        "https://boards.greenhouse.io/acmecorp?page=2",
      ),
    ).toBe("acmecorp");
  });

  // -- ?for= query parameter pattern ----------------------------------------

  test("extracts token from ?for= query parameter", () => {
    expect(
      parseGreenhouseBoardToken(
        "https://boards.greenhouse.io/embed/job_board?for=acmecorp",
      ),
    ).toBe("acmecorp");
  });

  test("extracts token from ?for= on a non-greenhouse domain", () => {
    expect(
      parseGreenhouseBoardToken(
        "https://example.com/careers?for=acmecorp",
      ),
    ).toBe("acmecorp");
  });

  test("falls through to path segment when ?for= parameter is empty", () => {
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

  test("extracts token from boards-api.greenhouse.io/v1/boards/{token}", () => {
    expect(
      parseGreenhouseBoardToken(
        "https://boards-api.greenhouse.io/v1/boards/acmecorp/jobs",
      ),
    ).toBe("acmecorp");
  });

  test("extracts token from api.greenhouse.io with /boards/ in the path", () => {
    expect(
      parseGreenhouseBoardToken(
        "https://api.greenhouse.io/v1/boards/acmecorp/jobs",
      ),
    ).toBe("acmecorp");
  });

  test("returns null from boards-api.greenhouse.io when no segment follows /boards/", () => {
    expect(
      parseGreenhouseBoardToken(
        "https://boards-api.greenhouse.io/v1/boards",
      ),
    ).toBeNull();
  });

  test("returns null from boards-api.greenhouse.io when /boards/ is absent", () => {
    expect(
      parseGreenhouseBoardToken(
        "https://boards-api.greenhouse.io/v1/something/acmecorp",
      ),
    ).toBeNull();
  });

  // -- Root greenhouse.io without path segment ------------------------------

  test("returns null when hostname is greenhouse.io with no path segments", () => {
    expect(
      parseGreenhouseBoardToken("https://boards.greenhouse.io/"),
    ).toBeNull();
  });

  test("returns null when hostname is greenhouse.io with empty path", () => {
    expect(
      parseGreenhouseBoardToken("https://boards.greenhouse.io"),
    ).toBeNull();
  });

  // -- Non-greenhouse domains -----------------------------------------------

  test("returns null for a non-greenhouse domain without ?for= param", () => {
    expect(
      parseGreenhouseBoardToken("https://example.com/careers"),
    ).toBeNull();
  });

  test("returns null for lever.co domain", () => {
    expect(
      parseGreenhouseBoardToken("https://jobs.lever.co/acmecorp"),
    ).toBeNull();
  });

  // -- Null, undefined, and invalid input -----------------------------------

  test("returns null for null input", () => {
    expect(parseGreenhouseBoardToken(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(parseGreenhouseBoardToken(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseGreenhouseBoardToken("")).toBeNull();
  });

  test("returns null for malformed URL", () => {
    expect(parseGreenhouseBoardToken("not-a-url")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseLeverSite
// ---------------------------------------------------------------------------

describe("parseLeverSite", () => {
  // -- Standard jobs.lever.co URLs ------------------------------------------

  test("extracts site from jobs.lever.co/{site}", () => {
    const result = parseLeverSite("https://jobs.lever.co/acmecorp");
    expect(result).toEqual({ site: "acmecorp", isEu: false });
  });

  test("extracts site with trailing slash", () => {
    const result = parseLeverSite("https://jobs.lever.co/acmecorp/");
    expect(result).toEqual({ site: "acmecorp", isEu: false });
  });

  test("extracts site when additional path segments follow", () => {
    const result = parseLeverSite(
      "https://jobs.lever.co/acmecorp/abc123-def456",
    );
    expect(result).toEqual({ site: "acmecorp", isEu: false });
  });

  test("extracts site with query parameters present", () => {
    const result = parseLeverSite(
      "https://jobs.lever.co/acmecorp?team=engineering",
    );
    expect(result).toEqual({ site: "acmecorp", isEu: false });
  });

  // -- EU domain ------------------------------------------------------------

  test("detects EU domain from jobs.eu.lever.co", () => {
    const result = parseLeverSite("https://jobs.eu.lever.co/acmecorp");
    expect(result).toEqual({ site: "acmecorp", isEu: true });
  });

  test("detects EU domain with trailing slash and additional segments", () => {
    const result = parseLeverSite(
      "https://jobs.eu.lever.co/acmecorp/some-job-id",
    );
    expect(result).toEqual({ site: "acmecorp", isEu: true });
  });

  // -- Non-EU lever.co domain -----------------------------------------------

  test("non-EU lever.co domain sets isEu to false", () => {
    const result = parseLeverSite("https://lever.co/acmecorp");
    expect(result).toEqual({ site: "acmecorp", isEu: false });
  });

  // -- No path segments (root URL) ------------------------------------------

  test("returns null when there are no path segments", () => {
    expect(parseLeverSite("https://jobs.lever.co/")).toBeNull();
  });

  test("returns null when URL has no path at all", () => {
    expect(parseLeverSite("https://jobs.lever.co")).toBeNull();
  });

  // -- Null, undefined, and invalid input -----------------------------------

  test("returns null for null input", () => {
    expect(parseLeverSite(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(parseLeverSite(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseLeverSite("")).toBeNull();
  });

  test("returns null for malformed URL", () => {
    expect(parseLeverSite("not-a-url")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseAshbyBoard
// ---------------------------------------------------------------------------

describe("parseAshbyBoard", () => {
  // -- Standard jobs.ashbyhq.com URLs ---------------------------------------

  test("extracts board from jobs.ashbyhq.com/{board}", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/acmecorp"),
    ).toBe("acmecorp");
  });

  test("extracts board with trailing slash", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/acmecorp/"),
    ).toBe("acmecorp");
  });

  test("extracts board when additional path segments follow", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/acmecorp/some-job-id"),
    ).toBe("acmecorp");
  });

  // -- ?for= query parameter pattern ----------------------------------------

  test("extracts board from ?for= query parameter", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/embed?for=acmecorp"),
    ).toBe("acmecorp");
  });

  test("extracts board from ?for= on a non-ashby domain", () => {
    expect(
      parseAshbyBoard("https://example.com/careers?for=acmecorp"),
    ).toBe("acmecorp");
  });

  // -- Reserved first segments that should be ignored -----------------------

  test("returns null when first segment is 'jobs'", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/jobs"),
    ).toBeNull();
  });

  test("returns null when first segment is 'job'", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/job"),
    ).toBeNull();
  });

  test("returns null when first segment is 'careers'", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/careers"),
    ).toBeNull();
  });

  test("returns null when first segment is 'career'", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/career"),
    ).toBeNull();
  });

  test("returns null when first segment is 'apply'", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/apply"),
    ).toBeNull();
  });

  test("returns null when first segment is 'posting'", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/posting"),
    ).toBeNull();
  });

  test("returns null when first segment is 'postings'", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/postings"),
    ).toBeNull();
  });

  test("returns null when first segment is 'embed'", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/embed"),
    ).toBeNull();
  });

  test("reserved segment check is case-insensitive", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/Jobs"),
    ).toBeNull();
  });

  test("reserved segment check is case-insensitive (CAREERS)", () => {
    expect(
      parseAshbyBoard("https://jobs.ashbyhq.com/CAREERS"),
    ).toBeNull();
  });

  // -- Root URL without path segments ---------------------------------------

  test("returns null when there are no path segments", () => {
    expect(parseAshbyBoard("https://jobs.ashbyhq.com/")).toBeNull();
  });

  test("returns null when URL has no path at all", () => {
    expect(parseAshbyBoard("https://jobs.ashbyhq.com")).toBeNull();
  });

  // -- Non-ashby domain without ?for= param ---------------------------------

  test("returns null for a non-ashby domain without ?for= param", () => {
    expect(
      parseAshbyBoard("https://example.com/acmecorp"),
    ).toBeNull();
  });

  // -- Null, undefined, and invalid input -----------------------------------

  test("returns null for null input", () => {
    expect(parseAshbyBoard(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(parseAshbyBoard(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseAshbyBoard("")).toBeNull();
  });

  test("returns null for malformed URL", () => {
    expect(parseAshbyBoard("not-a-url")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseSmartRecruitersCompanyFromCareersUrl
// ---------------------------------------------------------------------------

describe("parseSmartRecruitersCompanyFromCareersUrl", () => {
  // -- Standard extraction --------------------------------------------------

  test("extracts company slug from jobs.smartrecruiters.com/{company}", () => {
    expect(
      parseSmartRecruitersCompanyFromCareersUrl(
        "https://jobs.smartrecruiters.com/AcmeCorp",
      ),
    ).toBe("AcmeCorp");
  });

  test("extracts first path segment when additional segments follow", () => {
    expect(
      parseSmartRecruitersCompanyFromCareersUrl(
        "https://jobs.smartrecruiters.com/AcmeCorp/some-job-posting",
      ),
    ).toBe("AcmeCorp");
  });

  test("extracts first path segment with trailing slash", () => {
    expect(
      parseSmartRecruitersCompanyFromCareersUrl(
        "https://jobs.smartrecruiters.com/AcmeCorp/",
      ),
    ).toBe("AcmeCorp");
  });

  test("extracts first path segment with query parameters", () => {
    expect(
      parseSmartRecruitersCompanyFromCareersUrl(
        "https://jobs.smartrecruiters.com/AcmeCorp?search=engineer",
      ),
    ).toBe("AcmeCorp");
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

  test("returns null when there are no path segments", () => {
    expect(
      parseSmartRecruitersCompanyFromCareersUrl(
        "https://jobs.smartrecruiters.com/",
      ),
    ).toBeNull();
  });

  test("returns null when URL has no path at all", () => {
    expect(
      parseSmartRecruitersCompanyFromCareersUrl(
        "https://jobs.smartrecruiters.com",
      ),
    ).toBeNull();
  });

  // -- Null, undefined, and invalid input -----------------------------------

  test("returns null for null input", () => {
    expect(parseSmartRecruitersCompanyFromCareersUrl(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(parseSmartRecruitersCompanyFromCareersUrl(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseSmartRecruitersCompanyFromCareersUrl("")).toBeNull();
  });

  test("returns null for malformed URL", () => {
    expect(
      parseSmartRecruitersCompanyFromCareersUrl("not-a-url"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildCareersUrl
// ---------------------------------------------------------------------------

describe("buildCareersUrl", () => {
  // -- Supported vendors ----------------------------------------------------

  test("builds Greenhouse careers URL", () => {
    expect(buildCareersUrl("greenhouse", "acmecorp")).toBe(
      "https://boards.greenhouse.io/acmecorp",
    );
  });

  test("builds Lever careers URL", () => {
    expect(buildCareersUrl("lever", "acmecorp")).toBe(
      "https://jobs.lever.co/acmecorp",
    );
  });

  test("builds Ashby careers URL", () => {
    expect(buildCareersUrl("ashby", "acmecorp")).toBe(
      "https://jobs.ashbyhq.com/acmecorp",
    );
  });

  test("builds SmartRecruiters careers URL", () => {
    expect(buildCareersUrl("smartrecruiters", "AcmeCorp")).toBe(
      "https://jobs.smartrecruiters.com/AcmeCorp",
    );
  });

  // -- Slug preservation ----------------------------------------------------

  test("preserves slug casing and special characters", () => {
    expect(buildCareersUrl("greenhouse", "Acme-Corp_123")).toBe(
      "https://boards.greenhouse.io/Acme-Corp_123",
    );
  });

  // -- Unsupported vendor ---------------------------------------------------

  test("throws error for unsupported vendor", () => {
    expect(() => buildCareersUrl("workday", "acmecorp")).toThrow(
      "Unsupported ATS vendor: workday",
    );
  });

  test("throws error for unknown vendor string", () => {
    expect(() => buildCareersUrl("nonexistent", "acmecorp")).toThrow(
      "Unsupported ATS vendor: nonexistent",
    );
  });

  test("throws error for empty vendor string", () => {
    expect(() => buildCareersUrl("", "acmecorp")).toThrow(
      "Unsupported ATS vendor: ",
    );
  });
});
