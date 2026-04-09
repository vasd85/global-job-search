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

const getActiveKeyMetaMock = vi.fn();
vi.mock("@/lib/api-keys/api-key-service", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  getActiveKeyMeta: (...args: unknown[]) => getActiveKeyMetaMock(...args),
}));

const searchJobsMock = vi.fn();
vi.mock("@/lib/search/filter-pipeline", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  searchJobs: (...args: unknown[]) => searchJobsMock(...args),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: string, val: unknown) => `eq(${col},${String(val)})`),
  and: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((col: string, val: unknown) => `inArray(${col},${String(val)})`),
}));

vi.mock("@/lib/db/schema", () => ({
  userProfiles: {
    id: "userProfiles.id",
    userId: "userProfiles.userId",
  },
  jobMatches: {
    jobId: "jobMatches.jobId",
    jobContentHash: "jobMatches.jobContentHash",
    userProfileId: "jobMatches.userProfileId",
  },
  jobs: {
    id: "jobs.id",
    descriptionHash: "jobs.descriptionHash",
  },
}));

// DB mock: the route makes 3 select calls:
//   1. Profile lookup (select -> from -> where -> limit)
//   2. Existing matches lookup (select -> from -> where) [in Promise.all]
//   3. Job hashes lookup (select -> from -> where) [in Promise.all]
//
// We use mockReturnValueOnce sequencing. The profile query runs first,
// then the two Promise.all queries are kicked off synchronously (both
// .select() calls happen before either resolves), so sequential mocking works.

const { dbSelectResults, mockDbSelect } = vi.hoisted(() => {
  const dbSelectResults: unknown[] = [];

  const mockDbSelect = vi.fn().mockImplementation(() => {
    const result = dbSelectResults.shift();
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          if (typeof result === "function") {
            return (result as () => unknown)();
          }
          // If the result is a promise (e.g., rejection), return it directly
          if (result instanceof Promise) {
            return result;
          }
          // For profile query, wrap in limit chain
          return {
            limit: vi.fn().mockResolvedValue(result),
            then: (resolve: (v: unknown) => void) => {
              resolve(result);
              return Promise.resolve(result);
            },
          };
        }),
      }),
    };
  });

  return { dbSelectResults, mockDbSelect };
});

