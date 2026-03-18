import { extractFromSmartRecruiters } from "./smartrecruiters";
import type { ExtractionContext } from "./extractor-types";
import { createEmptyDiagnostics } from "../types";
import type { Diagnostics } from "../types";

// ---------------------------------------------------------------------------
// Mock fetchJson — isolate the extractor from network I/O
// ---------------------------------------------------------------------------

vi.mock("./common", () => ({
  fetchJson: vi.fn(),
}));

// Mock identifiers — company parsing is tested in identifiers.test.ts
vi.mock("../discovery/identifiers", () => ({
  parseSmartRecruitersCompanyFromCareersUrl: vi.fn(),
}));

import { fetchJson } from "./common";
import { parseSmartRecruitersCompanyFromCareersUrl } from "../discovery/identifiers";

const fetchJsonMock = vi.mocked(fetchJson);
const parseCompanyMock = vi.mocked(parseSmartRecruitersCompanyFromCareersUrl);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    careersUrl: "https://jobs.smartrecruiters.com/AcmeCorp",
    timeoutMs: 5000,
    maxRetries: 2,
    diagnostics: createEmptyDiagnostics(),
    ...overrides,
  };
}

function makePosting(overrides: Record<string, unknown> = {}) {
  return {
    id: "743999987654321",
    name: "Senior Software Engineer",
    releasedDate: "2026-01-15T12:00:00.000Z",
    location: {
      city: "Berlin",
      region: "Berlin",
      country: "Germany",
    },
    department: { label: "Engineering" },
    typeOfEmployment: { label: "Full-time" },
    ...overrides,
  };
}

function mockSuccessResponse(content: unknown[]) {
  fetchJsonMock.mockResolvedValue({ data: { content }, error: null });
}

function mockErrorResponse(error: string) {
  fetchJsonMock.mockResolvedValue({ data: null, error });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  parseCompanyMock.mockReturnValue("AcmeCorp");
});

