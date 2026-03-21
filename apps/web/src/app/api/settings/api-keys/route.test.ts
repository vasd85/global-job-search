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

const addApiKeyMock = vi.fn();
const getCurrentKeyMetaMock = vi.fn();
const revokeApiKeyMock = vi.fn();
vi.mock("@/lib/api-keys/api-key-service", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  addApiKey: (...args: unknown[]) => addApiKeyMock(...args),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  getCurrentKeyMeta: (...args: unknown[]) => getCurrentKeyMetaMock(...args),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  revokeApiKey: (...args: unknown[]) => revokeApiKeyMock(...args),
  ApiKeyValidationError: class extends Error {
    public validation: unknown;
    constructor(validation: unknown) {
      super("API key validation failed");
      this.name = "ApiKeyValidationError";
      this.validation = validation;
    }
  },
  ApiKeyDuplicateError: class extends Error {
    constructor() {
      super("This API key is already active");
      this.name = "ApiKeyDuplicateError";
    }
  },
}));

// Re-import after mock registration
import { GET, POST, DELETE } from "./route";
import { ApiKeyValidationError, ApiKeyDuplicateError } from "@/lib/api-keys/api-key-service";

// ---- Helpers --------------------------------------------------------------

const userSession = { user: { id: "u1", role: "user" }, session: {} };

function jsonRequest(method: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request("http://localhost/api/settings/api-keys", init);
}

// ---- Setup ----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(userSession);
});

// ---- GET tests ------------------------------------------------------------

describe("GET /api/settings/api-keys", () => {
  test("returns 401 when not authenticated", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const res = await GET(jsonRequest("GET"));

    expect(res.status).toBe(401);
  });

  test("returns null when no current key exists", async () => {
    getCurrentKeyMetaMock.mockResolvedValueOnce(null);

    const res = await GET(jsonRequest("GET"));
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.apiKey).toBeNull();
  });

  test("returns key metadata when active key exists", async () => {
    const meta = {
      id: "key1",
      provider: "anthropic",
      maskedHint: "...1234",
      status: "active",
      lastValidatedAt: null,
      lastErrorCode: null,
      createdAt: new Date().toISOString(),
    };
    getCurrentKeyMetaMock.mockResolvedValueOnce(meta);

    const res = await GET(jsonRequest("GET"));
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.apiKey).toEqual(meta);
  });

  test("returns invalid key metadata (visible after failed revalidation)", async () => {
    const meta = {
      id: "key2",
      provider: "anthropic",
      maskedHint: "...5678",
      status: "invalid",
      lastValidatedAt: new Date().toISOString(),
      lastErrorCode: "401",
      createdAt: new Date().toISOString(),
    };
    getCurrentKeyMetaMock.mockResolvedValueOnce(meta);

    const res = await GET(jsonRequest("GET"));
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.apiKey).toEqual(meta);
  });

  test("returns 500 when getCurrentKeyMeta throws", async () => {
    getCurrentKeyMetaMock.mockRejectedValueOnce(new Error("DB connection lost"));

    const res = await GET(jsonRequest("GET"));
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.error).toBe("DB connection lost");
  });

  test("calls getCurrentKeyMeta with correct userId and provider", async () => {
    getCurrentKeyMetaMock.mockResolvedValueOnce(null);

    await GET(jsonRequest("GET"));

    expect(getCurrentKeyMetaMock).toHaveBeenCalledWith(
      expect.anything(), // db
      "u1",
      "anthropic",
    );
  });
});

// ---- POST tests -----------------------------------------------------------

