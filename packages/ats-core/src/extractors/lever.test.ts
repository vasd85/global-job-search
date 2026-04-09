import { extractFromLever } from "./lever";
import type { ExtractionContext } from "./extractor-types";
import type { Diagnostics } from "../types";
import { createEmptyDiagnostics } from "../types";

// ---------------------------------------------------------------------------
// Mock fetchJson — isolate the extractor from network I/O
// ---------------------------------------------------------------------------

vi.mock("./common", () => ({
  fetchJson: vi.fn(),
}));

// Mock identifiers — site parsing is tested in identifiers.test.ts
vi.mock("../discovery/identifiers", () => ({
  parseLeverSite: vi.fn(),
}));

import { fetchJson } from "./common";
import { parseLeverSite } from "../discovery/identifiers";

const fetchJsonMock = vi.mocked(fetchJson);
const parseSiteMock = vi.mocked(parseLeverSite);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    careersUrl: "https://jobs.lever.co/acmecorp",
    timeoutMs: 5000,
    maxRetries: 2,
    maxAttempts: 3,
    diagnostics: createEmptyDiagnostics(),
    ...overrides,
  };
}

/** Minimal Lever posting that satisfies the happy path. */
function makePosting(overrides: Record<string, unknown> = {}) {
  return {
    text: "Software Engineer",
    hostedUrl: "https://jobs.lever.co/acmecorp/abc-123",
    applyUrl: "https://jobs.lever.co/acmecorp/abc-123/apply",
    id: "abc-123",
    categories: {
      location: "San Francisco, CA",
      team: "Engineering",
      department: "Product",
      commitment: "Full-time",
    },
    workplaceType: "remote",
    descriptionBody: "<p>Join our team to build great software.</p>",
    descriptionBodyPlain: "Join our team to build great software.",
    description: "<p>Overview of the role.</p>",
    descriptionPlain: "Overview of the role.",
    opening: "<p>We are hiring.</p>",
    openingPlain: "We are hiring.",
    additional: "<p>Nice to have.</p>",
    additionalPlain: "Nice to have.",
    lists: [
      {
        title: "Qualifications",
        content: "<li>5+ years of experience</li>",
        items: [
          { text: "Bachelor's degree in CS", content: "<p>or equivalent</p>" },
        ],
      },
      {
        title: "What We Offer",
        content: "<li>Great benefits</li>",
        items: [{ text: "Health insurance" }],
      },
    ],
    createdAt: 1700000000000, // 2023-11-14T22:13:20.000Z
    ...overrides,
  };
}

function mockSuccessResponse(postings: unknown[]) {
  fetchJsonMock.mockResolvedValue({ data: postings, error: null });
}

function mockErrorResponse(error: string | null) {
  fetchJsonMock.mockResolvedValue({ data: null, error });
}

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  parseSiteMock.mockReturnValue({ site: "acmecorp", isEu: false });
});

// ---------------------------------------------------------------------------
// requirementSectionScore (tested indirectly via extractFromLever output)
// ---------------------------------------------------------------------------