describe("extractFromSmartRecruiters", () => {
  // -------------------------------------------------------------------------
  // Company parse failure (wiring check — parsing logic in identifiers.test.ts)
  // -------------------------------------------------------------------------

  test("returns an error when company identifier cannot be parsed", async () => {
    parseCompanyMock.mockReturnValue(null);
    const ctx = makeContext({ careersUrl: "https://bad.example.com" });
    const result = await extractFromSmartRecruiters(ctx);

    expect(result.jobs).toEqual([]);
    expect(result.errors[0]).toContain("Unable to parse SmartRecruiters company identifier");
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // API endpoint construction & context forwarding
  // -------------------------------------------------------------------------

  test("calls fetchJson with correct endpoint and forwards context args", async () => {
    mockSuccessResponse([]);
    const diag: Diagnostics = createEmptyDiagnostics();
    const ctx = makeContext({ diagnostics: diag, timeoutMs: 10000, maxRetries: 3, maxAttempts: 5 });
    await extractFromSmartRecruiters(ctx);

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "https://api.smartrecruiters.com/v1/companies/AcmeCorp/postings",
      diag,
      10000,
      3,
      5,
    );
  });

  test("passes undefined for maxAttempts when not provided in context", async () => {
    mockSuccessResponse([]);
    await extractFromSmartRecruiters(makeContext());

    const call = fetchJsonMock.mock.calls[0];
    expect(call[4]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // API error handling
  // -------------------------------------------------------------------------

  test("returns error message with endpoint and error text on API failure", async () => {
    mockErrorResponse("Connection timeout");
    const result = await extractFromSmartRecruiters(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("SmartRecruiters API failed");
    expect(result.errors[0]).toContain("Connection timeout");
    expect(result.errors[0]).toContain("api.smartrecruiters.com");
  });

  test("returns 'unknown error' when fetchJson returns null data with no error string", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, error: null });
    const result = await extractFromSmartRecruiters(makeContext());

    expect(result.errors[0]).toContain("unknown error");
  });

  // -------------------------------------------------------------------------
  // Empty job list
  // -------------------------------------------------------------------------

  test.each([
    ["empty array", { content: [] }],
    ["missing content property", {}],
    ["null content property", { content: null }],
  ])("returns zero jobs and no errors when API returns %s", async (_label, data) => {
    fetchJsonMock.mockResolvedValue({ data, error: null });
    const result = await extractFromSmartRecruiters(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Successful extraction — full field mapping
  // -------------------------------------------------------------------------

  test("maps a fully-populated posting to correct normalized fields", async () => {
    mockSuccessResponse([makePosting()]);
    const result = await extractFromSmartRecruiters(makeContext());

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.title).toBe("Senior Software Engineer");
    expect(job.location_raw).toBe("Berlin, Berlin, Germany");
    expect(job.department_raw).toBe("Engineering");
    expect(job.employment_type_raw).toBe("Full-time");
    expect(job.posted_date_raw).toBe("2026-01-15T12:00:00.000Z");
    expect(job.source_type).toBe("ats_api");
    expect(job.source_ref).toBe("smartrecruiters");
    expect(job.job_id).toBe("743999987654321");
  });

  test("extracts multiple jobs from a single API response", async () => {
    mockSuccessResponse([
      makePosting({ id: "job-1", name: "Frontend Engineer" }),
      makePosting({ id: "job-2", name: "Backend Engineer" }),
    ]);
    const result = await extractFromSmartRecruiters(makeContext());

    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map((j) => j.title)).toEqual(["Frontend Engineer", "Backend Engineer"]);
  });

  // -------------------------------------------------------------------------
  // Field fallback chains (test.each)
  // -------------------------------------------------------------------------

  describe("field fallback chains", () => {
    test.each([
      ["ref is full HTTPS URL", { ref: "https://custom.example.com/apply/123" }, "https://custom.example.com/apply/123"],
      ["ref is HTTP URL with mixed case", { ref: "HTTP://Custom.Example.COM/job/99" }, "http://custom.example.com/job/99"],
      ["ref absent, constructs from company + id", { ref: undefined, id: "abc-123" }, "https://jobs.smartrecruiters.com/AcmeCorp/abc-123"],
      ["ref is non-URL string, falls through to id", { ref: "not-a-url", id: "posting-789" }, "https://jobs.smartrecruiters.com/AcmeCorp/posting-789"],
      ["both ref and id absent, falls back to careersUrl", { ref: undefined, id: undefined }, "https://jobs.smartrecruiters.com/AcmeCorp"],
      // Adversarial: ref without protocol scheme (principle #2)
      ["ref without protocol, falls through to id", { ref: "jobs.smartrecruiters.com/AcmeCorp/999", id: "id-fallback" }, "https://jobs.smartrecruiters.com/AcmeCorp/id-fallback"],
      // Adversarial: ftp:// should not match http/https check (principle #2)
      ["ref with ftp:// protocol, falls through to id", { ref: "ftp://files.example.com/job", id: "id-ftp" }, "https://jobs.smartrecruiters.com/AcmeCorp/id-ftp"],
    ])("url: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromSmartRecruiters(makeContext());
      expect(result.jobs[0].url).toBe(expected);
    });

    test.each([
      ["all parts present", { location: { city: "Berlin", region: "Berlin", country: "Germany" } }, "Berlin, Berlin, Germany"],
      ["city and country only", { location: { city: "London", country: "United Kingdom" } }, "London, United Kingdom"],
      ["country only", { location: { country: "France" } }, "France"],
      ["city only", { location: { city: "Tokyo" } }, "Tokyo"],
      ["region and country only", { location: { region: "California", country: "US" } }, "California, US"],
      ["location undefined", { location: undefined }, null],
      ["location empty object", { location: {} }, null],
    ])("location_raw: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromSmartRecruiters(makeContext());
      expect(result.jobs[0].location_raw).toBe(expected);
    });

    test.each([
      ["present", {}, "Engineering"],
      ["absent", { department: undefined }, null],
    ])("department_raw: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromSmartRecruiters(makeContext());
      expect(result.jobs[0].department_raw).toBe(expected);
    });

    test.each([
      ["present", {}, "Full-time"],
      ["absent", { typeOfEmployment: undefined }, null],
    ])("employment_type_raw: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromSmartRecruiters(makeContext());
      expect(result.jobs[0].employment_type_raw).toBe(expected);
    });

    test.each([
      ["present", {}, "2026-01-15T12:00:00.000Z"],
      ["absent", { releasedDate: undefined }, null],
    ])("posted_date_raw: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromSmartRecruiters(makeContext());
      expect(result.jobs[0].posted_date_raw).toBe(expected);
    });

    test.each([
      ["from posting.id", { id: "743999987654321" }, "743999987654321"],
    ])("job_id: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makePosting(overrides)]);
      const result = await extractFromSmartRecruiters(makeContext());
      expect(result.jobs[0].job_id).toBe(expected);
    });

    test("job_id falls back to uid prefix when posting.id is absent", async () => {
      mockSuccessResponse([makePosting({ id: undefined })]);
      const result = await extractFromSmartRecruiters(makeContext());
      const job = result.jobs[0];
      expect(job.job_id).toBe(job.job_uid.slice(0, 12));
    });

    test("source_detail_url constructed from company and posting id", async () => {
      mockSuccessResponse([makePosting({ id: "743999987654321" })]);
      const result = await extractFromSmartRecruiters(makeContext());
      expect(result.jobs[0].source_detail_url).toBe(
        "https://api.smartrecruiters.com/v1/companies/AcmeCorp/postings/743999987654321"
      );
    });

    // TODO: buildDetailUrl returns null for missing id, but the extractor passes
    // this null into buildJob which uses `?? ""` fallback, resolving to baseUrl
    // via normalizeUrl. The detail URL for a job with no id shouldn't resolve to
    // the careers page URL — this may be unintended.
    test("source_detail_url when posting id is absent", async () => {
      mockSuccessResponse([makePosting({ id: undefined })]);
      const result = await extractFromSmartRecruiters(makeContext());
      expect(result.jobs[0]).toHaveProperty("source_detail_url");
    });
  });

  // -------------------------------------------------------------------------
  // Filters out invalid postings
  // -------------------------------------------------------------------------

  test("filters out postings with missing or empty name", async () => {
    mockSuccessResponse([
      makePosting({ id: "valid-1", name: "Valid Job" }),
      makePosting({ id: "invalid-1", name: "" }),
      makePosting({ id: "invalid-2", name: undefined }),
      makePosting({ id: "valid-2", name: "Another Valid Job" }),
    ]);
    const result = await extractFromSmartRecruiters(makeContext());

    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map((j) => j.title)).toEqual(["Valid Job", "Another Valid Job"]);
  });
});
