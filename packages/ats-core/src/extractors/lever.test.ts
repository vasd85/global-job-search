import { extractFromLever } from "./lever";
import type { ExtractionContext } from "./extractor-types";
import type { Diagnostics } from "../types";
import { createEmptyDiagnostics } from "../types";

// ---------------------------------------------------------------------------
// Mock fetchJson — intercept at the ./common boundary
// ---------------------------------------------------------------------------

const fetchJsonMock = vi.fn();

vi.mock("./common", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

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

// ---------------------------------------------------------------------------
// Reset mocks between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  fetchJsonMock.mockReset();
});

// ---------------------------------------------------------------------------
// requirementSectionScore (tested indirectly via extractFromLever output)
// ---------------------------------------------------------------------------

describe("requirementSectionScore (via extractRequirements)", () => {
  // The function is not exported, so we test it through the extraction pipeline.
  // A section named "Qualifications" (score 3) should be selected over
  // "What We Offer" (score 0) when both are present.

  test("selects the highest-scoring requirement section from the posting lists", async () => {
    const posting = makePosting({
      lists: [
        {
          title: "What We Offer",
          items: [{ text: "Health insurance" }],
        },
        {
          title: "Requirements",
          items: [{ text: "5+ years TypeScript" }],
        },
      ],
    });
    fetchJsonMock.mockResolvedValue({ data: [posting], error: null });
    const result = await extractFromLever(makeContext());

    expect(result.jobs).toHaveLength(1);
    // The requirements text should come from the "Requirements" section
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
  ])("'$label' is recognized as a requirement heading (score $score)", ({ label, score }) => {
    test(`beats a score-0 section when both are present`, async () => {
      const posting = makePosting({
        lists: [
          { title: "Benefits", items: [{ text: "Equity" }] },
          { title: label, items: [{ text: "Relevant skill" }] },
        ],
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });
      const result = await extractFromLever(makeContext());

      expect(result.jobs[0].description_text).toContain("Relevant skill");
    });
  });

  // -- Adversarial false-positive / near-miss headings --------------------

  describe.each([
    { label: "About Us", shouldMatch: false },
    { label: "Responsibilities", shouldMatch: false },
    { label: "What We Do", shouldMatch: false },
    { label: "Benefits", shouldMatch: false },
    { label: "Perks", shouldMatch: false },
    // Near-miss: "require" alone (no trailing "ments?" match)
    { label: "require", shouldMatch: false },
    // Near-miss: "qualified" is not "qualification(s)"
    { label: "Qualified Candidates", shouldMatch: false },
  ])("'$label' is NOT recognized as a requirement heading", ({ label }) => {
    test("does not contribute to requirements text when it is the only section", async () => {
      const posting = makePosting({
        lists: [
          { title: label, items: [{ text: "Some content from non-requirement section" }] },
        ],
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });
      const result = await extractFromLever(makeContext());

      // The requirements text should NOT include content from a non-matching section.
      // However the description itself may contain the text through other fields;
      // we check specifically that the normalizer did not receive a requirementsText.
      // Since buildJob is not mocked, we verify the description does not contain
      // the string preceded by "Requirements:" label.
      const desc = result.jobs[0].description_text ?? "";
      expect(desc).not.toContain("Requirements:\nSome content from non-requirement section");
    });
  });

  test("score-3 heading beats score-2 heading when both are present", async () => {
    const posting = makePosting({
      lists: [
        { title: "What you bring", items: [{ text: "Leadership ability" }] },
        { title: "Qualifications", items: [{ text: "PhD preferred" }] },
      ],
    });
    fetchJsonMock.mockResolvedValue({ data: [posting], error: null });
    const result = await extractFromLever(makeContext());

    // "Qualifications" (score 3) text should appear in requirements,
    // but "What you bring" (score 2) text should not be the selected requirement section
    // Both may appear in description. The key check is that the requirements text
    // fed to buildJob is from the highest-scored section.
    expect(result.jobs[0].description_text).toContain("PhD preferred");
  });
});

