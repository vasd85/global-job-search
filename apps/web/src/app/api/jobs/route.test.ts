// @vitest-environment node

// ---------------------------------------------------------------------------
// Mock drizzle-orm — token-based condition builders so we can assert WHAT
// was queried, not just that "a query ran".
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", () => {
  // sql is used as a tagged template literal: sql`count(*)::int`
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const sqlFn = Object.assign(vi.fn((..._args: unknown[]) => "count(*)"), {
    raw: vi.fn((s: string) => s),
  });
  return {
    eq: vi.fn((col, val) => `eq(${col},${val})`),
    ilike: vi.fn((col, val) => `ilike(${col},${val})`),
    and: vi.fn((...args: unknown[]) => args),
    or: vi.fn((...args: unknown[]) => `or(${args.join(",")})`),
    inArray: vi.fn((col, vals) => `inArray(${col},${vals})`),
    isNotNull: vi.fn((col) => `isNotNull(${col})`),
    desc: vi.fn((col) => `desc(${col})`),
    sql: sqlFn,
  };
});

// ---------------------------------------------------------------------------
// Mock @/lib/db/schema — column references as string tokens
// ---------------------------------------------------------------------------

vi.mock("@/lib/db/schema", () => ({
  jobs: {
    id: "jobs.id",
    title: "jobs.title",
    url: "jobs.url",
    locationRaw: "jobs.locationRaw",
    departmentRaw: "jobs.departmentRaw",
    workplaceType: "jobs.workplaceType",
    salaryRaw: "jobs.salaryRaw",
    firstSeenAt: "jobs.firstSeenAt",
    lastSeenAt: "jobs.lastSeenAt",
    applyUrl: "jobs.applyUrl",
    sourceRef: "jobs.sourceRef",
    companyId: "jobs.companyId",
    status: "jobs.status",
    descriptionText: "jobs.descriptionText",
  },
  companies: {
    id: "companies.id",
    name: "companies.name",
    slug: "companies.slug",
    atsVendor: "companies.atsVendor",
  },
}));

// ---------------------------------------------------------------------------
// Mock @/lib/db — chainable Drizzle-style API
// ---------------------------------------------------------------------------

const { state, mockOffset, mockWhere, mockSelect } = vi.hoisted(() => {
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

  const mockWhere = vi.fn().mockImplementation(() => {
    state.whereCallCount++;
    if (state.whereCallCount % 2 === 1) {
      return { orderBy: mockOrderBy };
    }
    if (state.mockDbError) return Promise.reject(state.mockDbError);
    return Promise.resolve(state.mockCountRows);
  });

  const mockInnerJoin = vi.fn().mockReturnValue({ where: mockWhere });
  const mockFrom = vi.fn().mockReturnValue({ innerJoin: mockInnerJoin });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  return { state, mockOffset, mockWhere, mockSelect };
});

vi.mock("@/lib/db", () => ({
  db: { select: mockSelect },
}));

import { eq, ilike, or, isNotNull } from "drizzle-orm";
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body: Record<string, unknown> = await response.json();
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