vi.mock("@/lib/db", () => ({
  db: {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

const mockSend = vi.fn().mockResolvedValue("job-id-1");
const mockCreateQueue = vi.fn().mockResolvedValue(undefined);
const mockBoss = { send: mockSend, createQueue: mockCreateQueue };
const mockGetQueue = vi.fn().mockResolvedValue(mockBoss);
vi.mock("@/lib/queue", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  getQueue: (...args: unknown[]) => mockGetQueue(...args),
}));

vi.mock("@gjs/ingestion", () => ({
  FUTURE_QUEUES: {
    llmScoring: "score/llm",
  },
}));

import { POST } from "./route";
import type { SearchResponse } from "@/lib/search/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const userSession = {
  user: { id: "user-1" },
  session: { token: "tok" },
};

function makeRequest(): Request {
  return new Request("http://localhost/api/scoring/trigger", {
    method: "POST",
  });
}

async function postJson(): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const response = await POST(makeRequest());
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
    limit: 200,
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

interface MinimalJob {
  id: string;
  title: string;
  url: string;
  applyUrl: string | null;
  location: string | null;
  department: string | null;
  workplaceType: string | null;
  salary: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  companyName: string;
  companySlug: string;
  companyIndustry: string[] | null;
  classificationScore: number;
  classificationFamily: string;
  classificationMatchType: string;
  detectedSeniority: string | null;
  matchedLocationTier: number | null;
}

function makeJob(id: string): MinimalJob {
  return {
    id,
    title: `Job ${id}`,
    url: `https://example.com/jobs/${id}`,
    applyUrl: null,
    location: "Remote",
    department: "Engineering",
    workplaceType: "remote",
    salary: null,
    firstSeenAt: new Date("2025-06-15T12:00:00Z"),
    lastSeenAt: new Date("2025-06-20T12:00:00Z"),
    companyName: "Acme",
    companySlug: "acme",
    companyIndustry: ["fintech"],
    classificationScore: 0.9,
    classificationFamily: "backend",
    classificationMatchType: "strong",
    detectedSeniority: null,
    matchedLocationTier: null,
  };
}

/**
 * Set up all DB select results for a standard flow:
 * 1. Profile query returns profile
 * 2. existingMatches query returns given matches
 * 3. jobHashes query returns given hashes
 */
function setupDbResults(
  profile: unknown[],
  existingMatches: unknown,
  jobHashes: unknown,
) {
  dbSelectResults.length = 0;
  // Profile query uses .limit() chain
  dbSelectResults.push(profile);
  // The Promise.all queries resolve directly from .where()
  dbSelectResults.push(existingMatches);
  dbSelectResults.push(jobHashes);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  dbSelectResults.length = 0;

  // Default: authenticated user with profile, active key, no jobs
  getSessionMock.mockResolvedValue(userSession);
  getActiveKeyMetaMock.mockResolvedValue({
    id: "key-1",
    provider: "anthropic",
  });
  searchJobsMock.mockResolvedValue(makeSearchResponse());

  // Default DB: profile found, empty matches & hashes
  setupDbResults([{ id: "profile-1" }], [], []);
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

describe("POST /api/scoring/trigger -- authentication", () => {
  test("unauthenticated request returns 401", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const { status, body } = await postJson();

    expect(status).toBe(401);
    expect(body.error).toBe("Authentication required");
  });

  test("session without user property returns 401", async () => {
    getSessionMock.mockResolvedValueOnce({
      session: { token: "tok" },
    });
    setupDbResults([], [], []);

    const { status, body } = await postJson();

    expect(status).toBe(401);
    expect(body.error).toBe("Authentication required");
  });
});

// ---------------------------------------------------------------------------
// Profile lookup
// ---------------------------------------------------------------------------

describe("POST /api/scoring/trigger -- profile lookup", () => {
  test("authenticated user without profile returns 404", async () => {
    setupDbResults([], [], []);

    const { status, body } = await postJson();

    expect(status).toBe(404);
    expect(body.error).toBe("User profile not found");
  });

  test("profile DB query throws returns 500 without internal details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbSelectResults.length = 0;
    // Profile query rejects (returned from .limit() in the chain)
    dbSelectResults.push(Promise.reject(new Error("connection refused")));

    const { status, body } = await postJson();

    expect(status).toBe(500);
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("connection refused");

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// API key check
// ---------------------------------------------------------------------------

describe("POST /api/scoring/trigger -- API key check", () => {
  test("no active API key returns 400", async () => {
    getActiveKeyMetaMock.mockResolvedValueOnce(null);

    const { status, body } = await postJson();

    expect(status).toBe(400);
    expect(body.error).toContain("No active API key");
  });

  test("getActiveKeyMeta throws returns 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getActiveKeyMetaMock.mockRejectedValueOnce(new Error("decrypt failure"));

    const { status, body } = await postJson();

    expect(status).toBe(500);
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("decrypt failure");

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Empty search results
// ---------------------------------------------------------------------------

describe("POST /api/scoring/trigger -- empty search results", () => {
  test("no candidate jobs returns early with zero counts", async () => {
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs: [], total: 0 }),
    );

    const { status, body } = await postJson();

    expect(status).toBe(200);
    expect(body).toEqual({
      enqueued: 0,
      cached: 0,
      total: 0,
      message: "No candidate jobs found.",
    });
    // pg-boss should not be touched at all
    expect(mockGetQueue).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cache partitioning logic
// ---------------------------------------------------------------------------

describe("POST /api/scoring/trigger -- cache partitioning", () => {
  test("all jobs are cache hits -- none enqueued", async () => {
    const jobs = [makeJob("job-1"), makeJob("job-2"), makeJob("job-3")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 3 }),
    );

    setupDbResults(
      [{ id: "profile-1" }],
      // Existing matches: all 3 have matching hashes
      [
        { jobId: "job-1", jobContentHash: "hash-1" },
        { jobId: "job-2", jobContentHash: "hash-2" },
        { jobId: "job-3", jobContentHash: "hash-3" },
      ],
      // Current job hashes: same hashes
      [
        { id: "job-1", descriptionHash: "hash-1" },
        { id: "job-2", descriptionHash: "hash-2" },
        { id: "job-3", descriptionHash: "hash-3" },
      ],
    );

    const { status, body } = await postJson();

    expect(status).toBe(200);
    expect(body).toEqual({
      enqueued: 0,
      cached: 3,
      total: 3,
      message: "Scoring 0 jobs. 3 already scored.",
    });
    // When all cached, getQueue should NOT be called
    expect(mockGetQueue).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test("all jobs are cache misses -- all enqueued", async () => {
    const jobs = [makeJob("job-a"), makeJob("job-b"), makeJob("job-c")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 3 }),
    );

    setupDbResults(
      [{ id: "profile-1" }],
      // No existing matches
      [],
      // Current hashes exist but no matches
      [
        { id: "job-a", descriptionHash: "hash-a" },
        { id: "job-b", descriptionHash: "hash-b" },
        { id: "job-c", descriptionHash: "hash-c" },
      ],
    );

    const { status, body } = await postJson();

    expect(status).toBe(200);
    expect(body).toEqual({
      enqueued: 3,
      cached: 0,
      total: 3,
      message: "Scoring 3 jobs. 0 already scored.",
    });

    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend).toHaveBeenCalledWith(
      "score/llm",
      { jobId: "job-a", userProfileId: "profile-1", userId: "user-1" },
      { singletonKey: "profile-1:job-a" },
    );
    expect(mockSend).toHaveBeenCalledWith(
      "score/llm",
      { jobId: "job-b", userProfileId: "profile-1", userId: "user-1" },
      { singletonKey: "profile-1:job-b" },
    );
    expect(mockSend).toHaveBeenCalledWith(
      "score/llm",
      { jobId: "job-c", userProfileId: "profile-1", userId: "user-1" },
      { singletonKey: "profile-1:job-c" },
    );
  });

  test("mix of cached and uncached jobs", async () => {
    const jobs = [
      makeJob("job-1"),
      makeJob("job-2"),
      makeJob("job-3"),
      makeJob("job-4"),
    ];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 4 }),
    );

    setupDbResults(
      [{ id: "profile-1" }],
      // job-1 and job-3 have matching hashes (cached)
      [
        { jobId: "job-1", jobContentHash: "hash-1" },
        { jobId: "job-3", jobContentHash: "hash-3" },
      ],
      // All jobs have hashes
      [
        { id: "job-1", descriptionHash: "hash-1" },
        { id: "job-2", descriptionHash: "hash-2" },
        { id: "job-3", descriptionHash: "hash-3" },
        { id: "job-4", descriptionHash: "hash-4" },
      ],
    );

    const { status, body } = await postJson();

    expect(status).toBe(200);
    expect(body).toEqual({
      enqueued: 2,
      cached: 2,
      total: 4,
      message: "Scoring 2 jobs. 2 already scored.",
    });

    expect(mockSend).toHaveBeenCalledTimes(2);
    // Only job-2 and job-4 should be enqueued
    expect(mockSend).toHaveBeenCalledWith(
      "score/llm",
      expect.objectContaining({ jobId: "job-2" }),
      expect.objectContaining({ singletonKey: "profile-1:job-2" }),
    );
    expect(mockSend).toHaveBeenCalledWith(
      "score/llm",
      expect.objectContaining({ jobId: "job-4" }),
      expect.objectContaining({ singletonKey: "profile-1:job-4" }),
    );
  });

  test("stale cache -- hash mismatch triggers re-score", async () => {
    const jobs = [makeJob("job-stale")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 1 }),
    );

    setupDbResults(
      [{ id: "profile-1" }],
      // Existing match with old hash
      [{ jobId: "job-stale", jobContentHash: "old-hash" }],
      // Current job has new hash
      [{ id: "job-stale", descriptionHash: "new-hash" }],
    );

    const { status, body } = await postJson();

    expect(status).toBe(200);
    expect(body.enqueued).toBe(1);
    expect(body.cached).toBe(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      "score/llm",
      expect.objectContaining({ jobId: "job-stale" }),
      expect.objectContaining({ singletonKey: "profile-1:job-stale" }),
    );
  });

  test("job with null descriptionHash and no existing match is enqueued", async () => {
    const jobs = [makeJob("job-null-hash")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 1 }),
    );

    setupDbResults(
      [{ id: "profile-1" }],
      // No existing match
      [],
      // Job has null descriptionHash
      [{ id: "job-null-hash", descriptionHash: null }],
    );

    const { status, body } = await postJson();

    expect(status).toBe(200);
    // existingHash is undefined (from Map.get), which is != null -> false
    // So the job goes to jobsToScore
    expect(body.enqueued).toBe(1);
    expect(body.cached).toBe(0);
  });

  test("job with null descriptionHash AND existing match with null jobContentHash is enqueued", async () => {
    // Two nulls should NOT be a cache hit: null means "unknown content"
    const jobs = [makeJob("job-both-null")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 1 }),
    );

    setupDbResults(
      [{ id: "profile-1" }],
      // Existing match with null hash
      [{ jobId: "job-both-null", jobContentHash: null }],
      // Job also has null hash
      [{ id: "job-both-null", descriptionHash: null }],
    );

    const { status, body } = await postJson();

    expect(status).toBe(200);
    // existingHash is null, existingHash != null is false (loose equality: null != null is false)
    // So job goes to jobsToScore -- this is correct behavior
    expect(body.enqueued).toBe(1);
    expect(body.cached).toBe(0);
  });

  test("existing match has hash but job descriptionHash is null -- enqueued for re-score", async () => {
    const jobs = [makeJob("job-desc-reset")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 1 }),
    );

    setupDbResults(
      [{ id: "profile-1" }],
      // Old match has a hash
      [{ jobId: "job-desc-reset", jobContentHash: "abc123" }],
      // Current job's description was cleared/reset
      [{ id: "job-desc-reset", descriptionHash: null }],
    );

    const { status, body } = await postJson();

    expect(status).toBe(200);
    // existingHash ("abc123") != null is true, but "abc123" === null is false
    // Job goes to jobsToScore
    expect(body.enqueued).toBe(1);
    expect(body.cached).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// pg-boss enqueue