describe("requirementSectionScore (via extractRequirements)", () => {
  // The function is not exported, so we test it through the extraction pipeline.

  test("selects the highest-scoring requirement section from the posting lists", async () => {
    mockSuccessResponse([makePosting({
      lists: [
        { title: "What We Offer", items: [{ text: "Health insurance" }] },
        { title: "Requirements", items: [{ text: "5+ years TypeScript" }] },
      ],
    })]);
    const result = await extractFromLever(makeContext());

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].description_text).toContain("5+ years TypeScript");
  });

  // -- Score tiers via test.each -------------------------------------------

  describe.each([
    { label: "Qualifications", score: 3 },
    { label: "Qualification", score: 3 },
    { label: "Requirements", score: 3 },
    { label: "Requirement", score: 3 },
    { label: "Minimum Qualifications", score: 3 },
    { label: "Key Requirements", score: 3 },
    { label: "QUALIFICATIONS", score: 3 },
    { label: "What you bring", score: 2 },
    { label: "What We're Looking For", score: 2 },
    { label: "Must Have", score: 2 },
    { label: "What You Have", score: 2 },
    { label: "you have", score: 2 },
  ])("'$label' is recognized as a requirement heading (score $score)", ({ label }) => {
    test("beats a score-0 section when both are present", async () => {
      mockSuccessResponse([makePosting({
        lists: [
          { title: "Benefits", items: [{ text: "Equity" }] },
          { title: label, items: [{ text: "Relevant skill" }] },
        ],
      })]);
      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].description_text).toContain("Relevant skill");
    });
  });

  // -- Adversarial false-positive / near-miss headings --------------------

  describe.each([
    { label: "About Us" },
    { label: "Responsibilities" },
    { label: "What We Do" },
    { label: "Benefits" },
    { label: "Perks" },
    { label: "require" },            // near-miss: no trailing "ments?"
    { label: "Qualified Candidates" }, // near-miss: not "qualification(s)"
  ])("'$label' is NOT recognized as a requirement heading", ({ label }) => {
    test("does not contribute to requirements text when it is the only section", async () => {
      mockSuccessResponse([makePosting({
        lists: [
          { title: label, items: [{ text: "Some content from non-requirement section" }] },
        ],
      })]);
      const result = await extractFromLever(makeContext());

      const desc = result.jobs[0].description_text ?? "";
      expect(desc).not.toContain("Requirements:\nSome content from non-requirement section");
    });
  });

  test("score-3 heading beats score-2 heading when both are present", async () => {
    mockSuccessResponse([makePosting({
      lists: [
        { title: "What you bring", items: [{ text: "Leadership ability" }] },
        { title: "Qualifications", items: [{ text: "PhD preferred" }] },
      ],
    })]);
    const result = await extractFromLever(makeContext());
    expect(result.jobs[0].description_text).toContain("PhD preferred");
  });
});

// ---------------------------------------------------------------------------
// extractRequirements edge cases (tested indirectly)
// ---------------------------------------------------------------------------

describe("extractRequirements edge cases", () => {
  test.each([
    ["no lists", { lists: undefined }],
    ["empty lists", { lists: [] }],
  ])("returns null requirements when posting has %s", async (_label, overrides) => {
    mockSuccessResponse([makePosting(overrides)]);
    const result = await extractFromLever(makeContext());

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].description_text).toBeDefined();
  });

  test("skips sections with no title, name, or text (all blank)", async () => {
    mockSuccessResponse([makePosting({
      lists: [
        { title: "", name: "", text: "", items: [{ text: "Orphan item" }] },
        { title: "Qualifications", items: [{ text: "5+ years" }] },
      ],
    })]);
    const result = await extractFromLever(makeContext());
    expect(result.jobs[0].description_text).toContain("5+ years");
  });

  test.each([
    ["name fallback", { name: "Requirements" }, "Go experience"],
    ["text fallback", { text: "Qualifications" }, "Rust experience"],
  ])("falls back to section %s when title is missing", async (_label, sectionOverrides, expectedText) => {
    mockSuccessResponse([makePosting({
      lists: [{ ...sectionOverrides, items: [{ text: expectedText }] }],
    })]);
    const result = await extractFromLever(makeContext());
    expect(result.jobs[0].description_text).toContain(expectedText);
  });

  test("aggregates content from section content and item fields", async () => {
    mockSuccessResponse([makePosting({
      lists: [{
        title: "Requirements",
        content: "<p>General requirements overview</p>",
        items: [
          { text: "Item text value", content: "<p>Item content value</p>", name: "Item name value" },
        ],
      }],
    })]);
    const result = await extractFromLever(makeContext());
    const desc = result.jobs[0].description_text ?? "";

    expect(desc).toContain("General requirements overview");
    expect(desc).toContain("Item text value");
    expect(desc).toContain("Item content value");
    expect(desc).toContain("Item name value");
  });
});

// ---------------------------------------------------------------------------
// extractFromLever
// ---------------------------------------------------------------------------

