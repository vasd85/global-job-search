import { detectAtsVendor, isAtsHost, isKnownAtsVendor } from "./ats-detect";

// ---------------------------------------------------------------------------
// detectAtsVendor
// ---------------------------------------------------------------------------

describe("detectAtsVendor", () => {
  // -- Null and falsy input -------------------------------------------------

  test("returns 'unknown' for null input", () => {
    expect(detectAtsVendor(null)).toBe("unknown");
  });

  test("returns 'unknown' for empty string", () => {
    expect(detectAtsVendor("")).toBe("unknown");
  });

  // -- Invalid URLs ---------------------------------------------------------

  test("returns 'unknown' for a non-URL string", () => {
    expect(detectAtsVendor("not a url")).toBe("unknown");
  });

  test("returns 'unknown' for a bare path without protocol", () => {
    expect(detectAtsVendor("/careers/jobs")).toBe("unknown");
  });

  test("returns 'unknown' for a malformed URL with spaces", () => {
    expect(detectAtsVendor("https://example .com/jobs")).toBe("unknown");
  });

  // -- Greenhouse -----------------------------------------------------------

  describe("greenhouse", () => {
    test("detects greenhouse from boards.greenhouse.io hostname", () => {
      expect(
        detectAtsVendor("https://boards.greenhouse.io/acmecorp"),
      ).toBe("greenhouse");
    });

    test("detects greenhouse from job-boards.greenhouse.io hostname", () => {
      expect(
        detectAtsVendor("https://job-boards.greenhouse.io/acmecorp/jobs/123"),
      ).toBe("greenhouse");
    });

    test("detects greenhouse from bare greenhouse.io hostname", () => {
      expect(
        detectAtsVendor("https://greenhouse.io/some-path"),
      ).toBe("greenhouse");
    });

    test("detects greenhouse from gh_jid query parameter", () => {
      expect(
        detectAtsVendor("https://acmecorp.com/careers?gh_jid=4567890"),
      ).toBe("greenhouse");
    });

    test("detects greenhouse from gh_jid with other params before it", () => {
      expect(
        detectAtsVendor("https://acmecorp.com/careers?page=1&gh_jid=4567890"),
      ).toBe("greenhouse");
    });

    test("detects greenhouse from gh_jid in uppercase URL (case-insensitive search)", () => {
      // The function lowercases the search string, so GH_JID would become gh_jid
      expect(
        detectAtsVendor("https://acmecorp.com/careers?GH_JID=4567890"),
      ).toBe("greenhouse");
    });

    test("gh_jid takes precedence even on a non-greenhouse host", () => {
      expect(
        detectAtsVendor("https://example.com/apply?gh_jid=999"),
      ).toBe("greenhouse");
    });
  });

  // -- Lever ----------------------------------------------------------------

  describe("lever", () => {
    test("detects lever from jobs.lever.co hostname", () => {
      expect(
        detectAtsVendor("https://jobs.lever.co/acmecorp"),
      ).toBe("lever");
    });

    test("detects lever from bare lever.co hostname", () => {
      expect(
        detectAtsVendor("https://lever.co/some-path"),
      ).toBe("lever");
    });

    test("detects lever from subdomain of lever.co", () => {
      expect(
        detectAtsVendor("https://apply.lever.co/acmecorp/job-123"),
      ).toBe("lever");
    });
  });

  // -- Ashby ----------------------------------------------------------------

  describe("ashby", () => {
    test("detects ashby from jobs.ashbyhq.com hostname", () => {
      expect(
        detectAtsVendor("https://jobs.ashbyhq.com/acmecorp"),
      ).toBe("ashby");
    });

    test("detects ashby from bare ashbyhq.com hostname", () => {
      expect(
        detectAtsVendor("https://ashbyhq.com/some-path"),
      ).toBe("ashby");
    });

    test("detects ashby from ashby_jid query parameter", () => {
      expect(
        detectAtsVendor("https://acmecorp.com/careers?ashby_jid=abc123"),
      ).toBe("ashby");
    });

    test("detects ashby from ashby_jid with other params before it", () => {
      expect(
        detectAtsVendor("https://acmecorp.com/careers?page=2&ashby_jid=abc123"),
      ).toBe("ashby");
    });

    test("ashby_jid takes precedence even on a non-ashby host", () => {
      expect(
        detectAtsVendor("https://example.com/apply?ashby_jid=xyz"),
      ).toBe("ashby");
    });
  });

  // -- Workable -------------------------------------------------------------

  describe("workable", () => {
    test("detects workable from apply.workable.com hostname", () => {
      expect(
        detectAtsVendor("https://apply.workable.com/acmecorp/j/ABC123/"),
      ).toBe("workable");
    });

    test("detects workable from bare workable.com hostname", () => {
      expect(
        detectAtsVendor("https://workable.com/some-path"),
      ).toBe("workable");
    });
  });

  // -- SmartRecruiters ------------------------------------------------------

  describe("smartrecruiters", () => {
    test("detects smartrecruiters from jobs.smartrecruiters.com hostname", () => {
      expect(
        detectAtsVendor("https://jobs.smartrecruiters.com/AcmeCorp/12345-engineer"),
      ).toBe("smartrecruiters");
    });

    test("detects smartrecruiters from bare smartrecruiters.com hostname", () => {
      expect(
        detectAtsVendor("https://smartrecruiters.com/some-path"),
      ).toBe("smartrecruiters");
    });
  });

  // -- Teamtailor -----------------------------------------------------------

  describe("teamtailor", () => {
    test("detects teamtailor from company.teamtailor.com hostname", () => {
      expect(
        detectAtsVendor("https://acmecorp.teamtailor.com/jobs/12345"),
      ).toBe("teamtailor");
    });

    test("detects teamtailor from bare teamtailor.com hostname", () => {
      expect(
        detectAtsVendor("https://teamtailor.com/some-path"),
      ).toBe("teamtailor");
    });
  });

  // -- Personio -------------------------------------------------------------

  describe("personio", () => {
    test("detects personio from acmecorp.jobs.personio.com hostname", () => {
      expect(
        detectAtsVendor("https://acmecorp.jobs.personio.com/job/12345"),
      ).toBe("personio");
    });

    test("detects personio from bare personio.com hostname", () => {
      expect(
        detectAtsVendor("https://personio.com/some-path"),
      ).toBe("personio");
    });
  });

  // -- Workday --------------------------------------------------------------

  describe("workday", () => {
    test("detects workday from workdayjobs.com hostname", () => {
      expect(
        detectAtsVendor("https://acmecorp.wd5.workdayjobs.com/en-US/careers"),
      ).toBe("workday");
    });

    test("detects workday from myworkdayjobs.com hostname", () => {
      expect(
        detectAtsVendor("https://acmecorp.wd1.myworkdayjobs.com/careers"),
      ).toBe("workday");
    });

    test("detects workday from /wday/cxs/ path on any host", () => {
      expect(
        detectAtsVendor("https://example.com/wday/cxs/acmecorp/careers/jobs"),
      ).toBe("workday");
    });

    test("detects workday from /wday/cxs/ path with deeper nesting", () => {
      expect(
        detectAtsVendor("https://custom-domain.com/wday/cxs/company/site/1/2"),
      ).toBe("workday");
    });
  });

  // -- BambooHR -------------------------------------------------------------

  describe("bamboohr", () => {
    test("detects bamboohr from acmecorp.bamboohr.com hostname", () => {
      expect(
        detectAtsVendor("https://acmecorp.bamboohr.com/careers/list"),
      ).toBe("bamboohr");
    });

    test("detects bamboohr from bare bamboohr.com hostname", () => {
      expect(
        detectAtsVendor("https://bamboohr.com/some-path"),
      ).toBe("bamboohr");
    });
  });

  // -- Breezy ---------------------------------------------------------------

  describe("breezy", () => {
    test("detects breezy from acmecorp.breezy.hr hostname", () => {
      expect(
        detectAtsVendor("https://acmecorp.breezy.hr/p/abc123/senior-engineer"),
      ).toBe("breezy");
    });

    test("detects breezy from bare breezy.hr hostname", () => {
      expect(
        detectAtsVendor("https://breezy.hr/some-path"),
      ).toBe("breezy");
    });
  });

  // -- Unknown vendors ------------------------------------------------------

  describe("unknown vendors", () => {
    test("returns 'unknown' for a generic company website", () => {
      expect(
        detectAtsVendor("https://acmecorp.com/careers"),
      ).toBe("unknown");
    });

    test("returns 'unknown' for a job board that is not a recognized ATS", () => {
      expect(
        detectAtsVendor("https://jobs.indeed.com/posting/12345"),
      ).toBe("unknown");
    });

    test("returns 'unknown' for linkedin job URLs", () => {
      expect(
        detectAtsVendor("https://www.linkedin.com/jobs/view/12345"),
      ).toBe("unknown");
    });
  });

  // -- Case insensitivity ---------------------------------------------------

  describe("case insensitivity", () => {
    test("detects greenhouse from uppercase hostname", () => {
      expect(
        detectAtsVendor("https://BOARDS.GREENHOUSE.IO/AcmeCorp"),
      ).toBe("greenhouse");
    });

    test("detects lever from mixed-case hostname", () => {
      expect(
        detectAtsVendor("https://Jobs.Lever.Co/AcmeCorp"),
      ).toBe("lever");
    });

    test("detects workday from uppercase path /WDAY/CXS/", () => {
      expect(
        detectAtsVendor("https://example.com/WDAY/CXS/company/careers"),
      ).toBe("workday");
    });
  });

  // -- Query parameter edge cases -------------------------------------------

  describe("query parameter edge cases", () => {
    test("does not false-positive on gh_jid appearing as part of another param name", () => {
      // "xgh_jid" should not match the regex [?&]gh_jid=
      expect(
        detectAtsVendor("https://example.com/careers?xgh_jid=123"),
      ).toBe("unknown");
    });

    test("does not false-positive on ashby_jid appearing as part of another param name", () => {
      expect(
        detectAtsVendor("https://example.com/careers?not_ashby_jid=123"),
      ).toBe("unknown");
    });

    test("detects greenhouse when gh_jid is the only query param", () => {
      expect(
        detectAtsVendor("https://example.com/careers?gh_jid=1"),
      ).toBe("greenhouse");
    });

    test("gh_jid query param check takes priority over host-based ashby detection", () => {
      // If both gh_jid and ashbyhq.com were present, gh_jid comes first in the code
      expect(
        detectAtsVendor("https://ashbyhq.com/careers?gh_jid=1"),
      ).toBe("greenhouse");
    });

    test("ashby_jid query param check takes priority over host-based detection for lower vendors", () => {
      expect(
        detectAtsVendor("https://workable.com/careers?ashby_jid=abc"),
      ).toBe("ashby");
    });
  });

  // -- URL with ports, protocols, and paths ---------------------------------

  describe("URLs with different structures", () => {
    test("detects vendor from URL with explicit port", () => {
      expect(
        detectAtsVendor("https://boards.greenhouse.io:443/acmecorp"),
      ).toBe("greenhouse");
    });

    test("detects vendor from http:// (not just https://)", () => {
      expect(
        detectAtsVendor("http://jobs.lever.co/acmecorp"),
      ).toBe("lever");
    });

    test("detects vendor from URL with query string and fragment", () => {
      expect(
        detectAtsVendor("https://jobs.ashbyhq.com/acmecorp?sort=recent#top"),
      ).toBe("ashby");
    });

    test("detects vendor from URL with trailing slash", () => {
      expect(
        detectAtsVendor("https://apply.workable.com/acmecorp/"),
      ).toBe("workable");
    });

    test("detects vendor from URL with no path", () => {
      expect(
        detectAtsVendor("https://greenhouse.io"),
      ).toBe("greenhouse");
    });
  });
});