// ---------------------------------------------------------------------------

describe("POST /api/scoring/trigger -- pg-boss enqueue", () => {
  test("queue is created before sending", async () => {
    const jobs = [makeJob("job-q")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 1 }),
    );
    setupDbResults([{ id: "profile-1" }], [], [{ id: "job-q", descriptionHash: "h" }]);

    await postJson();

    // createQueue must be called before send
    const createQueueOrder = mockCreateQueue.mock.invocationCallOrder[0];
    const sendOrder = mockSend.mock.invocationCallOrder[0];
    expect(createQueueOrder).toBeLessThan(sendOrder);
    expect(mockCreateQueue).toHaveBeenCalledWith("score/llm");
  });

  test("each job is sent with correct payload and singletonKey", async () => {
    const jobs = [makeJob("job-a"), makeJob("job-b")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 2 }),
    );
    setupDbResults(
      [{ id: "profile-1" }],
      [],
      [
        { id: "job-a", descriptionHash: "ha" },
        { id: "job-b", descriptionHash: "hb" },
      ],
    );

    await postJson();

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenNthCalledWith(
      1,
      "score/llm",
      { jobId: "job-a", userProfileId: "profile-1", userId: "user-1" },
      { singletonKey: "profile-1:job-a" },
    );
    expect(mockSend).toHaveBeenNthCalledWith(
      2,
      "score/llm",
      { jobId: "job-b", userProfileId: "profile-1", userId: "user-1" },
      { singletonKey: "profile-1:job-b" },
    );
  });

  test("boss.send fails mid-loop -- partial success with sendFailed count", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const jobs = [makeJob("job-ok"), makeJob("job-fail"), makeJob("job-skip")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 3 }),
    );
    setupDbResults(
      [{ id: "profile-1" }],
      [],
      [
        { id: "job-ok", descriptionHash: "h1" },
        { id: "job-fail", descriptionHash: "h2" },
        { id: "job-skip", descriptionHash: "h3" },
      ],
    );

    mockSend
      .mockResolvedValueOnce("job-id-ok")
      .mockRejectedValueOnce(new Error("queue full"))
      .mockResolvedValueOnce("job-id-skip");

    const { status, body } = await postJson();

    expect(status).toBe(200);
    expect(body.enqueued).toBe(2);
    expect(body.sendFailed).toBe(1);
    expect(body.total).toBe(3);
    expect(body.message).toContain("1 failed to enqueue");

    warnSpy.mockRestore();
  });

  test("getQueue fails returns 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const jobs = [makeJob("job-x")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 1 }),
    );
    setupDbResults([{ id: "profile-1" }], [], [{ id: "job-x", descriptionHash: "h" }]);

    mockGetQueue.mockRejectedValueOnce(
      new Error("DATABASE_URL is required"),
    );

    const { status, body } = await postJson();

    expect(status).toBe(500);
    expect(body.error).toBe("Internal server error");

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Response shape and searchJobs arguments
// ---------------------------------------------------------------------------

