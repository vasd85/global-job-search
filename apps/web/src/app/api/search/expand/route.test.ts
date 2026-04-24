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

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: string, val: unknown) => `eq(${col},${String(val)})`),
}));

vi.mock("@/lib/db/schema", () => ({
  userProfiles: {
    id: "userProfiles.id",
    userId: "userProfiles.userId",
  },
}));

// DB mock: the route makes exactly one select call (profile lookup)
// via db.select().from().where().limit()
const mockDbSelect = vi.fn();

function setupProfileResult(result: unknown) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(result),
      }),
    }),
  });
}

vi.mock("@/lib/db", () => ({
  db: {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

const mockSend = vi.fn();
const mockCreateQueue = vi.fn().mockResolvedValue(undefined);
const mockBoss = { send: mockSend, createQueue: mockCreateQueue };
const mockGetQueue = vi.fn().mockResolvedValue(mockBoss);
vi.mock("@/lib/queue", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  getQueue: (...args: unknown[]) => mockGetQueue(...args),
}));

vi.mock("@gjs/ingestion", () => ({
  FUTURE_QUEUES: {
    internetExpansion: "expand/internet",
  },
}));

import { POST } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const userSession = {
  user: { id: "user-1" },
  session: { token: "tok" },
};

function makeRequest(): Request {
  return new Request("http://localhost/api/search/expand", { method: "POST" });
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: authenticated user with profile and active API key
  getSessionMock.mockResolvedValue(userSession);
  setupProfileResult([{ id: "profile-1" }]);
  getActiveKeyMetaMock.mockResolvedValue({ id: "key-1", provider: "anthropic" });
  mockSend.mockResolvedValue("job-uuid-123");
});

// ---------------------------------------------------------------------------
// Authentication gate
// ---------------------------------------------------------------------------

describe("POST /api/search/expand -- authentication", () => {
  test("unauthenticated request (null session) returns 401", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const { status, body } = await postJson();

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Authentication required" });
  });

  test("session without user property returns 401", async () => {
    getSessionMock.mockResolvedValueOnce({ session: { token: "tok" } });

    const { status, body } = await postJson();

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Authentication required" });
  });

  test("session with user but no user.id returns 401", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { name: "Test" },
      session: { token: "tok" },
    });

    const { status, body } = await postJson();

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Authentication required" });
  });

  test("session with empty-string user.id returns 401", async () => {
    // Empty string is falsy in JS, so !session?.user?.id should catch it
    getSessionMock.mockResolvedValueOnce({
      user: { id: "" },
      session: { token: "tok" },
    });

    const { status, body } = await postJson();

    expect(status).toBe(401);
    expect(body).toEqual({ error: "Authentication required" });
  });
});

// ---------------------------------------------------------------------------
// Profile lookup
// ---------------------------------------------------------------------------

describe("POST /api/search/expand -- profile lookup", () => {
  test("authenticated user without a profile returns 404", async () => {
    mockDbSelect.mockReset();
    setupProfileResult([]);

    const { status, body } = await postJson();

    expect(status).toBe(404);
    expect(body).toEqual({ error: "User profile not found" });
  });

  test("profile DB query throws returns 500 without internal details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Override the default profile mock with a rejecting chain
    mockDbSelect.mockReset();
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockRejectedValue(new Error("connection refused")),
        }),
      }),
    });

    const { status, body } = await postJson();

    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(body)).not.toContain("connection refused");

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// API key check
// ---------------------------------------------------------------------------

describe("POST /api/search/expand -- API key check", () => {
  test("no active API key returns 400", async () => {
    getActiveKeyMetaMock.mockResolvedValueOnce(null);

    const { status, body } = await postJson();

    expect(status).toBe(400);
    expect(body).toEqual({
      error: "No active API key. Add your Anthropic API key in settings.",
    });
  });

  test("getActiveKeyMeta throws returns 500 without internal details", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getActiveKeyMetaMock.mockRejectedValueOnce(new Error("decrypt failure"));

    const { status, body } = await postJson();

    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(body)).not.toContain("decrypt failure");

    errorSpy.mockRestore();
  });

  test("getActiveKeyMeta is called with correct arguments", async () => {
    await postJson();

    expect(getActiveKeyMetaMock).toHaveBeenCalledWith(
      expect.anything(), // db instance
      "user-1",
      "anthropic",
    );
  });
});

// ---------------------------------------------------------------------------
// pg-boss enqueue
// ---------------------------------------------------------------------------

