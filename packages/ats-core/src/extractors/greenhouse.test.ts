import { extractFromGreenhouse } from "./greenhouse";
import type { ExtractionContext } from "./extractor-types";
import { createEmptyDiagnostics } from "../types";
import type { Diagnostics } from "../types";

// ---------------------------------------------------------------------------
// Mock fetchJson — isolate the extractor from network I/O
// ---------------------------------------------------------------------------

vi.mock("./common", () => ({
  fetchJson: vi.fn(),
}));

// Mock identifiers — token parsing is tested in identifiers.test.ts
vi.mock("../discovery/identifiers", () => ({
  parseGreenhouseBoardToken: vi.fn(),
}));

import { fetchJson } from "./common";
import { parseGreenhouseBoardToken } from "../discovery/identifiers";

const fetchJsonMock = vi.mocked(fetchJson);
const parseTokenMock = vi.mocked(parseGreenhouseBoardToken);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    careersUrl: "https://boards.greenhouse.io/acmecorp",
    timeoutMs: 5000,
    maxRetries: 2,
    diagnostics: createEmptyDiagnostics(),
    ...overrides,
  };
}

function makeGreenhouseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 4012345,
    title: "Senior Software Engineer",
    absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/4012345",
    location: { name: "San Francisco, CA" },
    content: "<p>We are looking for a Senior Software Engineer to join our platform team.</p>",
    first_published: "2025-11-01T12:00:00Z",
    updated_at: "2025-12-15T12:30:00Z",
    departments: [{ name: "Engineering" }, { name: "Platform" }],
    offices: [{ name: "San Francisco" }],
    ...overrides,
  };
}

function mockSuccessResponse(jobs: unknown[]) {
  fetchJsonMock.mockResolvedValue({ data: { jobs }, error: null });
}

function mockErrorResponse(error: string) {
  fetchJsonMock.mockResolvedValue({ data: null, error });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  parseTokenMock.mockReturnValue("acmecorp");
});