/** Extract the where-clause token array from the paginated query (1st call). */
function getPaginatedWhereArg(): unknown {
  return mockWhere.mock.calls[0]?.[0];
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  // --- Default status filter ---

  test("always applies status='open' condition by default", async () => {
    await getJsonResponse();

    expect(eq).toHaveBeenCalledWith("jobs.status", "open");
    const whereArg = getPaginatedWhereArg() as unknown[];
    expect(whereArg).toContain("eq(jobs.status,open)");
  });

  test("applies explicit status param when provided", async () => {
    await getJsonResponse({ status: "closed" });

    expect(eq).toHaveBeenCalledWith("jobs.status", "closed");
    const whereArg = getPaginatedWhereArg() as unknown[];
    expect(whereArg).toContain("eq(jobs.status,closed)");
  });

  // --- Individual filter params produce correct conditions ---

  describe("filter parameters produce correct condition tokens", () => {
    test("search adds or(ilike(title), ilike(department)) condition", async () => {
      await getJsonResponse({ search: "engineer" });

      expect(ilike).toHaveBeenCalledWith("jobs.title", "%engineer%");
      expect(ilike).toHaveBeenCalledWith("jobs.departmentRaw", "%engineer%");
      expect(or).toHaveBeenCalled();
      const whereArg = getPaginatedWhereArg() as unknown[];
      expect(whereArg).toContain(
        "or(ilike(jobs.title,%engineer%),ilike(jobs.departmentRaw,%engineer%))"
      );
    });

    test("workplaceType adds eq(workplaceType, value) condition", async () => {
      await getJsonResponse({ workplaceType: "remote" });

      expect(eq).toHaveBeenCalledWith("jobs.workplaceType", "remote");
      const whereArg = getPaginatedWhereArg() as unknown[];
      expect(whereArg).toContain("eq(jobs.workplaceType,remote)");
    });

    test("vendor adds eq(atsVendor, value) condition", async () => {
      await getJsonResponse({ vendor: "greenhouse" });

      expect(eq).toHaveBeenCalledWith("companies.atsVendor", "greenhouse");
      const whereArg = getPaginatedWhereArg() as unknown[];
      expect(whereArg).toContain("eq(companies.atsVendor,greenhouse)");
    });

    test("company adds eq(slug, value) condition", async () => {
      await getJsonResponse({ company: "acme" });

      expect(eq).toHaveBeenCalledWith("companies.slug", "acme");
      const whereArg = getPaginatedWhereArg() as unknown[];
      expect(whereArg).toContain("eq(companies.slug,acme)");
    });

    test("hasDescription='true' adds isNotNull(descriptionText) condition", async () => {
      await getJsonResponse({ hasDescription: "true" });

      expect(isNotNull).toHaveBeenCalledWith("jobs.descriptionText");
      const whereArg = getPaginatedWhereArg() as unknown[];
      expect(whereArg).toContain("isNotNull(jobs.descriptionText)");
    });

    test("hasDescription='false' does not add description filter", async () => {
      await getJsonResponse({ hasDescription: "false" });

      expect(isNotNull).not.toHaveBeenCalled();
    });
  });

  // --- Multiple filters combined ---

  test("combines multiple filters in a single and() call", async () => {
    await getJsonResponse({
      search: "engineer",
      workplaceType: "remote",
      vendor: "greenhouse",
      company: "acme",
      hasDescription: "true",
      status: "closed",
    });

    const whereArg = getPaginatedWhereArg() as unknown[];
    expect(whereArg).toContain("eq(jobs.status,closed)");
    expect(whereArg).toContain("eq(jobs.workplaceType,remote)");
    expect(whereArg).toContain("isNotNull(jobs.descriptionText)");
    expect(whereArg).toContain("eq(companies.atsVendor,greenhouse)");
    expect(whereArg).toContain("eq(companies.slug,acme)");
  });

  // --- Omitted filters don't produce spurious conditions ---

  test("omitted filters produce only the default status condition", async () => {
    await getJsonResponse();

    const whereArg = getPaginatedWhereArg() as unknown[];
    // status=open + always-on supported ATS vendor filter
    expect(whereArg).toEqual([
      "eq(jobs.status,open)",
      "inArray(companies.atsVendor,greenhouse,lever,ashby,smartrecruiters)",
    ]);
  });

  // --- Error handling ---

  test.each([
    ["Error instance", new Error("connection refused"), "connection refused"],
    ["non-Error string", "raw string failure", "raw string failure"],
  ])("returns 500 when DB throws %s", async (_label, thrown, expectedMsg) => {
    if (thrown instanceof Error) {
      state.mockDbError = thrown;
    } else {
      mockOffset.mockRejectedValueOnce(thrown);
    }

    const { status, body } = await getJsonResponse();

    expect(status).toBe(500);
    expect(body).toEqual({ error: expectedMsg });
  });

  // --- Pagination values in response ---

  test("echoes limit and offset in the response body", async () => {
    const { body } = await getJsonResponse({ limit: "25", offset: "100" });

    expect(body.limit).toBe(25);
    expect(body.offset).toBe(100);
  });
});
