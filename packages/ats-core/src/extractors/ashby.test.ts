import { extractFromAshby } from "./ashby";
import type { ExtractionContext } from "./extractor-types";
import { createEmptyDiagnostics } from "../types";
import type { Diagnostics } from "../types";

// ---------------------------------------------------------------------------
// Mock fetchJson — isolate the extractor from network I/O
// ---------------------------------------------------------------------------

vi.mock("./common", () => ({
  fetchJson: vi.fn(),
}));

// Mock identifiers — board parsing is tested in identifiers.test.ts
vi.mock("../discovery/identifiers", () => ({
  parseAshbyBoard: vi.fn(),
}));

import { fetchJson } from "./common";
import { parseAshbyBoard } from "../discovery/identifiers";

const fetchJsonMock = vi.mocked(fetchJson);
const parseBoardMock = vi.mocked(parseAshbyBoard);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ExtractionContext> = {}): ExtractionContext {
  return {
    careersUrl: "https://jobs.ashbyhq.com/acmecorp",
    timeoutMs: 5000,
    maxRetries: 2,
    maxAttempts: 3,
    diagnostics: createEmptyDiagnostics(),
    ...overrides,
  };
}

function makeAshbyJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-abc-123",
    title: "Senior Software Engineer",
    jobUrl: "https://jobs.ashbyhq.com/acmecorp/job-abc-123",
    applyUrl: "https://jobs.ashbyhq.com/acmecorp/job-abc-123/application",
    location: "San Francisco, CA",
    secondaryLocations: [
      { location: "New York, NY", title: "NYC Office" },
      { location: "Remote, US", title: "Remote" },
    ],
    departmentName: "Engineering",
    department: "Eng",
    team: "Platform",
    workplaceType: "Hybrid",
    descriptionHtml: "<p>We are looking for a talented engineer.</p>",
    descriptionPlain: "We are looking for a talented engineer.",
    publishedDate: "2025-11-01",
    publishedAt: "2025-11-01T12:00:00Z",
    employmentType: "FullTime",
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
  parseBoardMock.mockReturnValue("acmecorp");
});