describe("POST /api/scoring/trigger -- response shape", () => {
  test("successful response includes all expected fields", async () => {
    const jobs = [makeJob("job-1"), makeJob("job-2"), makeJob("job-3")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 3 }),
    );

    setupDbResults(
      [{ id: "profile-1" }],
      // 1 cached
      [{ jobId: "job-1", jobContentHash: "h1" }],
      [
        { id: "job-1", descriptionHash: "h1" },
        { id: "job-2", descriptionHash: "h2" },
        { id: "job-3", descriptionHash: "h3" },
      ],
    );

    const { status, body } = await postJson();

    expect(status).toBe(200);
    // Verify all four keys exist and have correct types
    expect(typeof body.enqueued).toBe("number");
    expect(typeof body.cached).toBe("number");
    expect(typeof body.total).toBe("number");
    expect(typeof body.message).toBe("string");
    // total === enqueued + cached
    expect(body.total).toBe((body.enqueued as number) + (body.cached as number));
    // Message follows the template
    expect(body.message).toBe(
      `Scoring ${body.enqueued as number} jobs. ${body.cached as number} already scored.`,
    );
  });

  test("searchJobs is called with hardcoded limit 200 and offset 0", async () => {
    await postJson();

    expect(searchJobsMock).toHaveBeenCalledWith(
      expect.anything(),
      "profile-1",
      { limit: 200, offset: 0 },
    );
  });
});