// ---------------------------------------------------------------------------
// extractRequirements edge cases (tested indirectly)
// ---------------------------------------------------------------------------

describe("extractRequirements edge cases", () => {
  test("returns null requirements when posting has no lists", async () => {
    const posting = makePosting({ lists: undefined });
    fetchJsonMock.mockResolvedValue({ data: [posting], error: null });
    const result = await extractFromLever(makeContext());

    expect(result.jobs).toHaveLength(1);
    // Without requirements, description should still exist from other fields
    expect(result.jobs[0].description_text).toBeDefined();
  });

  test("returns null requirements when lists array is empty", async () => {
    const posting = makePosting({ lists: [] });
    fetchJsonMock.mockResolvedValue({ data: [posting], error: null });
    const result = await extractFromLever(makeContext());

    expect(result.jobs).toHaveLength(1);
  });

  test("skips sections with no title, name, or text (all blank)", async () => {
    const posting = makePosting({
      lists: [
        { title: "", name: "", text: "", items: [{ text: "Orphan item" }] },
        { title: "Qualifications", items: [{ text: "5+ years" }] },
      ],
    });
    fetchJsonMock.mockResolvedValue({ data: [posting], error: null });
    const result = await extractFromLever(makeContext());

    expect(result.jobs[0].description_text).toContain("5+ years");
  });

  test("falls back to section name when title is missing", async () => {
    const posting = makePosting({
      lists: [
        { name: "Requirements", items: [{ text: "Go experience" }] },
      ],
    });
    fetchJsonMock.mockResolvedValue({ data: [posting], error: null });
    const result = await extractFromLever(makeContext());

    expect(result.jobs[0].description_text).toContain("Go experience");
  });

  test("falls back to section text field when title and name are missing", async () => {
    const posting = makePosting({
      lists: [
        { text: "Qualifications", items: [{ text: "Rust experience" }] },
      ],
    });
    fetchJsonMock.mockResolvedValue({ data: [posting], error: null });
    const result = await extractFromLever(makeContext());

    expect(result.jobs[0].description_text).toContain("Rust experience");
  });

  test("aggregates content from section content and item fields", async () => {
    const posting = makePosting({
      lists: [
        {
          title: "Requirements",
          content: "<p>General requirements overview</p>",
          items: [
            { text: "Item text value", content: "<p>Item content value</p>", name: "Item name value" },
          ],
        },
      ],
    });
    fetchJsonMock.mockResolvedValue({ data: [posting], error: null });
    const result = await extractFromLever(makeContext());

    const desc = result.jobs[0].description_text ?? "";
    expect(desc).toContain("General requirements overview");
    expect(desc).toContain("Item text value");
    expect(desc).toContain("Item content value");
    expect(desc).toContain("Item name value");
  });
});

// ---------------------------------------------------------------------------
// extractFromLever — happy path
// ---------------------------------------------------------------------------