describe("POST /api/settings/api-keys", () => {
  test("returns 401 when not authenticated", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const res = await POST(jsonRequest("POST", { provider: "anthropic", apiKey: "sk-ant-test1234" }));

    expect(res.status).toBe(401);
  });

  test("returns 400 when body is missing", async () => {
    const req = new Request("http://localhost/api/settings/api-keys", {
      method: "POST",
      body: "not-json",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  test("returns 400 when provider or apiKey missing", async () => {
    const res = await POST(jsonRequest("POST", { provider: "anthropic" }));

    expect(res.status).toBe(400);
  });

  test("returns 400 when provider is not anthropic", async () => {
    const res = await POST(jsonRequest("POST", { provider: "openai", apiKey: "sk-test1234567" }));

    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toContain("anthropic");
  });

  test("returns 400 when apiKey is too short", async () => {
    const res = await POST(jsonRequest("POST", { provider: "anthropic", apiKey: "short" }));

    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toContain("Invalid API key format");
  });

  test("returns 400 when apiKey is not a string", async () => {
    const res = await POST(jsonRequest("POST", { provider: "anthropic", apiKey: 12345 }));

    expect(res.status).toBe(400);
  });

  test("returns 200 with key metadata on success", async () => {
    addApiKeyMock.mockResolvedValueOnce({
      id: "new-key-id",
      maskedHint: "...1234",
      status: "active",
      validationStatus: "active",
    });

    const res = await POST(jsonRequest("POST", { provider: "anthropic", apiKey: "sk-ant-test1234" }));
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.apiKey).toEqual({ id: "new-key-id", maskedHint: "...1234", status: "active" });
  });

  test("includes validationStatus in success response", async () => {
    addApiKeyMock.mockResolvedValueOnce({
      id: "key-id",
      maskedHint: "...5678",
      status: "active",
      validationStatus: "billing_warning",
    });

    const res = await POST(jsonRequest("POST", { provider: "anthropic", apiKey: "sk-ant-test5678" }));
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.validationStatus).toBe("billing_warning");
  });

  test("passes correct arguments to addApiKey", async () => {
    addApiKeyMock.mockResolvedValueOnce({
      id: "id",
      maskedHint: "...1234",
      status: "active",
      validationStatus: "active",
    });

    await POST(jsonRequest("POST", { provider: "anthropic", apiKey: "sk-ant-mykey1234" }));

    expect(addApiKeyMock).toHaveBeenCalledWith(
      expect.anything(), // db
      "u1",              // userId from session
      "anthropic",       // provider
      "sk-ant-mykey1234", // apiKey
    );
  });

  test("returns 409 when the same key is already active", async () => {
    addApiKeyMock.mockRejectedValueOnce(new ApiKeyDuplicateError());

    const res = await POST(jsonRequest("POST", { provider: "anthropic", apiKey: "sk-ant-duplicate1234" }));
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(409);
    expect(json.error).toBe("This API key is already active");
  });

  test("returns 422 when key validation fails", async () => {
    const error = new ApiKeyValidationError({ valid: false, status: "invalid", errorCode: "401" });
    addApiKeyMock.mockRejectedValueOnce(error);

    const res = await POST(jsonRequest("POST", { provider: "anthropic", apiKey: "sk-ant-invalid-key" }));

    expect(res.status).toBe(422);
    const json = await res.json() as Record<string, unknown>;
    expect(json.validation).toBeDefined();
  });

  test("returns 500 when addApiKey throws unexpected error", async () => {
    addApiKeyMock.mockRejectedValueOnce(new Error("Encryption key missing"));

    const res = await POST(jsonRequest("POST", { provider: "anthropic", apiKey: "sk-ant-test1234" }));
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.error).toBe("Encryption key missing");
  });
});

// ---- DELETE tests ---------------------------------------------------------

describe("DELETE /api/settings/api-keys", () => {
  test("returns 401 when not authenticated", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const res = await DELETE(jsonRequest("DELETE", { keyId: "key1" }));

    expect(res.status).toBe(401);
  });

  test("returns 400 when body is not valid JSON", async () => {
    const req = new Request("http://localhost/api/settings/api-keys", {
      method: "DELETE",
      body: "not-json",
    });

    const res = await DELETE(req);

    expect(res.status).toBe(400);
    const json = await res.json() as Record<string, unknown>;
    expect(json.error).toBe("Invalid JSON body");
  });

  test("returns 400 when keyId missing", async () => {
    const res = await DELETE(jsonRequest("DELETE", {}));

    expect(res.status).toBe(400);
  });

  test("returns 200 on successful revoke", async () => {
    revokeApiKeyMock.mockResolvedValueOnce(undefined);

    const res = await DELETE(jsonRequest("DELETE", { keyId: "key1" }));
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

  test("returns 404 when key not found", async () => {
    revokeApiKeyMock.mockRejectedValueOnce(new Error("API key not found or already revoked"));

    const res = await DELETE(jsonRequest("DELETE", { keyId: "key-nope" }));

    expect(res.status).toBe(404);
  });

  test("passes correct userId and keyId to revokeApiKey", async () => {
    revokeApiKeyMock.mockResolvedValueOnce(undefined);

    await DELETE(jsonRequest("DELETE", { keyId: "key-to-revoke" }));

    expect(revokeApiKeyMock).toHaveBeenCalledWith(
      expect.anything(), // db
      "u1",              // userId from session
      "key-to-revoke",   // keyId
    );
  });

  test("handles non-Error thrown values by converting to string", async () => {
    revokeApiKeyMock.mockRejectedValueOnce("raw-string-error");

    const res = await DELETE(jsonRequest("DELETE", { keyId: "key1" }));
    const json = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(json.error).toBe("raw-string-error");
  });
});