// ---------------------------------------------------------------------------
// Negative / failure scenarios
// ---------------------------------------------------------------------------

describe("POST /api/scoring/trigger -- failure scenarios", () => {
  test("cache check queries fail (Promise.all rejects) returns 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const jobs = [makeJob("job-1")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 1 }),
    );

    // Profile succeeds, but one of the Promise.all queries rejects
    dbSelectResults.length = 0;
    dbSelectResults.push([{ id: "profile-1" }]);
    dbSelectResults.push(Promise.reject(new Error("connection reset")));
    dbSelectResults.push([{ id: "job-1", descriptionHash: "h1" }]);

    const { status, body } = await postJson();

    expect(status).toBe(500);
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("connection reset");

    errorSpy.mockRestore();
  });

  test("searchJobs throws returns 500 without internal details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    searchJobsMock.mockRejectedValueOnce(new Error("query syntax error"));

    const { status, body } = await postJson();

    expect(status).toBe(500);
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("query syntax error");

    errorSpy.mockRestore();
  });

  test("boss.createQueue fails returns 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const jobs = [makeJob("job-1")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 1 }),
    );
    setupDbResults([{ id: "profile-1" }], [], [{ id: "job-1", descriptionHash: "h" }]);

    mockCreateQueue.mockRejectedValueOnce(new Error("permission denied"));

    const { status, body } = await postJson();

    expect(status).toBe(500);
    expect(body.error).toBe("Internal server error");

    errorSpy.mockRestore();
  });

  test("boss.send rejects on first call -- returns 200 with all failed", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const jobs = [makeJob("job-1")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 1 }),
    );
    setupDbResults([{ id: "profile-1" }], [], [{ id: "job-1", descriptionHash: "h" }]);

    mockSend.mockRejectedValueOnce(new Error("queue not found"));

    const { status, body } = await postJson();

    expect(status).toBe(200);
    expect(body.enqueued).toBe(0);
    expect(body.sendFailed).toBe(1);
    expect(body.total).toBe(1);

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Corner cases
// ---------------------------------------------------------------------------