describe("extractFromLever", () => {
  describe("successful extraction", () => {
    test("returns normalized jobs from a valid Lever API response", async () => {
      const posting = makePosting();
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());

      expect(result.errors).toEqual([]);
      expect(result.jobs).toHaveLength(1);

      const job = result.jobs[0];
      expect(job.title).toBe("Software Engineer");
      expect(job.source_type).toBe("ats_api");
      expect(job.source_ref).toBe("lever");
    });

    test("maps hostedUrl to url and source_detail_url", async () => {
      const posting = makePosting();
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      const job = result.jobs[0];

      expect(job.url).toBe("https://jobs.lever.co/acmecorp/abc-123");
      expect(job.source_detail_url).toBe("https://jobs.lever.co/acmecorp/abc-123");
    });

    test("maps applyUrl to apply_url", async () => {
      const posting = makePosting();
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      const job = result.jobs[0];

      expect(job.apply_url).toBe("https://jobs.lever.co/acmecorp/abc-123/apply");
    });

    test("maps categories.location to location_raw", async () => {
      const posting = makePosting();
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].location_raw).toBe("San Francisco, CA");
    });

    test("maps categories.team to department_raw", async () => {
      const posting = makePosting();
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].department_raw).toBe("Engineering");
    });

    test("falls back to categories.department when team is absent", async () => {
      const posting = makePosting({
        categories: {
          location: "Berlin",
          department: "Research",
          commitment: "Full-time",
        },
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].department_raw).toBe("Research");
    });

    test("maps categories.commitment to employment_type_raw", async () => {
      const posting = makePosting();
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].employment_type_raw).toBe("Full-time");
    });

    test("maps workplaceType to workplace_type", async () => {
      const posting = makePosting();
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].workplace_type).toBe("remote");
    });

    test("converts createdAt timestamp to ISO date string", async () => {
      const posting = makePosting({ createdAt: 1700000000000 });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].posted_date_raw).toBe("2023-11-14T22:13:20.000Z");
    });

    test("uses posting id as job_id", async () => {
      const posting = makePosting({ id: "custom-lever-id" });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].job_id).toBe("custom-lever-id");
    });

    test("merges description fields into description_text", async () => {
      const posting = makePosting();
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      const desc = result.jobs[0].description_text ?? "";

      // descriptionBodyPlain, descriptionPlain, openingPlain all contribute
      expect(desc).toContain("Join our team to build great software.");
      expect(desc).toContain("Overview of the role.");
      expect(desc).toContain("We are hiring.");
    });

    test("sets detail_fetch_status to 'ok' when description content exists", async () => {
      const posting = makePosting();
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].detail_fetch_status).toBe("ok");
    });

    test("extracts multiple postings into multiple jobs", async () => {
      const postings = [
        makePosting({ text: "Frontend Engineer", id: "fe-1", hostedUrl: "https://jobs.lever.co/acmecorp/fe-1" }),
        makePosting({ text: "Backend Engineer", id: "be-1", hostedUrl: "https://jobs.lever.co/acmecorp/be-1" }),
        makePosting({ text: "Designer", id: "de-1", hostedUrl: "https://jobs.lever.co/acmecorp/de-1" }),
      ];
      fetchJsonMock.mockResolvedValue({ data: postings, error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs).toHaveLength(3);
      expect(result.jobs.map((j) => j.title)).toEqual([
        "Frontend Engineer",
        "Backend Engineer",
        "Designer",
      ]);
    });

    test("deduplicates jobs with the same canonical URL", async () => {
      const url = "https://jobs.lever.co/acmecorp/dup-1";
      const postings = [
        makePosting({ text: "Engineer", id: "dup-1", hostedUrl: url, applyUrl: `${url}/apply` }),
        makePosting({ text: "Engineer", id: "dup-1", hostedUrl: url, applyUrl: `${url}/apply` }),
      ];
      fetchJsonMock.mockResolvedValue({ data: postings, error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // API endpoint construction
  // -----------------------------------------------------------------------

  describe("API endpoint construction", () => {
    test("calls the US Lever API for jobs.lever.co URLs", async () => {
      fetchJsonMock.mockResolvedValue({ data: [], error: null });
      await extractFromLever(makeContext({ careersUrl: "https://jobs.lever.co/acmecorp" }));

      expect(fetchJsonMock).toHaveBeenCalledWith(
        "https://api.lever.co/v0/postings/acmecorp?mode=json",
        expect.any(Object),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });

    test("calls the EU Lever API for jobs.eu.lever.co URLs", async () => {
      fetchJsonMock.mockResolvedValue({ data: [], error: null });
      await extractFromLever(makeContext({ careersUrl: "https://jobs.eu.lever.co/eucompany" }));

      expect(fetchJsonMock).toHaveBeenCalledWith(
        "https://api.eu.lever.co/v0/postings/eucompany?mode=json",
        expect.any(Object),
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });

    // Adversarial: URL that looks like Lever but has no path segment
    test("does not call API for lever.co URL without path segment (no site)", async () => {
      fetchJsonMock.mockResolvedValue({ data: [], error: null });
      const result = await extractFromLever(makeContext({ careersUrl: "https://jobs.lever.co/" }));

      expect(fetchJsonMock).not.toHaveBeenCalled();
      expect(result.jobs).toEqual([]);
      expect(result.errors).toHaveLength(1);
    });

    // Adversarial: completely different domain
    test("does not call API for a non-lever domain", async () => {
      fetchJsonMock.mockResolvedValue({ data: [], error: null });
      const result = await extractFromLever(makeContext({ careersUrl: "https://not-lever.example.com/" }));

      expect(fetchJsonMock).not.toHaveBeenCalled();
      expect(result.jobs).toEqual([]);
      expect(result.errors).toHaveLength(1);
    });

    test("passes context parameters to fetchJson", async () => {
      const diagnostics = createEmptyDiagnostics();
      fetchJsonMock.mockResolvedValue({ data: [], error: null });

      await extractFromLever(makeContext({
        careersUrl: "https://jobs.lever.co/testco",
        timeoutMs: 10000,
        maxRetries: 5,
        maxAttempts: 7,
        diagnostics,
      }));

      expect(fetchJsonMock).toHaveBeenCalledWith(
        expect.any(String),
        diagnostics,
        10000,
        5,
        7,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Empty job list
  // -----------------------------------------------------------------------

  describe("empty job list", () => {
    test("returns empty jobs array and no errors when API returns empty array", async () => {
      fetchJsonMock.mockResolvedValue({ data: [], error: null });
      const result = await extractFromLever(makeContext());

      expect(result.jobs).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // API error handling
  // -----------------------------------------------------------------------

  describe("API error handling", () => {
    test("returns error message when fetchJson returns null data with error", async () => {
      fetchJsonMock.mockResolvedValue({ data: null, error: "connection timeout" });
      const result = await extractFromLever(makeContext());

      expect(result.jobs).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Lever API failed");
      expect(result.errors[0]).toContain("connection timeout");
    });

    test("returns 'unknown error' when fetchJson returns null data with no error message", async () => {
      fetchJsonMock.mockResolvedValue({ data: null, error: null });
      const result = await extractFromLever(makeContext());

      expect(result.jobs).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("unknown error");
    });

    test("includes the endpoint URL in the error message", async () => {
      fetchJsonMock.mockResolvedValue({ data: null, error: "404 not found" });
      const result = await extractFromLever(makeContext({ careersUrl: "https://jobs.lever.co/failcorp" }));

      expect(result.errors[0]).toContain("api.lever.co/v0/postings/failcorp");
    });

    test("returns parse error when careers URL is unparseable", async () => {
      const result = await extractFromLever(makeContext({ careersUrl: "not-a-url" }));

      expect(result.jobs).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Unable to parse Lever site");
    });
  });

  // -----------------------------------------------------------------------
  // Missing / null field handling
  // -----------------------------------------------------------------------

  describe("missing and null field handling", () => {
    test("uses applyUrl as url fallback when hostedUrl is missing", async () => {
      const posting = makePosting({
        hostedUrl: undefined,
        applyUrl: "https://jobs.lever.co/acmecorp/xyz/apply",
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].url).toBe("https://jobs.lever.co/acmecorp/xyz/apply");
    });

    test("uses hostedUrl as apply_url fallback when applyUrl is missing", async () => {
      const posting = makePosting({
        hostedUrl: "https://jobs.lever.co/acmecorp/xyz",
        applyUrl: undefined,
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].apply_url).toBe("https://jobs.lever.co/acmecorp/xyz");
    });

    test("uses empty string as url when both hostedUrl and applyUrl are missing", async () => {
      const posting = makePosting({
        hostedUrl: undefined,
        applyUrl: undefined,
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      // Empty string resolved against baseUrl yields the baseUrl root
      expect(result.jobs[0].url).toBe("https://jobs.lever.co/acmecorp");
    });

    test("sets location_raw to null when categories.location is missing", async () => {
      const posting = makePosting({ categories: {} });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].location_raw).toBeNull();
    });

    test("sets department_raw to null when both team and department are missing", async () => {
      const posting = makePosting({ categories: { location: "NYC" } });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].department_raw).toBeNull();
    });

    test("sets employment_type_raw to null when commitment is missing", async () => {
      const posting = makePosting({ categories: {} });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].employment_type_raw).toBeNull();
    });

    test("sets posted_date_raw to null when createdAt is missing", async () => {
      const posting = makePosting({ createdAt: undefined });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].posted_date_raw).toBeNull();
    });

    test("sets workplace_type absent when workplaceType is missing", async () => {
      const posting = makePosting({ workplaceType: undefined });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0]).not.toHaveProperty("workplace_type");
    });

    test("falls back to uid-based job_id when posting id is missing", async () => {
      const posting = makePosting({ id: undefined });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].job_id).toHaveLength(12);
      expect(result.jobs[0].job_id).toBe(result.jobs[0].job_uid.slice(0, 12));
    });

    test("sets categories to null fields when categories object is missing entirely", async () => {
      const posting = makePosting({ categories: undefined });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].location_raw).toBeNull();
      expect(result.jobs[0].department_raw).toBeNull();
      expect(result.jobs[0].employment_type_raw).toBeNull();
    });

    test("omits detail_fetch_status when no description fields are present", async () => {
      const posting = makePosting({
        descriptionBody: undefined,
        description: undefined,
        opening: undefined,
        descriptionBodyPlain: undefined,
        descriptionPlain: undefined,
        openingPlain: undefined,
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0]).not.toHaveProperty("detail_fetch_status");
    });

    test("sets detail_fetch_status to 'ok' when at least one description field exists", async () => {
      const posting = makePosting({
        descriptionBody: undefined,
        description: undefined,
        opening: "<p>Some opening text</p>",
        descriptionBodyPlain: undefined,
        descriptionPlain: undefined,
        openingPlain: undefined,
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].detail_fetch_status).toBe("ok");
    });
  });

  // -----------------------------------------------------------------------
  // Filtering null jobs (buildJob returns null for invalid entries)
  // -----------------------------------------------------------------------

  describe("filtering invalid postings", () => {
    test("filters out postings with empty title", async () => {
      const postings = [
        makePosting({ text: "", hostedUrl: "https://jobs.lever.co/acmecorp/a" }),
        makePosting({ text: "Valid Engineer", hostedUrl: "https://jobs.lever.co/acmecorp/b" }),
      ];
      fetchJsonMock.mockResolvedValue({ data: postings, error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].title).toBe("Valid Engineer");
    });

    test("filters out postings with whitespace-only title", async () => {
      const postings = [
        makePosting({ text: "   ", hostedUrl: "https://jobs.lever.co/acmecorp/a" }),
      ];
      fetchJsonMock.mockResolvedValue({ data: postings, error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs).toHaveLength(0);
      expect(result.errors).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // URL handling in field mapping
  // -----------------------------------------------------------------------

  describe("URL field mapping", () => {
    test("url prefers hostedUrl over applyUrl", async () => {
      const posting = makePosting({
        hostedUrl: "https://jobs.lever.co/acmecorp/hosted",
        applyUrl: "https://jobs.lever.co/acmecorp/apply",
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].url).toBe("https://jobs.lever.co/acmecorp/hosted");
    });

    test("apply_url prefers applyUrl over hostedUrl", async () => {
      const posting = makePosting({
        hostedUrl: "https://jobs.lever.co/acmecorp/hosted",
        applyUrl: "https://jobs.lever.co/acmecorp/apply",
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].apply_url).toBe("https://jobs.lever.co/acmecorp/apply");
    });

    test("source_detail_url prefers hostedUrl over applyUrl", async () => {
      const posting = makePosting({
        hostedUrl: "https://jobs.lever.co/acmecorp/hosted",
        applyUrl: "https://jobs.lever.co/acmecorp/apply",
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].source_detail_url).toBe("https://jobs.lever.co/acmecorp/hosted");
    });

    // Adversarial: URL with tracking parameters should be stripped by normalizeUrl
    test("strips tracking parameters from Lever URLs", async () => {
      const posting = makePosting({
        hostedUrl: "https://jobs.lever.co/acmecorp/abc-123?utm_source=linkedin&utm_medium=job",
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].url).not.toContain("utm_source");
      expect(result.jobs[0].url).not.toContain("utm_medium");
    });
  });

  // -----------------------------------------------------------------------
  // Description field merging
  // -----------------------------------------------------------------------

  describe("description field merging", () => {
    test("merges descriptionBody, description, and opening HTML into descriptionHtml", async () => {
      const posting = makePosting({
        descriptionBody: "<p>Body section</p>",
        description: "<p>Desc section</p>",
        opening: "<p>Opening section</p>",
        // Clear plain text fields so HTML path is used
        descriptionBodyPlain: undefined,
        descriptionPlain: undefined,
        openingPlain: undefined,
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      const desc = result.jobs[0].description_text ?? "";

      expect(desc).toContain("Body section");
      expect(desc).toContain("Desc section");
      expect(desc).toContain("Opening section");
    });

    test("merges plain text description fields", async () => {
      const posting = makePosting({
        descriptionBodyPlain: "Body plain",
        descriptionPlain: "Desc plain",
        openingPlain: "Opening plain",
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      const desc = result.jobs[0].description_text ?? "";

      expect(desc).toContain("Body plain");
      expect(desc).toContain("Desc plain");
      expect(desc).toContain("Opening plain");
    });

    test("includes requirements text in description when present", async () => {
      const posting = makePosting({
        lists: [
          { title: "Requirements", items: [{ text: "Expert in TypeScript" }] },
        ],
      });
      fetchJsonMock.mockResolvedValue({ data: [posting], error: null });

      const result = await extractFromLever(makeContext());
      expect(result.jobs[0].description_text).toContain("Expert in TypeScript");
    });
  });

  // -----------------------------------------------------------------------
  // Realistic multi-posting scenario
  // -----------------------------------------------------------------------

  describe("realistic multi-posting extraction", () => {
    test("handles a mix of complete and minimal postings", async () => {
      const postings = [
        makePosting({
          text: "Staff Engineer",
          id: "staff-1",
          hostedUrl: "https://jobs.lever.co/acmecorp/staff-1",
          categories: { location: "Remote, US", team: "Platform", commitment: "Full-time" },
          workplaceType: "remote",
          descriptionBodyPlain: "Lead platform initiatives.",
          lists: [
            { title: "Qualifications", items: [{ text: "10+ years experience" }] },
          ],
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
      ];
      fetchJsonMock.mockResolvedValue({ data: postings, error: null });

      const result = await extractFromLever(makeContext());

      expect(result.errors).toEqual([]);
      expect(result.jobs).toHaveLength(2);

      // Staff Engineer — fully populated
      const staff = result.jobs[0];
      expect(staff.title).toBe("Staff Engineer");
      expect(staff.location_raw).toBe("Remote, US");
      expect(staff.department_raw).toBe("Platform");
      expect(staff.employment_type_raw).toBe("Full-time");
      expect(staff.workplace_type).toBe("remote");
      expect(staff.description_text).toContain("Lead platform initiatives.");
      expect(staff.description_text).toContain("10+ years experience");
      expect(staff.posted_date_raw).toBeTruthy();

      // Junior Developer — minimal
      const junior = result.jobs[1];
      expect(junior.title).toBe("Junior Developer");
      expect(junior.location_raw).toBeNull();
      expect(junior.department_raw).toBeNull();
      expect(junior.employment_type_raw).toBeNull();
      expect(junior).not.toHaveProperty("workplace_type");
      expect(junior.posted_date_raw).toBeNull();
    });
  });
});