describe("extractFromGreenhouse", () => {
  // -------------------------------------------------------------------------
  // Board token parse failure (wiring check — parsing logic in identifiers.test.ts)
  // -------------------------------------------------------------------------

  test("returns an error when board token cannot be parsed", async () => {
    parseTokenMock.mockReturnValue(null);
    const ctx = makeContext({ careersUrl: "https://bad.example.com" });
    const result = await extractFromGreenhouse(ctx);

    expect(result.jobs).toEqual([]);
    expect(result.errors[0]).toContain("Unable to parse Greenhouse board token");
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // API endpoint construction & context forwarding
  // -------------------------------------------------------------------------

  test("calls fetchJson with correct endpoint and forwards context args", async () => {
    mockSuccessResponse([]);
    const diag: Diagnostics = createEmptyDiagnostics();
    const ctx = makeContext({ diagnostics: diag, timeoutMs: 10000, maxRetries: 3, maxAttempts: 5 });
    await extractFromGreenhouse(ctx);

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "https://boards-api.greenhouse.io/v1/boards/acmecorp/jobs?content=true",
      diag,
      10000,
      3,
      5,
    );
  });

  test("passes undefined for maxAttempts when not provided in context", async () => {
    mockSuccessResponse([]);
    await extractFromGreenhouse(makeContext());

    const call = fetchJsonMock.mock.calls[0];
    expect(call[4]).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // API error handling
  // -------------------------------------------------------------------------

  test("returns error message with endpoint and error text on API failure", async () => {
    mockErrorResponse("network timeout");
    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Greenhouse API failed");
    expect(result.errors[0]).toContain("network timeout");
    expect(result.errors[0]).toContain("boards-api.greenhouse.io");
  });

  test("returns 'unknown error' when fetchJson returns null data with no error string", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, error: null });
    const result = await extractFromGreenhouse(makeContext());

    expect(result.errors[0]).toContain("unknown error");
  });

  // -------------------------------------------------------------------------
  // Empty job list
  // -------------------------------------------------------------------------

  test.each([
    ["empty array", { jobs: [] }],
    ["missing jobs property", {}],
    ["null jobs property", { jobs: null }],
  ])("returns zero jobs and no errors when API returns %s", async (_label, data) => {
    fetchJsonMock.mockResolvedValue({ data, error: null });
    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Successful extraction — full field mapping
  // -------------------------------------------------------------------------

  test("maps a fully-populated Greenhouse job to correct normalized fields", async () => {
    mockSuccessResponse([makeGreenhouseJob()]);
    const result = await extractFromGreenhouse(makeContext());

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.title).toBe("Senior Software Engineer");
    expect(job.url).toBe("https://boards.greenhouse.io/acmecorp/jobs/4012345");
    expect(job.job_id).toBe("4012345");
    expect(job.location_raw).toBe("San Francisco, CA");
    expect(job.department_raw).toBe("Engineering, Platform");
    expect(job.posted_date_raw).toBe("2025-11-01T12:00:00Z");
    expect(job.source_type).toBe("ats_api");
    expect(job.source_ref).toBe("greenhouse");
    expect(job.detail_fetch_status).toBe("ok");
  });

  test("maps absolute_url to url, apply_url, and source_detail_url", async () => {
    mockSuccessResponse([makeGreenhouseJob()]);
    const result = await extractFromGreenhouse(makeContext());
    const job = result.jobs[0];

    expect(job.url).toBe("https://boards.greenhouse.io/acmecorp/jobs/4012345");
    expect(job.apply_url).toBe("https://boards.greenhouse.io/acmecorp/jobs/4012345");
    expect(job.source_detail_url).toBe("https://boards.greenhouse.io/acmecorp/jobs/4012345");
  });

  test("extracts multiple jobs from a single API response", async () => {
    mockSuccessResponse([
      makeGreenhouseJob({ id: 100, title: "Engineer", absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/100" }),
      makeGreenhouseJob({ id: 200, title: "Designer", absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/200" }),
    ]);
    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map((j) => j.title)).toEqual(["Engineer", "Designer"]);
  });

  // -------------------------------------------------------------------------
  // Field fallback chains (test.each)
  // -------------------------------------------------------------------------

  describe("field fallback chains", () => {
    test.each([
      ["first_published present", {}, "2025-11-01T12:00:00Z"],
      ["first_published absent, falls back to updated_at", { first_published: undefined }, "2025-12-15T12:30:00Z"],
      ["both absent", { first_published: undefined, updated_at: undefined }, null],
    ])("posted_date_raw: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makeGreenhouseJob(overrides)]);
      const result = await extractFromGreenhouse(makeContext());
      expect(result.jobs[0].posted_date_raw).toBe(expected);
    });

    test.each([
      ["location present", {}, "San Francisco, CA"],
      ["null location name", { location: { name: undefined } }, null],
      ["missing location object", { location: undefined }, null],
      ["empty location name", { location: { name: "" } }, null],
    ])("location_raw: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makeGreenhouseJob(overrides)]);
      const result = await extractFromGreenhouse(makeContext());
      expect(result.jobs[0].location_raw).toBe(expected);
    });

    test.each([
      ["multiple departments joined", { departments: [{ name: "Engineering" }, { name: "Infrastructure" }, { name: "SRE" }] }, "Engineering, Infrastructure, SRE"],
      ["filters out falsy department names", { departments: [{ name: "Engineering" }, { name: undefined }, { name: "" }, { name: "DevOps" }] }, "Engineering, DevOps"],
      ["both departments and offices missing", { departments: undefined, offices: undefined }, null],
    ])("department_raw: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makeGreenhouseJob(overrides)]);
      const result = await extractFromGreenhouse(makeContext());
      expect(result.jobs[0].department_raw).toBe(expected);
    });

    // TODO: The current implementation uses `??` (nullish coalescing) between
    // departments.join() and offices.join(). Since [].join() returns "" (falsy
    // but not nullish), `??` will NOT fall back to offices when departments is
    // empty. department_raw ends up as null (via normalizeText).
    // `.filter(Boolean).join(", ") || null` would be more correct to ensure
    // fallback to offices when departments is empty.
    test("does not fall back to offices when departments array is empty", async () => {
      mockSuccessResponse([makeGreenhouseJob({
        departments: [],
        offices: [{ name: "Berlin" }, { name: "London" }],
      })]);
      const result = await extractFromGreenhouse(makeContext());
      expect(result.jobs[0].department_raw).toBeNull();
    });

    test.each([
      ["content present", { content: "<p>Some content</p>" }, "ok"],
      ["content absent", { content: undefined }, undefined],
    ])("detail_fetch_status: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makeGreenhouseJob(overrides)]);
      const result = await extractFromGreenhouse(makeContext());
      if (expected === undefined) {
        expect(result.jobs[0]).not.toHaveProperty("detail_fetch_status");
      } else {
        expect(result.jobs[0].detail_fetch_status).toBe(expected);
      }
    });

    test("converts HTML content to plain text in description_text", async () => {
      mockSuccessResponse([makeGreenhouseJob({
        content: "<h2>About the Role</h2><p>Build <strong>amazing</strong> things.</p>",
      })]);
      const result = await extractFromGreenhouse(makeContext());
      const job = result.jobs[0];

      expect(job.description_text).toContain("About the Role");
      expect(job.description_text).toContain("amazing");
      expect(job.description_text).not.toContain("<h2>");
      expect(job.description_text).not.toContain("<strong>");
    });

    test("omits description_text when content is missing", async () => {
      mockSuccessResponse([makeGreenhouseJob({ content: undefined })]);
      const result = await extractFromGreenhouse(makeContext());
      expect(result.jobs[0]).not.toHaveProperty("description_text");
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  test("handles a job where all optional fields are undefined", async () => {
    mockSuccessResponse([{
      id: 999,
      title: "QA Analyst",
      absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/999",
    }]);
    const result = await extractFromGreenhouse(makeContext());

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("QA Analyst");
    expect(result.jobs[0].location_raw).toBeNull();
    expect(result.jobs[0].department_raw).toBeNull();
    expect(result.jobs[0].posted_date_raw).toBeNull();
  });
});
