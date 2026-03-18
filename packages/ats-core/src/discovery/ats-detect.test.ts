import type { AtsVendor } from "../types";
import { detectAtsVendor, isAtsHost, isKnownAtsVendor } from "./ats-detect";

// ---------------------------------------------------------------------------
// detectAtsVendor
// ---------------------------------------------------------------------------

describe("detectAtsVendor", () => {
  // -- Null, falsy, and invalid input ---------------------------------------

  test.each([
    ["null", null],
    ["empty string", ""],
    ["non-URL string", "not a url"],
    ["bare path without protocol", "/careers/jobs"],
    ["malformed URL with spaces", "https://example .com/jobs"],
  ])("returns 'unknown' for %s", (_label, input) => {
    expect(detectAtsVendor(input)).toBe("unknown");
  });

  // -- Host-based vendor detection ------------------------------------------

  test.each<[string, string]>([
    // greenhouse
    ["greenhouse", "https://boards.greenhouse.io/acmecorp"],
    ["greenhouse", "https://job-boards.greenhouse.io/acmecorp/jobs/123"],
    ["greenhouse", "https://greenhouse.io/some-path"],
    ["greenhouse", "https://greenhouse.io"],
    // lever
    ["lever", "https://jobs.lever.co/acmecorp"],
    ["lever", "https://lever.co/some-path"],
    ["lever", "https://apply.lever.co/acmecorp/job-123"],
    // ashby
    ["ashby", "https://jobs.ashbyhq.com/acmecorp"],
    ["ashby", "https://ashbyhq.com/some-path"],
    // workable
    ["workable", "https://apply.workable.com/acmecorp/j/ABC123/"],
    ["workable", "https://workable.com/some-path"],
    // smartrecruiters
    ["smartrecruiters", "https://jobs.smartrecruiters.com/AcmeCorp/12345-engineer"],
    ["smartrecruiters", "https://smartrecruiters.com/some-path"],
    // teamtailor
    ["teamtailor", "https://acmecorp.teamtailor.com/jobs/12345"],
    ["teamtailor", "https://teamtailor.com/some-path"],
    // personio
    ["personio", "https://acmecorp.jobs.personio.com/job/12345"],
    ["personio", "https://personio.com/some-path"],
    // workday
    ["workday", "https://acmecorp.wd5.workdayjobs.com/en-US/careers"],
    ["workday", "https://acmecorp.wd1.myworkdayjobs.com/careers"],
    ["workday", "https://example.com/wday/cxs/acmecorp/careers/jobs"],
    ["workday", "https://custom-domain.com/wday/cxs/company/site/1/2"],
    // bamboohr
    ["bamboohr", "https://acmecorp.bamboohr.com/careers/list"],
    ["bamboohr", "https://bamboohr.com/some-path"],
    // breezy
    ["breezy", "https://acmecorp.breezy.hr/p/abc123/senior-engineer"],
    ["breezy", "https://breezy.hr/some-path"],
  ])("detects %s from %s", (vendor, url) => {
    expect(detectAtsVendor(url)).toBe(vendor);
  });

  // -- Case insensitivity & URL structure variations ------------------------

  test.each<[string, string]>([
    ["greenhouse", "https://BOARDS.GREENHOUSE.IO/AcmeCorp"],
    ["lever", "https://Jobs.Lever.Co/AcmeCorp"],
    ["workday", "https://example.com/WDAY/CXS/company/careers"],
    ["greenhouse", "https://boards.greenhouse.io:443/acmecorp"],
    ["lever", "http://jobs.lever.co/acmecorp"],
    ["ashby", "https://jobs.ashbyhq.com/acmecorp?sort=recent#top"],
    ["workable", "https://apply.workable.com/acmecorp/"],
  ])("detects %s from URL with case/structure variation: %s", (vendor, url) => {
    expect(detectAtsVendor(url)).toBe(vendor);
  });

  // -- Query parameter detection --------------------------------------------

  test.each<[string, string]>([
    ["greenhouse", "https://acmecorp.com/careers?gh_jid=4567890"],
    ["greenhouse", "https://acmecorp.com/careers?page=1&gh_jid=4567890"],
    ["greenhouse", "https://acmecorp.com/careers?GH_JID=4567890"],
    ["greenhouse", "https://example.com/apply?gh_jid=999"],
    ["greenhouse", "https://example.com/careers?gh_jid=1"],
    ["ashby", "https://acmecorp.com/careers?ashby_jid=abc123"],
    ["ashby", "https://acmecorp.com/careers?page=2&ashby_jid=abc123"],
    ["ashby", "https://example.com/apply?ashby_jid=xyz"],
  ])("detects %s from query param in %s", (vendor, url) => {
    expect(detectAtsVendor(url)).toBe(vendor);
  });

  // -- Query parameter false-positive guards --------------------------------

  test.each([
    ["xgh_jid (prefix)", "https://example.com/careers?xgh_jid=123"],
    ["not_ashby_jid (prefix)", "https://example.com/careers?not_ashby_jid=123"],
  ])("does not false-positive on %s", (_label, url) => {
    expect(detectAtsVendor(url)).toBe("unknown");
  });

  // -- Query params take precedence over host detection ---------------------

  test("gh_jid query param takes priority over host-based ashby detection", () => {
    expect(detectAtsVendor("https://ashbyhq.com/careers?gh_jid=1")).toBe("greenhouse");
  });

  test("ashby_jid query param takes priority over host-based workable detection", () => {
    expect(detectAtsVendor("https://workable.com/careers?ashby_jid=abc")).toBe("ashby");
  });

  // -- Unknown vendors ------------------------------------------------------

  test.each([
    ["generic company website", "https://acmecorp.com/careers"],
    ["indeed job board", "https://jobs.indeed.com/posting/12345"],
    ["linkedin job URL", "https://www.linkedin.com/jobs/view/12345"],
  ])("returns 'unknown' for %s", (_label, url) => {
    expect(detectAtsVendor(url)).toBe("unknown");
  });

  // -- Adversarial near-miss domains ----------------------------------------
  // TODO: detectAtsVendor uses host.includes() for domain matching, which
  // causes false positives on near-miss domains (e.g., lever.co.uk matches
  // "lever.co"). Should use endsWith() or exact hostname checks.

  describe("adversarial near-miss domains", () => {
    // TODO: All near-miss domains false-positive because detectAtsVendor uses
    // host.includes("greenhouse.io") etc. — any hostname containing the vendor
    // domain as a substring will match. Should use host.endsWith() or exact
    // hostname matching to prevent this class of false positives.
    test.each([
      ["notgreenhouse.io", "https://notgreenhouse.io/jobs", "greenhouse"],
      ["fakegreenhouse.io", "https://fakegreenhouse.io/jobs", "greenhouse"],
      ["greenhouse.io.evil.com", "https://greenhouse.io.evil.com/jobs", "greenhouse"],
      ["lever.co.uk", "https://lever.co.uk/jobs", "lever"],
      ["myashbyhq.com", "https://myashbyhq.com/jobs", "ashby"],
      ["not-breezy.hr", "https://not-breezy.hr/jobs", "breezy"],
    ])("false-positive: detects %s as vendor (known bug)", (_domain, url, vendor) => {
      expect(detectAtsVendor(url)).toBe(vendor);
    });
  });
});

