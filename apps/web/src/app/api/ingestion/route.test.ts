// ---- Mocks ----------------------------------------------------------------

vi.mock("@/lib/db", () => ({ db: {} }));

vi.mock("@/lib/ingestion/run-ingestion", () => ({
  runIngestion: vi.fn(),
}));

// Re-import after mock registration so the module binds to the mock.
import { runIngestion } from "@/lib/ingestion/run-ingestion";
import { POST } from "./route";

const runIngestionMock = runIngestion as ReturnType<typeof vi.fn>;

// ---- Helpers ---------------------------------------------------------------

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
  runIngestionMock.mockResolvedValue(FAKE_RESULT);
});

// ---- Tests -----------------------------------------------------------------

describe("POST /api/ingestion", () => {
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

  test("handles invalid JSON body gracefully and uses defaults", async () => {
    const req = new Request("http://localhost/api/ingestion", {
      method: "POST",
      body: "not json",
    });

    await POST(req);

    expect(runIngestionMock).toHaveBeenCalledWith(
      expect.anything(),
      { concurrency: 5, companyIds: undefined }
    );
  });

  test("returns 200 with success: true and spread result on success", async () => {
    const req = makeRequest({});

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ success: true, ...FAKE_RESULT });
  });

  test("returns 500 with success: false when runIngestion throws an Error", async () => {
    runIngestionMock.mockRejectedValueOnce(new Error("db connection lost"));
    const req = makeRequest({});

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ success: false, error: "db connection lost" });
  });

  test("stringifies non-Error thrown values in the error response", async () => {
    runIngestionMock.mockRejectedValueOnce("unexpected string error");
    const req = makeRequest({});

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json).toEqual({ success: false, error: "unexpected string error" });
  });

  test("handles missing body (no Content-Type) gracefully", async () => {
    const req = new Request("http://localhost/api/ingestion", {
      method: "POST",
    });

    await POST(req);

    expect(runIngestionMock).toHaveBeenCalledWith(
      expect.anything(),
      { concurrency: 5, companyIds: undefined }
    );
  });
});
