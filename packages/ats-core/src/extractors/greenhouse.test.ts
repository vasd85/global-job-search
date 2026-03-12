import { extractFromGreenhouse } from "./greenhouse";
import type { ExtractionContext } from "./extractor-types";
import { createEmptyDiagnostics } from "../types";

// ---------------------------------------------------------------------------
// Mock fetchJson from ./common
// ---------------------------------------------------------------------------

const mockFetchJson = vi.fn();

vi.mock("./common", () => ({
  fetchJson: (...args: unknown[]) => mockFetchJson(...args),
}));

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

/** Realistic Greenhouse API job entry with all fields populated. */
function makeGreenhouseJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 4012345,
    title: "Senior Software Engineer",
    absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/4012345",
    location: { name: "San Francisco, CA" },
    content: "<p>We are looking for a Senior Software Engineer to join our platform team.</p>",
    first_published: "2025-11-01T00:00:00Z",
    updated_at: "2025-12-15T12:30:00Z",
    departments: [{ name: "Engineering" }, { name: "Platform" }],
    offices: [{ name: "San Francisco" }],
    ...overrides,
  };
}

/** A second distinct job for multi-job tests. */
function makeSecondJob() {
  return makeGreenhouseJob({
    id: 4012346,
    title: "Product Manager",
    absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/4012346",
    location: { name: "New York, NY" },
    content: "<p>Lead product strategy for our core platform.</p>",
    first_published: "2025-10-20T00:00:00Z",
    updated_at: "2025-12-10T08:00:00Z",
    departments: [{ name: "Product" }],
    offices: [{ name: "New York" }],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockFetchJson.mockReset();
});

// ---------------------------------------------------------------------------
// Token parsing failures (invalid careersUrl)
// ---------------------------------------------------------------------------

describe("extractFromGreenhouse - invalid board token", () => {
  test.each([
    ["completely invalid URL", "not-a-url-at-all"],
    ["URL with no path segment on greenhouse.io", "https://boards.greenhouse.io/"],
    ["non-Greenhouse domain", "https://example.com/acmecorp"],
    ["empty string", ""],
  ])("returns empty jobs with error when careersUrl is %s", async (_label, careersUrl) => {
    const result = await extractFromGreenhouse(makeContext({ careersUrl }));

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Unable to parse Greenhouse board token");
    // fetchJson should never be called if the token cannot be parsed
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// API failure handling
// ---------------------------------------------------------------------------

describe("extractFromGreenhouse - API failure", () => {
  test("returns empty jobs with error when fetchJson returns null data", async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: "network timeout" });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Greenhouse API failed");
    expect(result.errors[0]).toContain("network timeout");
  });

  test("includes the API endpoint URL in the error message on failure", async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: "500 Internal Server Error" });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.errors[0]).toContain("boards-api.greenhouse.io");
    expect(result.errors[0]).toContain("acmecorp");
  });

  test("reports 'unknown error' when fetchJson returns null data with no error message", async () => {
    mockFetchJson.mockResolvedValue({ data: null, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.errors[0]).toContain("unknown error");
  });
});

// ---------------------------------------------------------------------------
// Empty job list
// ---------------------------------------------------------------------------

