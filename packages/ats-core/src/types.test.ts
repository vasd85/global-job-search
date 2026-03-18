import { createEmptyDiagnostics, ATS_VENDORS, DETAIL_FETCH_STATUSES } from "./types";

describe("createEmptyDiagnostics", () => {
  test("returns a Diagnostics object with all fields at zero/empty state", () => {
    const d = createEmptyDiagnostics();

    expect(d).toEqual({
      attempted_urls: [],
      search_queries: [],
      last_reachable_url: null,
      attempts: 0,
      http_status: null,
      errors: [],
      notes: [],
    });
  });

  test("returns independent objects on each call (no shared references)", () => {
    const a = createEmptyDiagnostics();
    const b = createEmptyDiagnostics();

    expect(a).not.toBe(b);
    expect(a.attempted_urls).not.toBe(b.attempted_urls);
    expect(a.errors).not.toBe(b.errors);

    a.attempted_urls.push("https://example.com");
    a.attempts = 5;

    expect(b.attempted_urls).toHaveLength(0);
    expect(b.attempts).toBe(0);
  });
});

describe("ATS_VENDORS", () => {
  test("contains exactly the expected vendor set", () => {
    expect(ATS_VENDORS).toEqual([
      "greenhouse", "lever", "ashby", "workable", "smartrecruiters",
      "teamtailor", "personio", "workday", "bamboohr", "breezy",
      "custom", "unknown",
    ]);
  });

  test.each(ATS_VENDORS.map((v) => [v]))(
    "includes vendor %s",
    (vendor) => {
      expect(ATS_VENDORS).toContain(vendor);
    },
  );
});

describe("DETAIL_FETCH_STATUSES", () => {
  test("contains exactly the expected status set", () => {
    expect(DETAIL_FETCH_STATUSES).toEqual(["ok", "failed", "not_supported"]);
  });

  test.each(DETAIL_FETCH_STATUSES.map((s) => [s]))(
    "includes status %s",
    (status) => {
      expect(DETAIL_FETCH_STATUSES).toContain(status);
    },
  );
});