describe("POST /api/scoring/trigger -- corner cases", () => {
  test("orphan job ID in search results but not in hash query is still enqueued", async () => {
    // Race condition: job deleted between search and hash lookup
    const jobs = [makeJob("orphan-job")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 1 }),
    );

    setupDbResults(
      [{ id: "profile-1" }],
      // No existing match
      [],
      // Hash query does NOT return this job (deleted between queries)
      [],
    );

    const { status, body } = await postJson();

    expect(status).toBe(200);
    // hashByJobId.get("orphan-job") returns undefined
    // matchByJobId.get("orphan-job") returns undefined
    // existingHash (undefined) != null is false -> job goes to jobsToScore
    expect(body.enqueued).toBe(1);
    expect(body.cached).toBe(0);
  });

  test("zero enqueued, zero cached message format", async () => {
    // All 3 jobs are cached -> "Scoring 0 jobs. 3 already scored."
    const jobs = [makeJob("j1"), makeJob("j2"), makeJob("j3")];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 3 }),
    );

    setupDbResults(
      [{ id: "profile-1" }],
      [
        { jobId: "j1", jobContentHash: "h1" },
        { jobId: "j2", jobContentHash: "h2" },
        { jobId: "j3", jobContentHash: "h3" },
      ],
      [
        { id: "j1", descriptionHash: "h1" },
        { id: "j2", descriptionHash: "h2" },
        { id: "j3", descriptionHash: "h3" },
      ],
    );

    const { body } = await postJson();

    expect(body.message).toBe("Scoring 0 jobs. 3 already scored.");
  });
});

// ---------------------------------------------------------------------------
// Integration: full happy path
// ---------------------------------------------------------------------------

describe("POST /api/scoring/trigger -- integration", () => {
  test("full happy path: auth + key + some cached + some new", async () => {
    const jobs = [
      makeJob("job-1"),
      makeJob("job-2"),
      makeJob("job-3"),
      makeJob("job-4"),
      makeJob("job-5"),
    ];
    searchJobsMock.mockResolvedValueOnce(
      makeSearchResponse({ jobs, total: 5 }),
    );

    setupDbResults(
      [{ id: "profile-1" }],
      // 2 cached (job-1, job-4 have matching hashes)
      [
        { jobId: "job-1", jobContentHash: "h1" },
        { jobId: "job-4", jobContentHash: "h4" },
      ],
      [
        { id: "job-1", descriptionHash: "h1" },
        { id: "job-2", descriptionHash: "h2" },
        { id: "job-3", descriptionHash: "h3" },
        { id: "job-4", descriptionHash: "h4" },
        { id: "job-5", descriptionHash: "h5" },
      ],
    );

    const { status, body } = await postJson();

    expect(status).toBe(200);
    expect(body).toEqual({
      enqueued: 3,
      cached: 2,
      total: 5,
      message: "Scoring 3 jobs. 2 already scored.",
    });

    // Verify auth was checked
    expect(getSessionMock).toHaveBeenCalledTimes(1);
    // Verify API key was checked
    expect(getActiveKeyMetaMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "anthropic",
    );
    // Verify searchJobs called with correct args
    expect(searchJobsMock).toHaveBeenCalledWith(
      expect.anything(),
      "profile-1",
      { limit: 200, offset: 0 },
    );
    // Verify enqueue calls
    expect(mockCreateQueue).toHaveBeenCalledWith("score/llm");
    expect(mockSend).toHaveBeenCalledTimes(3);
  });
});
