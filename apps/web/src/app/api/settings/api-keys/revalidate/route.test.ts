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

const revalidateApiKeyMock = vi.fn();
vi.mock("@/lib/api-keys/api-key-service", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  revalidateApiKey: (...args: unknown[]) => revalidateApiKeyMock(...args),
}));

// Re-import after mock registration
import { POST } from "./route";

// ---- Helpers --------------------------------------------------------------

const userSession = { user: { id: "u1", role: "user" }, session: {} };

function jsonRequest(body?: unknown): Request {
  const init: RequestInit = { method: "POST" };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request("http://localhost/api/settings/api-keys/revalidate", init);
}

// ---- Setup ----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(userSession);
});

// ---- Tests ----------------------------------------------------------------

describe("POST /api/settings/api-keys/revalidate", () => {
  test("returns 401 when not authenticated", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const res = await POST(jsonRequest({ keyId: "key1" }));

    expect(res.status).toBe(401);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("Authentication required");
  });

  test("returns 400 when body is not valid JSON", async () => {
    const req = new Request("http://localhost/api/settings/api-keys/revalidate", {
      method: "POST",
      body: "not-json",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("Invalid JSON body");
  });

  test("returns 400 when keyId is missing", async () => {
    const res = await POST(jsonRequest({}));

    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("keyId is required");
  });

  test("returns 400 when keyId is empty string", async () => {
    const res = await POST(jsonRequest({ keyId: "" }));

    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("keyId is required");
  });

  test("returns validation result on successful revalidation", async () => {
    revalidateApiKeyMock.mockResolvedValueOnce({ valid: true, status: "active" });

    const res = await POST(jsonRequest({ keyId: "key1" }));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.validation).toEqual({ valid: true, status: "active" });
  });

  test("returns validation result when key becomes invalid", async () => {
    revalidateApiKeyMock.mockResolvedValueOnce({
      valid: false,
      status: "invalid",
      errorCode: "401",
    });

    const res = await POST(jsonRequest({ keyId: "key1" }));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.validation).toEqual({
      valid: false,
      status: "invalid",
      errorCode: "401",
    });
  });

  test("passes user ID from session and keyId to revalidateApiKey", async () => {
    revalidateApiKeyMock.mockResolvedValueOnce({ valid: true, status: "active" });

    await POST(jsonRequest({ keyId: "my-key-id" }));

    // First arg is db (mocked as {}), second is userId, third is keyId
    expect(revalidateApiKeyMock).toHaveBeenCalledWith(
      expect.anything(),
      "u1",
      "my-key-id",
    );
  });

  test("returns 404 when key is not found", async () => {
    revalidateApiKeyMock.mockRejectedValueOnce(new Error("API key not found"));

    const res = await POST(jsonRequest({ keyId: "nonexistent-key" }));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(json.error).toBe("API key not found");
  });

  test("returns 404 with error message when revalidation throws unexpected error", async () => {
    revalidateApiKeyMock.mockRejectedValueOnce(new Error("Decryption failed"));

    const res = await POST(jsonRequest({ keyId: "key1" }));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(json.error).toBe("Decryption failed");
  });

  test("handles non-Error thrown values by converting to string", async () => {
    revalidateApiKeyMock.mockRejectedValueOnce("raw-string-error");

    const res = await POST(jsonRequest({ keyId: "key1" }));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(json.error).toBe("raw-string-error");
  });
});
