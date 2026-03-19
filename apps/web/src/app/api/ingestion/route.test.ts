// ---- Mocks ----------------------------------------------------------------

vi.mock("@/lib/db", () => ({ db: {} }));

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

vi.mock("@/lib/ingestion/run-ingestion", () => ({
  runIngestion: vi.fn(),
}));

// Re-import after mock registration so the module binds to the mock.
import { runIngestion } from "@/lib/ingestion/run-ingestion";
import { POST } from "./route";

const runIngestionMock = runIngestion as ReturnType<typeof vi.fn>;

// ---- Helpers ---------------------------------------------------------------

const adminSession = { user: { id: "u1", role: "admin" }, session: {} };

function makeRequest(body?: unknown): Request {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request("http://localhost/api/ingestion", init);
}

const FAKE_RESULT = {
  totalCompanies: 2,
  successful: 2,
  failed: 0,
  totalJobsNew: 5,
  totalJobsClosed: 1,
  totalJobsUpdated: 3,
  durationMs: 100,
  errors: [],
};

// ---- Setup -----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(adminSession);
  runIngestionMock.mockResolvedValue(FAKE_RESULT);
});

// ---- Tests -----------------------------------------------------------------

describe("POST /api/ingestion", () => {
  test("returns 403 when not authenticated", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(403);
  });

  test("returns 403 when user is not admin", async () => {
    getSessionMock.mockResolvedValueOnce({ user: { id: "u2", role: "user" }, session: {} });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(403);
  });

  test("forwards concurrency and companyIds to runIngestion", async () => {
    const req = makeRequest({ concurrency: 3, companyIds: ["c-1", "c-2"] });

    await POST(req);

    expect(runIngestionMock).toHaveBeenCalledWith(
      expect.anything(), // db
      { concurrency: 3, companyIds: ["c-1", "c-2"] }
    );
  });

  test("defaults concurrency to 5 when not provided in body", async () => {
    const req = makeRequest({});

    await POST(req);

    expect(runIngestionMock).toHaveBeenCalledWith(
      expect.anything(),
      { concurrency: 5, companyIds: undefined }
    );
  });

  test.each([
    ["invalid JSON body", new Request("http://localhost/api/ingestion", { method: "POST", body: "not json" })],
    ["missing body (no Content-Type)", new Request("http://localhost/api/ingestion", { method: "POST" })],
  ])("handles %s gracefully and uses defaults", async (_label, req) => {
    await POST(req);

    expect(runIngestionMock).toHaveBeenCalledWith(
      expect.anything(),
      { concurrency: 5, companyIds: undefined }
    );
  });

  test("returns 200 with success: true and spread result on success", async () => {
    const req = makeRequest({});

    const res = await POST(req);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json: Record<string, unknown> = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, ...FAKE_RESULT });
  });

  test.each([
    ["Error instance", new Error("db connection lost"), "db connection lost"],
    ["non-Error string", "unexpected string error", "unexpected string error"],
  ])(
    "returns 500 with success: false when runIngestion throws %s",
    async (_label, thrown, expectedMsg) => {
      runIngestionMock.mockRejectedValueOnce(thrown);
      const req = makeRequest({});

      const res = await POST(req);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json: Record<string, unknown> = await res.json();

      expect(res.status).toBe(500);
      expect(json).toEqual({ success: false, error: expectedMsg });
    }
  );
});