// ---------------------------------------------------------------------------
// isAtsHost — thin wrapper over detectAtsVendor, keep tests minimal
// (principle #3: respect module boundaries)
// ---------------------------------------------------------------------------

describe("isAtsHost", () => {
  test("returns true for a recognized ATS URL", () => {
    expect(isAtsHost("https://boards.greenhouse.io/company")).toBe(true);
  });

  test.each([
    ["generic non-ATS URL", "https://example.com/careers"],
    ["empty string", ""],
    ["invalid URL", "not-a-url"],
  ])("returns false for %s", (_label, input) => {
    expect(isAtsHost(input)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isKnownAtsVendor
// ---------------------------------------------------------------------------

describe("isKnownAtsVendor", () => {
  test.each<[AtsVendor]>([
    ["greenhouse"],
    ["lever"],
    ["ashby"],
    ["workable"],
    ["smartrecruiters"],
    ["teamtailor"],
    ["personio"],
    ["workday"],
    ["bamboohr"],
    ["breezy"],
  ])("returns true for '%s'", (vendor) => {
    expect(isKnownAtsVendor(vendor)).toBe(true);
  });

  test.each<[AtsVendor]>([
    ["unknown"],
    ["custom"],
  ])("returns false for '%s'", (vendor) => {
    expect(isKnownAtsVendor(vendor)).toBe(false);
  });
});