// ---------------------------------------------------------------------------
// isAtsHost
// ---------------------------------------------------------------------------

describe("isAtsHost", () => {
  test("returns true for a recognized ATS hostname (greenhouse)", () => {
    expect(isAtsHost("https://boards.greenhouse.io/acmecorp")).toBe(true);
  });

  test("returns true for a recognized ATS hostname (lever)", () => {
    expect(isAtsHost("https://jobs.lever.co/acmecorp")).toBe(true);
  });

  test("returns true for a recognized ATS hostname (ashby)", () => {
    expect(isAtsHost("https://jobs.ashbyhq.com/acmecorp")).toBe(true);
  });

  test("returns true for a recognized ATS hostname (workday via path)", () => {
    expect(isAtsHost("https://example.com/wday/cxs/company/site")).toBe(true);
  });

  test("returns false for a generic non-ATS URL", () => {
    expect(isAtsHost("https://example.com/careers")).toBe(false);
  });

  test("returns false for an empty string", () => {
    expect(isAtsHost("")).toBe(false);
  });

  test("returns false for an invalid URL", () => {
    expect(isAtsHost("not-a-url")).toBe(false);
  });

  test("returns true for every supported ATS vendor", () => {
    const atsUrls = [
      "https://boards.greenhouse.io/company",
      "https://jobs.lever.co/company",
      "https://jobs.ashbyhq.com/company",
      "https://apply.workable.com/company",
      "https://jobs.smartrecruiters.com/company",
      "https://company.teamtailor.com/jobs",
      "https://company.jobs.personio.com/job/1",
      "https://company.wd5.workdayjobs.com/careers",
      "https://company.bamboohr.com/careers",
      "https://company.breezy.hr/p/abc",
    ];
    for (const url of atsUrls) {
      expect(isAtsHost(url)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// isKnownAtsVendor
// ---------------------------------------------------------------------------

describe("isKnownAtsVendor", () => {
  test("returns true for 'greenhouse'", () => {
    expect(isKnownAtsVendor("greenhouse")).toBe(true);
  });

  test("returns true for 'lever'", () => {
    expect(isKnownAtsVendor("lever")).toBe(true);
  });

  test("returns true for 'ashby'", () => {
    expect(isKnownAtsVendor("ashby")).toBe(true);
  });

  test("returns true for 'workable'", () => {
    expect(isKnownAtsVendor("workable")).toBe(true);
  });

  test("returns true for 'smartrecruiters'", () => {
    expect(isKnownAtsVendor("smartrecruiters")).toBe(true);
  });

  test("returns true for 'teamtailor'", () => {
    expect(isKnownAtsVendor("teamtailor")).toBe(true);
  });

  test("returns true for 'personio'", () => {
    expect(isKnownAtsVendor("personio")).toBe(true);
  });

  test("returns true for 'workday'", () => {
    expect(isKnownAtsVendor("workday")).toBe(true);
  });

  test("returns true for 'bamboohr'", () => {
    expect(isKnownAtsVendor("bamboohr")).toBe(true);
  });

  test("returns true for 'breezy'", () => {
    expect(isKnownAtsVendor("breezy")).toBe(true);
  });

  test("returns false for 'unknown'", () => {
    expect(isKnownAtsVendor("unknown")).toBe(false);
  });

  test("returns false for 'custom'", () => {
    expect(isKnownAtsVendor("custom")).toBe(false);
  });
});