describe("POST /api/search/expand -- pg-boss enqueue", () => {
  test("successful enqueue returns 200 with queued status", async () => {
    mockSend.mockResolvedValueOnce("job-uuid-123");

    const { status, body } = await postJson();

    expect(status).toBe(200);
    expect(body).toEqual({ status: "queued", message: "Expanding search..." });
  });

  test("singletonKey conflict (expansion already in progress) returns 409", async () => {
    mockSend.mockResolvedValueOnce(null);

    const { status, body } = await postJson();

    expect(status).toBe(409);
    expect(body).toEqual({ error: "Search expansion already in progress" });
  });

  test("boss.send is called with correct queue name, payload, and options", async () => {
    await postJson();

    expect(mockSend).toHaveBeenCalledWith(
      "expand/internet",
      { userId: "user-1", userProfileId: "profile-1" },
      { singletonKey: "expand:user-1" },
    );
  });

  test("createQueue is called before send with correct queue name", async () => {
    await postJson();

    const createQueueOrder = mockCreateQueue.mock.invocationCallOrder[0];
    const sendOrder = mockSend.mock.invocationCallOrder[0];
    expect(createQueueOrder).toBeLessThan(sendOrder);
    expect(mockCreateQueue).toHaveBeenCalledWith("expand/internet");
  });

  test("getQueue fails returns 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetQueue.mockRejectedValueOnce(new Error("DATABASE_URL is required"));

    const { status, body } = await postJson();

    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });

    errorSpy.mockRestore();
  });

  test("boss.createQueue fails returns 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCreateQueue.mockRejectedValueOnce(new Error("permission denied"));

    const { status, body } = await postJson();

    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });

    errorSpy.mockRestore();
  });

  test("boss.send throws (as opposed to returning null) returns 500", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSend.mockRejectedValueOnce(new Error("serialization error"));

    const { status, body } = await postJson();

    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Error isolation and logging
// ---------------------------------------------------------------------------

describe("POST /api/search/expand -- error isolation", () => {
  test("error response body never contains stack traces or internal paths", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetQueue.mockRejectedValueOnce(
      new Error("pg: connection to server at /tmp/.s.PGSQL.5432 refused"),
    );

    const { body } = await postJson();

    const bodyStr = JSON.stringify(body);
    expect(body).toEqual({ error: "Internal server error" });
    expect(bodyStr).not.toContain("pg:");
    expect(bodyStr).not.toContain("connection");
    expect(bodyStr).not.toContain("/tmp/");

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Guard chain ordering
// ---------------------------------------------------------------------------

describe("POST /api/search/expand -- guard chain ordering", () => {
  test("401 is returned before profile query runs", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const { status } = await postJson();

    expect(status).toBe(401);
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  test("404 is returned before API key check runs", async () => {
    mockDbSelect.mockReset();
    setupProfileResult([]);

    const { status } = await postJson();

    expect(status).toBe(404);
    expect(getActiveKeyMetaMock).not.toHaveBeenCalled();
  });

  test("400 is returned before pg-boss interaction", async () => {
    getActiveKeyMetaMock.mockResolvedValueOnce(null);

    const { status } = await postJson();

    expect(status).toBe(400);
    expect(mockGetQueue).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Corner cases
// ---------------------------------------------------------------------------

describe("POST /api/search/expand -- corner cases", () => {
  test("user ID with colons in singletonKey is preserved literally", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "user:with:colons" },
      session: { token: "tok" },
    });
    // Profile mock from beforeEach is consumed; add one for this call
    setupProfileResult([{ id: "profile-1" }]);

    await postJson();

    expect(mockSend).toHaveBeenCalledWith(
      "expand/internet",
      expect.objectContaining({ userId: "user:with:colons" }),
      { singletonKey: "expand:user:with:colons" },
    );
  });

  test("UUID-style user ID in singletonKey", async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: "550e8400-e29b-41d4-a716-446655440000" },
      session: { token: "tok" },
    });

    await postJson();

    expect(mockSend).toHaveBeenCalledWith(
      "expand/internet",
      expect.objectContaining({ userId: "550e8400-e29b-41d4-a716-446655440000" }),
      { singletonKey: "expand:550e8400-e29b-41d4-a716-446655440000" },
    );
  });

  test("200 response shape has exactly status and message keys", async () => {
    const { status, body } = await postJson();

    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["message", "status"]);
  });

  test("409 response shape has only error key", async () => {
    mockSend.mockResolvedValueOnce(null);

    const { status, body } = await postJson();

    expect(status).toBe(409);
    expect(Object.keys(body)).toEqual(["error"]);
  });

  test("two sequential requests: first succeeds, second gets 409", async () => {
    mockSend
      .mockResolvedValueOnce("job-uuid-1")
      .mockResolvedValueOnce(null);

    const first = await postJson();
    setupProfileResult([{ id: "profile-1" }]);
    const second = await postJson();

    expect(first.status).toBe(200);
    expect(first.body).toEqual({ status: "queued", message: "Expanding search..." });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: "Search expansion already in progress" });
  });
});

// ---------------------------------------------------------------------------
// Cascading dependency failures
// ---------------------------------------------------------------------------

describe("POST /api/search/expand -- cascading failures", () => {
  test("auth service throwing returns 500 with structured error", async () => {
    getSessionMock.mockRejectedValueOnce(new Error("auth service unavailable"));

    const res = await POST(makeRequest());
    expect(res.status).toBe(500);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const body: Record<string, unknown> = await res.json();
    expect(body).toEqual({ error: "Internal server error" });
  });
});

// ---------------------------------------------------------------------------
// Integration: full happy path
// ---------------------------------------------------------------------------

describe("POST /api/search/expand -- integration", () => {
  test("authenticated user with profile and API key -- job enqueued", async () => {
    const { status, body } = await postJson();

    expect(status).toBe(200);
    expect(body).toEqual({ status: "queued", message: "Expanding search..." });

    // Auth was checked
    expect(getSessionMock).toHaveBeenCalledTimes(1);

    // Profile was queried (DB select was called)
    expect(mockDbSelect).toHaveBeenCalled();

    // API key was checked with correct provider
    expect(getActiveKeyMetaMock).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      "anthropic",
    );

    // Queue was created and job was sent
    expect(mockCreateQueue).toHaveBeenCalledWith("expand/internet");
    expect(mockSend).toHaveBeenCalledWith(
      "expand/internet",
      { userId: "user-1", userProfileId: "profile-1" },
      { singletonKey: "expand:user-1" },
    );
  });
});
