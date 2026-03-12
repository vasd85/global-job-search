// @vitest-environment node

// ---------------------------------------------------------------------------
// Mock @/lib/db — chainable Drizzle-style API
// ---------------------------------------------------------------------------

const { state, mockOffset, mockLimit, mockOrderBy, mockWhere, mockInnerJoin, mockFrom, mockSelect } = vi.hoisted(() => {
  const state = {
    mockJobRows: [] as Record<string, unknown>[],
    mockCountRows: [{ count: 0 }] as { count: number }[],
    mockDbError: null as Error | null,
    whereCallCount: 0,
  };

  const mockOffset = vi.fn().mockImplementation(() => {
    if (state.mockDbError) return Promise.reject(state.mockDbError);
    return Promise.resolve(state.mockJobRows);
  });
  const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });

  // Two separate where mocks: one for the paginated query (chains to orderBy),
  // one for the count query (resolves directly).
  const mockWhere = vi.fn().mockImplementation(() => {
    state.whereCallCount++;
    // First call: paginated query -> chains to orderBy
    // Second call: count query -> resolves to count rows
    if (state.whereCallCount % 2 === 1) {
      return { orderBy: mockOrderBy };
    }
    if (state.mockDbError) return Promise.reject(state.mockDbError);
    return Promise.resolve(state.mockCountRows);
  });

  const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
  const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return { state, mockOffset, mockLimit, mockOrderBy, mockWhere, mockInnerJoin, mockFrom, mockSelect };
});

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

import { GET } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/jobs");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

async function getJsonResponse(
  params: Record<string, string> = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(makeRequest(params));
  const body = await response.json();
  return { status: response.status, body };
}

function makeFakeJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-uuid-1",
    title: "Software Engineer",
    url: "https://example.com/jobs/1",
    locationRaw: "Remote",
    departmentRaw: "Engineering",
    workplaceType: "remote",
    salaryRaw: "$100k-$150k",
    firstSeenAt: new Date("2025-06-01"),
    lastSeenAt: new Date("2025-06-15"),
    applyUrl: "https://example.com/apply/1",
    sourceRef: "greenhouse",
    companyName: "Acme Corp",
    companySlug: "acme",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  state.whereCallCount = 0;
  state.mockJobRows = [];
  state.mockCountRows = [{ count: 0 }];
  state.mockDbError = null;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/jobs", () => {
  // --- Default parameters ---

  test("returns status 200 with default pagination when no params provided", async () => {
    const { status, body } = await getJsonResponse();

    expect(status).toBe(200);
    expect(body).toEqual({
      jobs: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
  });

  // --- Limit capping ---

  test.each([
    ["10", 10, "respects explicit limit"],
    ["200", 200, "allows maximum limit of 200"],
    ["201", 200, "caps limit at 200 when exceeded"],
    ["999", 200, "caps large limit at 200"],
    // TODO: Non-numeric limit produces NaN (parseInt("abc") → NaN,
    // Math.min(NaN, 200) → NaN). NaN serializes to null in JSON and
    // propagates to the SQL LIMIT clause, which may cause unexpected
    // DB behavior. The route should validate and default invalid limits.
    ["abc", null, "non-numeric limit results in NaN (serialized as null)"],
  ])("limit=%s results in limit=%j (%s)", async (input, expected, _label) => {
    const { body } = await getJsonResponse({ limit: input });
    expect(body.limit).toBe(expected);
  });

  // --- Offset ---

  test("passes offset to the query", async () => {
    const { body } = await getJsonResponse({ offset: "25" });
    expect(body.offset).toBe(25);
    expect(mockOffset).toHaveBeenCalledWith(25);
  });

  test("defaults offset to 0 when not provided", async () => {
    const { body } = await getJsonResponse();
    expect(body.offset).toBe(0);
  });

  // --- Response shape with results ---

  test("returns jobs array and total count from DB", async () => {
    const fakeJob = makeFakeJobRow();
    state.mockJobRows = [fakeJob];
    state.mockCountRows = [{ count: 42 }];

    const { status, body } = await getJsonResponse();

    expect(status).toBe(200);
    expect(body.total).toBe(42);
    expect(Array.isArray(body.jobs)).toBe(true);
    expect((body.jobs as unknown[]).length).toBe(1);
  });

  // --- Empty results ---

  test("returns empty jobs array when no jobs match filters", async () => {
    state.mockJobRows = [];
    state.mockCountRows = [{ count: 0 }];

    const { status, body } = await getJsonResponse({ search: "nonexistent" });

    expect(status).toBe(200);
    expect(body.jobs).toEqual([]);
    expect(body.total).toBe(0);
  });

  // --- Count fallback when count result is empty ---

  test("returns total 0 when count query returns empty array", async () => {
    state.mockCountRows = [] as { count: number }[];

    const { body } = await getJsonResponse();

    expect(body.total).toBe(0);
  });

  // --- Filter params trigger DB calls ---

  describe("filter parameters are forwarded to the DB query", () => {
    test.each([
      ["search", "engineer"],
      ["workplaceType", "remote"],
      ["vendor", "greenhouse"],
      ["company", "acme"],
      ["hasDescription", "true"],
    ])(
      "%s=%s triggers a filtered query (select called with conditions)",
      async (param, value) => {
        await getJsonResponse({ [param]: value });

        // Both paginated and count queries should execute
        expect(mockSelect).toHaveBeenCalledTimes(2);
        expect(mockWhere).toHaveBeenCalledTimes(2);
      }
    );
  });

  // --- Multiple filters combined ---

  test("applies multiple filters simultaneously", async () => {
    await getJsonResponse({
      search: "engineer",
      workplaceType: "remote",
      vendor: "greenhouse",
      company: "acme",
      hasDescription: "true",
      status: "closed",
    });

    expect(mockSelect).toHaveBeenCalledTimes(2);
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });

  // --- Status default ---

  test("uses status 'open' by default (always adds status condition)", async () => {
    await getJsonResponse();

    // The where clause is always called (status = "open" is always added)
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });

  // --- hasDescription filter ---

  test("hasDescription='false' does not add description filter", async () => {
    // hasDescription only adds the filter when value is exactly "true"
    await getJsonResponse({ hasDescription: "false" });

    // The query still executes, just without the isNotNull condition
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });

  // --- Error handling ---

  test("returns 500 with error message when DB throws an Error", async () => {
    state.mockDbError = new Error("connection refused");

    const { status, body } = await getJsonResponse();

    expect(status).toBe(500);
    expect(body).toEqual({ error: "connection refused" });
  });

  test("returns 500 with stringified error when DB throws a non-Error", async () => {
    // Override the mock to throw a string
    mockOffset.mockRejectedValueOnce("raw string failure");

    const { status, body } = await getJsonResponse();

    expect(status).toBe(500);
    expect(body).toEqual({ error: "raw string failure" });
  });

  // --- Pagination values in response ---

  test("echoes limit and offset in the response body", async () => {
    const { body } = await getJsonResponse({ limit: "25", offset: "100" });

    expect(body.limit).toBe(25);
    expect(body.offset).toBe(100);
  });
});