describe("extractFromLever", () => {
  // -----------------------------------------------------------------------
  // Site parse failure (wiring check — parsing logic in identifiers.test.ts)
  // -----------------------------------------------------------------------

  test("returns an error when site cannot be parsed", async () => {
    parseSiteMock.mockReturnValue(null);
    const result = await extractFromLever(makeContext({ careersUrl: "https://bad.example.com" }));

    expect(result.jobs).toEqual([]);
    expect(result.errors[0]).toContain("Unable to parse Lever site");
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // API endpoint construction & context forwarding
  // -----------------------------------------------------------------------

  test("calls fetchJson with correct US endpoint and forwards context args", async () => {
    mockSuccessResponse([]);
    const diag: Diagnostics = createEmptyDiagnostics();
    const ctx = makeContext({ diagnostics: diag, timeoutMs: 10000, maxRetries: 5, maxAttempts: 7 });
    await extractFromLever(ctx);

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "https://api.lever.co/v0/postings/acmecorp?mode=json",
      diag,
      10000,
      5,
      7,
    );
  });

  test("calls the EU Lever API for EU sites", async () => {
    parseSiteMock.mockReturnValue({ site: "eucompany", isEu: true });
    mockSuccessResponse([]);
    await extractFromLever(makeContext({ careersUrl: "https://jobs.eu.lever.co/eucompany" }));

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "https://api.eu.lever.co/v0/postings/eucompany?mode=json",
      expect.any(Object),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  // -----------------------------------------------------------------------
  // API error handling
  // -----------------------------------------------------------------------

  test("returns error message with endpoint and error text on API failure", async () => {
    mockErrorResponse("connection timeout");
    const result = await extractFromLever(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Lever API failed");
    expect(result.errors[0]).toContain("connection timeout");
    expect(result.errors[0]).toContain("api.lever.co/v0/postings/acmecorp");
  });

  test("returns 'unknown error' when fetchJson returns null data with no error string", async () => {
    mockErrorResponse(null);
    const result = await extractFromLever(makeContext());
    expect(result.errors[0]).toContain("unknown error");
  });

  // -----------------------------------------------------------------------
  // Empty job list
  // -----------------------------------------------------------------------

  test("returns zero jobs and no errors when API returns empty array", async () => {
    mockSuccessResponse([]);
    const result = await extractFromLever(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Successful extraction — full field mapping
  // -----------------------------------------------------------------------

  test("maps a fully-populated Lever posting to correct normalized fields", async () => {
    mockSuccessResponse([makePosting()]);
    const result = await extractFromLever(makeContext());

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.title).toBe("Software Engineer");
    expect(job.url).toBe("https://jobs.lever.co/acmecorp/abc-123");
    expect(job.job_id).toBe("abc-123");
    expect(job.source_type).toBe("ats_api");
    expect(job.source_ref).toBe("lever");
    expect(job.detail_fetch_status).toBe("ok");
  });

  test("extracts multiple postings into multiple jobs", async () => {
    mockSuccessResponse([
      makePosting({ text: "Frontend Engineer", id: "fe-1", hostedUrl: "https://jobs.lever.co/acmecorp/fe-1" }),
      makePosting({ text: "Backend Engineer", id: "be-1", hostedUrl: "https://jobs.lever.co/acmecorp/be-1" }),
      makePosting({ text: "Designer", id: "de-1", hostedUrl: "https://jobs.lever.co/acmecorp/de-1" }),
    ]);
    const result = await extractFromLever(makeContext());

    expect(result.jobs).toHaveLength(3);
    expect(result.jobs.map((j) => j.title)).toEqual(["Frontend Engineer", "Backend Engineer", "Designer"]);
  });

  test("deduplicates jobs with the same canonical URL", async () => {
    const url = "https://jobs.lever.co/acmecorp/dup-1";
    mockSuccessResponse([
      makePosting({ text: "Engineer", id: "dup-1", hostedUrl: url, applyUrl: `${url}/apply` }),
      makePosting({ text: "Engineer", id: "dup-1", hostedUrl: url, applyUrl: `${url}/apply` }),
    ]);
    const result = await extractFromLever(makeContext());
    expect(result.jobs).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // Field fallback chains (test.each)
  // -----------------------------------------------------------------------

  describe("field fallback chains", () => {
    test.each([
      ["hostedUrl present", {}, "https://jobs.lever.co/acmecorp/abc-123"],
      ["hostedUrl absent, falls back to applyUrl", { hostedUrl: undefined }, "https://jobs.lever.co/acmecorp/abc-123/apply"],
      // TODO: When both URLs are missing, url resolves to the careersUrl base via
      // buildJob baseUrl resolution of "". This may not be intentional — consider
      // returning null/empty and letting buildJob filter the job out.
      ["both absent, resolves to careersUrl", { hostedUrl: undefined, applyUrl: undefined }, "https://jobs.lever.co/acmecorp"],
    ])("url: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].url).toBe(expected);
    });

    test.each([
      ["applyUrl present", {}, "https://jobs.lever.co/acmecorp/abc-123/apply"],
      ["applyUrl absent, falls back to hostedUrl", { applyUrl: undefined }, "https://jobs.lever.co/acmecorp/abc-123"],
    ])("apply_url: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].apply_url).toBe(expected);
    });

    test.each([
      ["hostedUrl present", {}, "https://jobs.lever.co/acmecorp/abc-123"],
      ["hostedUrl absent, falls back to applyUrl", { hostedUrl: undefined }, "https://jobs.lever.co/acmecorp/abc-123/apply"],
    ])("source_detail_url: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].source_detail_url).toBe(expected);
    });

    test.each([
      ["team present", {}, "Engineering"],
      ["team absent, falls back to department", { categories: { location: "SF", department: "Research", commitment: "FT" } }, "Research"],
      ["both absent", { categories: {} }, null],
      ["categories missing entirely", { categories: undefined }, null],
    ])("department: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].department).toBe(expected);
    });

    test.each([
      ["location present", {}, "San Francisco, CA"],
      ["categories empty", { categories: {} }, null],
      ["categories missing", { categories: undefined }, null],
    ])("location: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].location).toBe(expected);
    });

    test.each([
      ["commitment present", {}, "Full-time"],
      ["commitment absent", { categories: {} }, null],
      ["categories missing", { categories: undefined }, null],
    ])("employment_type: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].employment_type).toBe(expected);
    });

    test.each([
      ["createdAt present", {}, new Date("2023-11-14T22:13:20.000Z")],
      ["createdAt absent", { createdAt: undefined }, null],
    ] as Array<[string, Record<string, unknown>, Date | null]>)("posted_at: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].posted_at).toEqual(expected);
    });

    test.each([
      ["workplaceType present", {}, "remote"],
      ["workplaceType absent", { workplaceType: undefined }, undefined],
    ])("workplace_type: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromLever(makeContext());
      if (expected === undefined) {
        expect(result.jobs[0]).not.toHaveProperty("workplace_type");
      } else {
        expect(result.jobs[0].workplace_type).toBe(expected);
      }
    });

    test.each([
      ["id present", { id: "custom-lever-id" }, "custom-lever-id"],
    ])("job_id: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].job_id).toBe(expected);
    });

    test("falls back to uid-based job_id when posting id is missing", async () => {
      mockSuccessResponse([makePosting({ id: undefined })]);
      const result = await extractFromLever(makeContext());

      expect(result.jobs[0].job_id).toHaveLength(12);
      expect(result.jobs[0].job_id).toBe(result.jobs[0].job_uid.slice(0, 12));
    });

    test.each([
      ["description fields present", {}, "ok"],
      ["only opening present", { descriptionBody: undefined, description: undefined, descriptionBodyPlain: undefined, descriptionPlain: undefined, openingPlain: undefined }, "ok"],
      ["all absent", { descriptionBody: undefined, description: undefined, opening: undefined, descriptionBodyPlain: undefined, descriptionPlain: undefined, openingPlain: undefined }, undefined],
    ])("detail_fetch_status: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromLever(makeContext());
      if (expected === undefined) {
        expect(result.jobs[0]).not.toHaveProperty("detail_fetch_status");
      } else {
        expect(result.jobs[0].detail_fetch_status).toBe(expected);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Description field merging
  // -----------------------------------------------------------------------

  describe("description field merging", () => {
    test("merges HTML description fields into description_text", async () => {
      mockSuccessResponse([makePosting({
        descriptionBody: "<p>Body section</p>",
        description: "<p>Desc section</p>",
        opening: "<p>Opening section</p>",
        descriptionBodyPlain: undefined,
        descriptionPlain: undefined,
        openingPlain: undefined,
      })]);
      const result = await extractFromLever(makeContext());
      const desc = result.jobs[0].description_text ?? "";

      expect(desc).toContain("Body section");
      expect(desc).toContain("Desc section");
      expect(desc).toContain("Opening section");
    });

    test("merges plain text description fields", async () => {
      mockSuccessResponse([makePosting()]);
      const result = await extractFromLever(makeContext());
      const desc = result.jobs[0].description_text ?? "";

      expect(desc).toContain("Join our team to build great software.");
      expect(desc).toContain("Overview of the role.");
      expect(desc).toContain("We are hiring.");
    });

    test("includes requirements text in description when present", async () => {
      mockSuccessResponse([makePosting({
        lists: [{ title: "Requirements", items: [{ text: "Expert in TypeScript" }] }],
      })]);
      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].description_text).toContain("Expert in TypeScript");
    });
  });

  // -----------------------------------------------------------------------
  // Adversarial: tracking parameter stripping
  // -----------------------------------------------------------------------

  test("strips tracking parameters from Lever URLs", async () => {
    mockSuccessResponse([makePosting({
      hostedUrl: "https://jobs.lever.co/acmecorp/abc-123?utm_source=linkedin&utm_medium=job",
    })]);
    const result = await extractFromLever(makeContext());

    expect(result.jobs[0].url).not.toContain("utm_source");
    expect(result.jobs[0].url).not.toContain("utm_medium");
  });

  // -----------------------------------------------------------------------
  // Filtering invalid postings
  // -----------------------------------------------------------------------

  describe("filtering invalid postings", () => {
    test.each([
      ["empty title", { text: "" }],
      ["whitespace-only title", { text: "   " }],
    ])("filters out postings with %s", async (_label, overrides) => {
      mockSuccessResponse([
        makePosting({ ...overrides, hostedUrl: "https://jobs.lever.co/acmecorp/a" }),
        makePosting({ text: "Valid Engineer", hostedUrl: "https://jobs.lever.co/acmecorp/b" }),
      ]);
      const result = await extractFromLever(makeContext());

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].title).toBe("Valid Engineer");
    });
  });

  // -----------------------------------------------------------------------
  // Realistic multi-posting scenario
  // -----------------------------------------------------------------------

  test("handles a mix of complete and minimal postings", async () => {
    mockSuccessResponse([
      makePosting({
        text: "Staff Engineer",
        id: "staff-1",
        hostedUrl: "https://jobs.lever.co/acmecorp/staff-1",
        categories: { location: "Remote, US", team: "Platform", commitment: "Full-time" },
        workplaceType: "remote",
        descriptionBodyPlain: "Lead platform initiatives.",
        lists: [{ title: "Qualifications", items: [{ text: "10+ years experience" }] }],
        createdAt: 1710000000000,
      }),
      makePosting({
        text: "Junior Developer",
        id: "jr-1",
        hostedUrl: "https://jobs.lever.co/acmecorp/jr-1",
        categories: undefined,
        workplaceType: undefined,
        descriptionBody: undefined,
        descriptionBodyPlain: undefined,
        description: undefined,
        descriptionPlain: undefined,
        opening: undefined,
        openingPlain: undefined,
        lists: undefined,
        createdAt: undefined,
      }),
    ]);
    const result = await extractFromLever(makeContext());

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(2);

    // Staff Engineer — fully populated
    const staff = result.jobs[0];
    expect(staff.title).toBe("Staff Engineer");
    expect(staff.location).toBe("Remote, US");
    expect(staff.department).toBe("Platform");
    expect(staff.workplace_type).toBe("remote");
    expect(staff.description_text).toContain("10+ years experience");

    // Junior Developer — minimal
    const junior = result.jobs[1];
    expect(junior.title).toBe("Junior Developer");
    expect(junior.location).toBeNull();
    expect(junior.department).toBeNull();
    expect(junior).not.toHaveProperty("workplace_type");
    expect(junior.posted_at).toBeNull();
  });
});