describe("extractFromAshby", () => {
  // -------------------------------------------------------------------------
  // Board parse failure (wiring check — parsing logic is in identifiers.test.ts)
  // -------------------------------------------------------------------------

  test("returns an error when board cannot be parsed", async () => {
    parseBoardMock.mockReturnValue(null);
    const ctx = makeContext({ careersUrl: "https://bad.example.com" });
    const result = await extractFromAshby(ctx);

    expect(result.jobs).toEqual([]);
    expect(result.errors[0]).toContain("Unable to parse Ashby board");
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // API endpoint construction & context forwarding
  // -------------------------------------------------------------------------

  test("calls fetchJson with correct endpoint and forwards context args", async () => {
    mockSuccessResponse([]);
    const diag: Diagnostics = createEmptyDiagnostics();
    const ctx = makeContext({ diagnostics: diag, timeoutMs: 9999, maxRetries: 5, maxAttempts: 7 });
    await extractFromAshby(ctx);

    expect(fetchJsonMock).toHaveBeenCalledWith(
      "https://api.ashbyhq.com/posting-api/job-board/acmecorp",
      diag,
      9999,
      5,
      7,
    );
  });

  // -------------------------------------------------------------------------
  // API error handling
  // -------------------------------------------------------------------------

  test("returns error message with endpoint and error text on API failure", async () => {
    mockErrorResponse("connection timeout");
    const result = await extractFromAshby(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Ashby API failed");
    expect(result.errors[0]).toContain("connection timeout");
  });

  test("returns 'unknown error' when fetchJson returns null data with no error string", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, error: null });
    const result = await extractFromAshby(makeContext());

    expect(result.errors[0]).toContain("unknown error");
  });

  // -------------------------------------------------------------------------
  // Empty job list
  // -------------------------------------------------------------------------

  test("returns zero jobs and no errors when API returns empty list", async () => {
    mockSuccessResponse([]);
    const result = await extractFromAshby(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("returns zero jobs when jobs field is undefined in response", async () => {
    fetchJsonMock.mockResolvedValue({ data: {}, error: null });
    const result = await extractFromAshby(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Successful extraction — full field mapping
  // -------------------------------------------------------------------------

  test("maps a fully-populated Ashby job to correct normalized fields", async () => {
    mockSuccessResponse([makeAshbyJob()]);
    const result = await extractFromAshby(makeContext());

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.title).toBe("Senior Software Engineer");
    expect(job.url).toBe("https://jobs.ashbyhq.com/acmecorp/job-abc-123");
    expect(job.job_id).toBe("job-abc-123");
    expect(job.location).toBe("San Francisco, CA");
    expect(job.department).toBe("Engineering");
    expect(job.posted_at).toEqual(new Date("2025-11-01"));
    expect(job.employment_type).toBe("FullTime");
    expect(job.workplace_type).toBe("Hybrid");
    expect(job.description_text).toContain("We are looking for a talented engineer");
    expect(job.apply_url).toBe("https://jobs.ashbyhq.com/acmecorp/job-abc-123/application");
    expect(job.source_detail_url).toBe("https://jobs.ashbyhq.com/acmecorp/job-abc-123");
    expect(job.detail_fetch_status).toBe("ok");
    expect(job.source_type).toBe("ats_api");
    expect(job.source_ref).toBe("ashby");
  });

  // -------------------------------------------------------------------------
  // Field fallback chains (test.each)
  // -------------------------------------------------------------------------

  describe("field fallback chains", () => {
    test.each([
      ["jobUrl present", { jobUrl: "https://a.com/j1", applyUrl: "https://a.com/apply" }, "https://a.com/j1"],
      ["jobUrl missing, falls back to applyUrl", { jobUrl: undefined, applyUrl: "https://a.com/apply" }, "https://a.com/apply"],
    ])("url: %s", async (_label, overrides, expectedUrl) => {
      mockSuccessResponse([makeAshbyJob(overrides)]);
      const result = await extractFromAshby(makeContext());
      expect(result.jobs[0].url).toBe(expectedUrl);
    });

    test.each([
      ["applyUrl present", { applyUrl: "https://a.com/apply", jobUrl: "https://a.com/j" }, "https://a.com/apply"],
      ["applyUrl missing, falls back to jobUrl", { applyUrl: undefined, jobUrl: "https://a.com/j" }, "https://a.com/j"],
    ])("apply_url: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makeAshbyJob(overrides)]);
      const result = await extractFromAshby(makeContext());
      expect(result.jobs[0].apply_url).toBe(expected);
    });

    test.each([
      ["location present", {}, "San Francisco, CA"],
      ["location missing, uses secondaryLocations", { location: undefined, secondaryLocations: [{ location: "Berlin, DE" }, { location: "London, UK" }] }, "Berlin, DE, London, UK"],
      ["secondaryLocations uses title fallback", { location: undefined, secondaryLocations: [{ title: "Remote US" }, { location: "Paris, FR" }] }, "Remote US, Paris, FR"],
      ["both absent", { location: undefined, secondaryLocations: undefined }, null],
    ])("location: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makeAshbyJob(overrides)]);
      const result = await extractFromAshby(makeContext());
      expect(result.jobs[0].location).toBe(expected);
    });

    test.each([
      ["departmentName present", {}, "Engineering"],
      ["departmentName missing, falls back to department", { departmentName: undefined }, "Eng"],
      ["both missing, falls back to team", { departmentName: undefined, department: undefined }, "Platform"],
      ["all absent", { departmentName: undefined, department: undefined, team: undefined }, null],
    ])("department: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makeAshbyJob(overrides)]);
      const result = await extractFromAshby(makeContext());
      expect(result.jobs[0].department).toBe(expected);
    });

    test.each([
      ["publishedDate present", {}, new Date("2025-11-01")],
      ["publishedDate missing, falls back to publishedAt", { publishedDate: undefined }, new Date("2025-11-01T12:00:00Z")],
      ["both absent", { publishedDate: undefined, publishedAt: undefined }, null],
    ] as Array<[string, Record<string, unknown>, Date | null]>)("posted_at: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makeAshbyJob(overrides)]);
      const result = await extractFromAshby(makeContext());
      expect(result.jobs[0].posted_at).toEqual(expected);
    });

    test.each([
      ["descriptionPlain present", {}, "We are looking for a talented engineer."],
      ["descriptionPlain absent, falls back to HTML conversion", { descriptionPlain: undefined, descriptionHtml: "<p>Build great products.</p>" }, "Build great products."],
    ])("description_text: %s", async (_label, overrides, expected) => {
      mockSuccessResponse([makeAshbyJob(overrides)]);
      const result = await extractFromAshby(makeContext());
      expect(result.jobs[0].description_text).toContain(expected);
    });

    test("detail_fetch_status is omitted when no description fields present", async () => {
      mockSuccessResponse([makeAshbyJob({ descriptionHtml: undefined, descriptionPlain: undefined })]);
      const result = await extractFromAshby(makeContext());
      expect(result.jobs[0]).not.toHaveProperty("detail_fetch_status");
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases: missing / null fields
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    test("handles a job where all optional fields are undefined", async () => {
      mockSuccessResponse([{
        title: "QA Analyst",
        jobUrl: "https://jobs.ashbyhq.com/acmecorp/qa-analyst",
      }]);
      const result = await extractFromAshby(makeContext());

      expect(result.errors).toEqual([]);
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].title).toBe("QA Analyst");
      expect(result.jobs[0].location).toBeNull();
      expect(result.jobs[0].department).toBeNull();
      expect(result.jobs[0].posted_at).toBeNull();
      expect(result.jobs[0].employment_type).toBeNull();
    });

    test("filters out jobs with empty or missing title", async () => {
      mockSuccessResponse([
        makeAshbyJob({ title: "" }),
        makeAshbyJob({ title: undefined }),
        makeAshbyJob({ id: "good-job", title: "Product Designer" }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].title).toBe("Product Designer");
    });

    test("uses job_uid prefix as job_id when id field is missing", async () => {
      mockSuccessResponse([makeAshbyJob({ id: undefined })]);
      const result = await extractFromAshby(makeContext());

      const job = result.jobs[0];
      expect(job.job_id).toBe(job.job_uid.slice(0, 12));
    });

    test("filters empty secondaryLocations entries", async () => {
      mockSuccessResponse([makeAshbyJob({
        location: undefined,
        secondaryLocations: [
          { location: undefined, title: undefined },
          { location: "Austin, TX" },
        ],
      })]);
      const result = await extractFromAshby(makeContext());
      expect(result.jobs[0].location).toBe("Austin, TX");
    });

    test("extracts multiple jobs from a single API response", async () => {
      mockSuccessResponse([
        makeAshbyJob({ id: "job-1", title: "Frontend Engineer", jobUrl: "https://jobs.ashbyhq.com/acmecorp/job-1" }),
        makeAshbyJob({ id: "job-2", title: "Backend Engineer", jobUrl: "https://jobs.ashbyhq.com/acmecorp/job-2" }),
      ]);
      const result = await extractFromAshby(makeContext());

      expect(result.jobs).toHaveLength(2);
      expect(result.jobs.map((j) => j.title)).toEqual(["Frontend Engineer", "Backend Engineer"]);
    });
  });
});
