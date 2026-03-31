// @vitest-environment node

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

const searchJobsMock = vi.fn();
vi.mock("@/lib/search/filter-pipeline", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  searchJobs: (...args: unknown[]) => searchJobsMock(...args),
}));

const { profileResult, mockSelectLimit } = vi.hoisted(() => {
  const profileResult: unknown[][] = [];
  const mockSelectLimit = vi.fn().mockImplementation(() => {
    const result = profileResult.shift();
    return Promise.resolve(result ?? []);
  });

  return { profileResult, mockSelectLimit };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => `eq(${String(col)},${String(val)})`),
}));

vi.mock("@/lib/db/schema", () => ({
  userProfiles: {
    id: "userProfiles.id",
    userId: "userProfiles.userId",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockSelectLimit,
        })),
      })),
    })),
  },
}));

import { GET } from "./route";
import type { SearchResponse } from "@/lib/search/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const userSession = {
  user: { id: "user-1" },
  session: { token: "tok" },
};

function makeRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost/api/search");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

async function getJsonResponse(
  params: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await GET(makeRequest(params));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body: Record<string, unknown> = await response.json();
  return { status: response.status, body };
}

function makeSearchResponse(
  overrides: Partial<SearchResponse> = {},
): SearchResponse {
  return {
    jobs: [],
    total: 0,
    hasMore: false,
    limit: 50,
    offset: 0,
    filters: {
      roleFamilies: [],
      seniority: null,
      remotePreference: "any",
      locations: [],
      industries: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  profileResult.length = 0;

  // Default: authenticated user with a profile
  getSessionMock.mockResolvedValue(userSession);
  profileResult.push([{ id: "profile-1" }]);
  searchJobsMock.mockResolvedValue(makeSearchResponse());
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe("GET /api/search -- authentication", () => {
  test("unauthenticated request returns 401", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const { status, body } = await getJsonResponse();

    expect(status).toBe(401);
    expect(body.error).toBe("Authentication required");
  });
});

// ---------------------------------------------------------------------------
// Profile lookup
// ---------------------------------------------------------------------------

describe("GET /api/search -- profile lookup", () => {
  test("authenticated user without profile returns 404", async () => {
    profileResult.length = 0;
    profileResult.push([]);

    const { status, body } = await getJsonResponse();

    expect(status).toBe(404);
    expect(body.error).toBe(
      "No profile found. Please complete onboarding first.",
    );
  });

  test("DB error during profile lookup returns 500", async () => {
    mockSelectLimit.mockRejectedValueOnce(new Error("connection refused"));

    const { status, body } = await getJsonResponse();

    expect(status).toBe(500);
    expect(body.error).toBe("An unexpected error occurred during search");
    // Internal error message must NOT be exposed
    expect(JSON.stringify(body)).not.toContain("connection refused");
  });
});

// ---------------------------------------------------------------------------
// Query parameter validation
// ---------------------------------------------------------------------------

describe("GET /api/search -- query parameter validation", () => {
  test("invalid query params return 400 with details", async () => {
    const { status, body } = await getJsonResponse({ limit: "-5" });

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid query parameters");
    expect(body.details).toBeDefined();
  });

  test("no query params uses defaults (limit=50, offset=0)", async () => {
    await getJsonResponse();

    expect(searchJobsMock).toHaveBeenCalledWith(
      expect.anything(),
      "profile-1",
      { limit: 50, offset: 0 },
    );
  });

  test("non-integer limit string returns 400", async () => {
    const { status, body } = await getJsonResponse({ limit: "abc" });

    expect(status).toBe(400);
    expect(body.error).toBe("Invalid query parameters");
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("GET /api/search -- happy path", () => {
  test("authenticated user with profile returns search results", async () => {
    const mockResponse = makeSearchResponse({
      jobs: [
        {
          id: "job-1",
          title: "QA Engineer",
          url: "https://example.com/jobs/1",
          applyUrl: null,
          locationRaw: "Remote",
          departmentRaw: "Engineering",
          workplaceType: "remote",
          salaryRaw: null,
          firstSeenAt: new Date("2025-06-15T12:00:00Z"),
          lastSeenAt: new Date("2025-06-20T12:00:00Z"),
          companyName: "Acme",
          companySlug: "acme",
          companyIndustry: ["fintech"],
          classificationScore: 0.9,
          classificationFamily: "qa_testing",
          classificationMatchType: "strong",
          detectedSeniority: null,
        },
      ],
      total: 1,
      hasMore: false,
    });
    searchJobsMock.mockResolvedValueOnce(mockResponse);

    const { status, body } = await getJsonResponse({
      limit: "10",
      offset: "0",
    });

    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.hasMore).toBe(false);
    expect(Array.isArray(body.jobs)).toBe(true);
    expect((body.jobs as unknown[]).length).toBe(1);
  });

  test("searchJobs is called with correct profile ID and pagination", async () => {
    await getJsonResponse({ limit: "10", offset: "20" });

    expect(searchJobsMock).toHaveBeenCalledWith(
      expect.anything(),
      "profile-1",
      { limit: 10, offset: 20 },
    );
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("GET /api/search -- error handling", () => {
  test("searchJobs throws -- returns 500 with safe error message", async () => {
    searchJobsMock.mockRejectedValueOnce(new Error("DB connection lost"));

    const { status, body } = await getJsonResponse();

    expect(status).toBe(500);
    expect(body.error).toBe("An unexpected error occurred during search");
    expect(JSON.stringify(body)).not.toContain("DB connection lost");
  });

  test("extremely large offset is accepted and returns empty results", async () => {
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs: [], total: 0, hasMore: false }),
    );

    const { status, body } = await getJsonResponse({
      offset: "999999999",
    });

    expect(status).toBe(200);
    expect((body.jobs as unknown[]).length).toBe(0);
    expect(body.hasMore).toBe(false);
  });
});