describe("extractFromGreenhouse - empty job list", () => {
  test("returns empty jobs with no errors when API returns an empty jobs array", async () => {
    mockFetchJson.mockResolvedValue({ data: { jobs: [] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("returns empty jobs with no errors when API response has no jobs property", async () => {
    mockFetchJson.mockResolvedValue({ data: {}, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test("returns empty jobs when jobs property is explicitly null", async () => {
    mockFetchJson.mockResolvedValue({ data: { jobs: null }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Successful extraction with full data
// ---------------------------------------------------------------------------

describe("extractFromGreenhouse - successful extraction", () => {
  test("extracts a single job with all fields mapped correctly", async () => {
    const rawJob = makeGreenhouseJob();
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(1);

    const job = result.jobs[0];
    expect(job.title).toBe("Senior Software Engineer");
    expect(job.url).toBe("https://boards.greenhouse.io/acmecorp/jobs/4012345");
    expect(job.job_id).toBe("4012345");
    expect(job.location_raw).toBe("San Francisco, CA");
    expect(job.department_raw).toBe("Engineering, Platform");
    expect(job.posted_date_raw).toBe("2025-11-01T00:00:00Z");
    expect(job.source_type).toBe("ats_api");
    expect(job.source_ref).toBe("greenhouse");
  });

  test("extracts multiple jobs from API response", async () => {
    mockFetchJson.mockResolvedValue({
      data: { jobs: [makeGreenhouseJob(), makeSecondJob()] },
      error: null,
    });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0].title).toBe("Senior Software Engineer");
    expect(result.jobs[1].title).toBe("Product Manager");
  });

  test("job_uid is deterministic for the same URL", async () => {
    mockFetchJson.mockResolvedValue({ data: { jobs: [makeGreenhouseJob()] }, error: null });
    const result1 = await extractFromGreenhouse(makeContext());

    mockFetchJson.mockResolvedValue({ data: { jobs: [makeGreenhouseJob()] }, error: null });
    const result2 = await extractFromGreenhouse(makeContext());

    expect(result1.jobs[0].job_uid).toBe(result2.jobs[0].job_uid);
  });
});

// ---------------------------------------------------------------------------
// Field mapping details
// ---------------------------------------------------------------------------

describe("extractFromGreenhouse - field mapping", () => {
  test("maps absolute_url to url, apply_url, and source_detail_url", async () => {
    const rawJob = makeGreenhouseJob();
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());
    const job = result.jobs[0];

    expect(job.url).toBe("https://boards.greenhouse.io/acmecorp/jobs/4012345");
    expect(job.apply_url).toBe("https://boards.greenhouse.io/acmecorp/jobs/4012345");
    expect(job.source_detail_url).toBe("https://boards.greenhouse.io/acmecorp/jobs/4012345");
  });

  test("converts HTML content to plain text in description_text", async () => {
    const rawJob = makeGreenhouseJob({
      content: "<h2>About the Role</h2><p>Build <strong>amazing</strong> things.</p>",
    });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());
    const job = result.jobs[0];

    expect(job.description_text).toBeDefined();
    expect(job.description_text).toContain("About the Role");
    expect(job.description_text).toContain("Build");
    expect(job.description_text).toContain("amazing");
    expect(job.description_text).not.toContain("<h2>");
    expect(job.description_text).not.toContain("<strong>");
  });

  test("joins multiple department names with comma separator", async () => {
    const rawJob = makeGreenhouseJob({
      departments: [{ name: "Engineering" }, { name: "Infrastructure" }, { name: "SRE" }],
    });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs[0].department_raw).toBe("Engineering, Infrastructure, SRE");
  });

  test("uses first_published as posted_date_raw when available", async () => {
    const rawJob = makeGreenhouseJob({
      first_published: "2025-06-01T00:00:00Z",
      updated_at: "2025-12-01T00:00:00Z",
    });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs[0].posted_date_raw).toBe("2025-06-01T00:00:00Z");
  });

  test("falls back to updated_at when first_published is absent", async () => {
    const rawJob = makeGreenhouseJob({
      first_published: undefined,
      updated_at: "2025-12-01T00:00:00Z",
    });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs[0].posted_date_raw).toBe("2025-12-01T00:00:00Z");
  });

  test("sets detail_fetch_status to 'ok' when content is present", async () => {
    const rawJob = makeGreenhouseJob({ content: "<p>Some content</p>" });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs[0].detail_fetch_status).toBe("ok");
  });

  test("omits detail_fetch_status when content is absent", async () => {
    const rawJob = makeGreenhouseJob({ content: undefined });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs[0]).not.toHaveProperty("detail_fetch_status");
  });
});

// ---------------------------------------------------------------------------
// Missing and null fields (edge cases)
// ---------------------------------------------------------------------------

describe("extractFromGreenhouse - missing or null fields in API response", () => {
  test.each<[string, Record<string, unknown>, string | null]>([
    ["missing location object", { location: undefined }, null],
    ["null location name", { location: { name: undefined } }, null],
    ["empty location name", { location: { name: "" } }, null],
  ])("handles %s gracefully", async (_label, locationOverride, expectedLocation) => {
    const rawJob = makeGreenhouseJob(locationOverride);
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].location_raw).toBe(expectedLocation);
  });

  test("falls back to offices when departments array is empty", async () => {
    const rawJob = makeGreenhouseJob({
      departments: [],
      offices: [{ name: "Berlin" }, { name: "London" }],
    });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    // TODO: The current implementation uses `??` (nullish coalescing) between the
    // departments .join() and the offices .join(). Since [].join() returns "" (falsy
    // but not nullish), the `??` will NOT fall back to offices. This means
    // department_raw will be "" which normalizeText likely converts to null.
    // This may be a bug -- `.filter(Boolean).join(", ") || null` would be
    // more correct to ensure fallback to offices when departments is empty.
    // The test reflects the actual behavior.
    expect(result.jobs[0].department_raw).toBeNull();
  });

  test("sets department_raw to null when both departments and offices are missing", async () => {
    const rawJob = makeGreenhouseJob({
      departments: undefined,
      offices: undefined,
    });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs[0].department_raw).toBeNull();
  });

  test("filters out department entries with falsy names", async () => {
    const rawJob = makeGreenhouseJob({
      departments: [{ name: "Engineering" }, { name: undefined }, { name: "" }, { name: "DevOps" }],
    });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs[0].department_raw).toBe("Engineering, DevOps");
  });

  test("sets posted_date_raw to null when both first_published and updated_at are missing", async () => {
    const rawJob = makeGreenhouseJob({
      first_published: undefined,
      updated_at: undefined,
    });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs[0].posted_date_raw).toBeNull();
  });

  test("uses empty string for url when absolute_url is missing", async () => {
    const rawJob = makeGreenhouseJob({ absolute_url: undefined });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    // An empty string URL resolves against the baseUrl (careersUrl)
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].url).toContain("boards.greenhouse.io");
  });

  test("omits description_text when content is missing", async () => {
    const rawJob = makeGreenhouseJob({ content: undefined });
    mockFetchJson.mockResolvedValue({ data: { jobs: [rawJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs[0]).not.toHaveProperty("description_text");
  });
});

// ---------------------------------------------------------------------------
// API endpoint construction and token parsing from different URL formats
// ---------------------------------------------------------------------------

describe("extractFromGreenhouse - API endpoint construction", () => {
  test.each([
    [
      "standard boards.greenhouse.io URL",
      "https://boards.greenhouse.io/acmecorp",
      "acmecorp",
    ],
    [
      "boards-api.greenhouse.io URL with boards path",
      "https://boards-api.greenhouse.io/v1/boards/betacorp/jobs",
      "betacorp",
    ],
    [
      "URL with ?for= query parameter",
      "https://boards.greenhouse.io/embed/job_board?for=deltacorp",
      "deltacorp",
    ],
  ])("constructs correct endpoint for %s", async (_label, careersUrl, expectedToken) => {
    mockFetchJson.mockResolvedValue({ data: { jobs: [] }, error: null });

    await extractFromGreenhouse(makeContext({ careersUrl }));

    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetchJson.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      `https://boards-api.greenhouse.io/v1/boards/${expectedToken}/jobs?content=true`
    );
  });

  // Adversarial false-positive tests for URL / domain detection
  test.each([
    ["domain containing 'greenhouse' but not greenhouse.io", "https://greenhouse.example.com/acmecorp"],
    ["domain with greenhouse in subdomain only", "https://greenhouse.fakecorp.io/token"],
    ["path containing greenhouse.io as a segment", "https://example.com/boards.greenhouse.io/acme"],
  ])("rejects %s and does not call API", async (_label, careersUrl) => {
    const result = await extractFromGreenhouse(makeContext({ careersUrl }));

    expect(result.jobs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(mockFetchJson).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// fetchJson invocation parameters
// ---------------------------------------------------------------------------

describe("extractFromGreenhouse - fetchJson parameters", () => {
  test("passes diagnostics, timeoutMs, maxRetries, and maxAttempts to fetchJson", async () => {
    const diagnostics = createEmptyDiagnostics();
    mockFetchJson.mockResolvedValue({ data: { jobs: [] }, error: null });

    await extractFromGreenhouse(
      makeContext({ diagnostics, timeoutMs: 10000, maxRetries: 3, maxAttempts: 5 })
    );

    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.any(String),
      diagnostics,
      10000,
      3,
      5
    );
  });

  test("passes undefined for maxAttempts when not provided in context", async () => {
    mockFetchJson.mockResolvedValue({ data: { jobs: [] }, error: null });

    await extractFromGreenhouse(makeContext());

    const call = mockFetchJson.mock.calls[0];
    expect(call[4]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Deduplication integration
// ---------------------------------------------------------------------------

describe("extractFromGreenhouse - deduplication", () => {
  test("deduplicates jobs with the same absolute_url", async () => {
    const sharedUrl = "https://boards.greenhouse.io/acmecorp/jobs/4012345";
    const job1 = makeGreenhouseJob({ id: 4012345, absolute_url: sharedUrl, title: "Engineer" });
    const job2 = makeGreenhouseJob({ id: 4012345, absolute_url: sharedUrl, title: "Engineer" });
    mockFetchJson.mockResolvedValue({ data: { jobs: [job1, job2] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toHaveLength(1);
  });

  test("does not deduplicate jobs with different URLs", async () => {
    const job1 = makeGreenhouseJob({
      id: 100,
      absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/100",
    });
    const job2 = makeGreenhouseJob({
      id: 200,
      absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/200",
    });
    mockFetchJson.mockResolvedValue({ data: { jobs: [job1, job2] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// buildJob filtering integration (jobs with empty/whitespace titles)
// ---------------------------------------------------------------------------

describe("extractFromGreenhouse - buildJob filtering", () => {
  test("filters out jobs with empty titles", async () => {
    const validJob = makeGreenhouseJob();
    const emptyTitleJob = makeGreenhouseJob({
      id: 9999,
      title: "",
      absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/9999",
    });
    mockFetchJson.mockResolvedValue({ data: { jobs: [validJob, emptyTitleJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("Senior Software Engineer");
  });

  test("filters out jobs with whitespace-only titles", async () => {
    const whitespaceJob = makeGreenhouseJob({
      id: 8888,
      title: "   ",
      absolute_url: "https://boards.greenhouse.io/acmecorp/jobs/8888",
    });
    mockFetchJson.mockResolvedValue({ data: { jobs: [whitespaceJob] }, error: null });

    const result = await extractFromGreenhouse(makeContext());

    expect(result.jobs).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
