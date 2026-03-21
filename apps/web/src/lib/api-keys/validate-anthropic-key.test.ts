import { validateAnthropicKey } from "./validate-anthropic-key";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
});

function mockResponse(status: number, jsonBody?: unknown) {
  fetchMock.mockResolvedValueOnce({
    status,
    json: jsonBody !== undefined
      ? () => Promise.resolve(jsonBody)
      : () => Promise.reject(new Error("no body")),
  } as Response);
}

describe("validateAnthropicKey", () => {
  test("returns active on 200", async () => {
    mockResponse(200);

    const result = await validateAnthropicKey("sk-ant-test");

    expect(result).toEqual({ valid: true, status: "active" });
  });

  test("returns invalid on 401 with error message from body", async () => {
    mockResponse(401, { error: { message: "invalid x-api-key" } });

    const result = await validateAnthropicKey("sk-ant-bad");

    expect(result).toEqual({
      valid: false,
      status: "invalid",
      errorCode: "401",
      errorMessage: "invalid x-api-key",
    });
  });

  test("returns billing_warning on 402", async () => {
    mockResponse(402);

    const result = await validateAnthropicKey("sk-ant-billing");

    expect(result).toEqual({
      valid: true,
      status: "billing_warning",
      errorCode: "402",
      errorMessage: "Billing issue on this API key",
    });
  });

  test("returns forbidden on 403 with error message from body", async () => {
    mockResponse(403, { error: { message: "Your account is disabled" } });

    const result = await validateAnthropicKey("sk-ant-forbidden");

    expect(result).toEqual({
      valid: false,
      status: "forbidden",
      errorCode: "403",
      errorMessage: "Your account is disabled",
    });
  });

  test("returns rate_limited on 429", async () => {
    mockResponse(429);

    const result = await validateAnthropicKey("sk-ant-rate");

    expect(result).toEqual({ valid: true, status: "rate_limited", errorCode: "429" });
  });

  test("returns invalid on unexpected status code", async () => {
    mockResponse(500);

    const result = await validateAnthropicKey("sk-ant-test");

    expect(result).toEqual({ valid: false, status: "invalid", errorCode: "500" });
  });

  test("returns invalid on network error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("fetch failed"));

    const result = await validateAnthropicKey("sk-ant-test");

    expect(result).toEqual({
      valid: false,
      status: "invalid",
      errorMessage: "fetch failed",
    });
  });

  test("returns 'Network error' when non-Error value is thrown", async () => {
    fetchMock.mockRejectedValueOnce("string-rejection");

    const result = await validateAnthropicKey("sk-ant-test");

    expect(result).toEqual({
      valid: false,
      status: "invalid",
      errorMessage: "Network error",
    });
  });

  test("sends correct headers", async () => {
    mockResponse(200);

    await validateAnthropicKey("sk-ant-my-key");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: {
          "x-api-key": "sk-ant-my-key",
          "anthropic-version": "2023-06-01",
        },
      })
    );
  });

  test("sets a timeout signal on the request", async () => {
    mockResponse(200);

    await validateAnthropicKey("sk-ant-test");

    const callArgs = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(callArgs[1].signal).toBeDefined();
  });

  test("401 with unparseable body falls back to 'Invalid API key'", async () => {
    mockResponse(401); // no JSON body — .json() will reject

    const result = await validateAnthropicKey("sk-ant-bad");

    expect(result).toEqual({
      valid: false,
      status: "invalid",
      errorCode: "401",
      errorMessage: "Invalid API key",
    });
  });

  test("403 with unparseable body falls back to 'Permission denied'", async () => {
    mockResponse(403); // no JSON body — .json() will reject

    const result = await validateAnthropicKey("sk-ant-forbidden");

    expect(result).toEqual({
      valid: false,
      status: "forbidden",
      errorCode: "403",
      errorMessage: "Permission denied",
    });
  });

  test("401 with Anthropic error body extracts message correctly", async () => {
    mockResponse(401, {
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    });

    const result = await validateAnthropicKey("sk-ant-bad");

    expect(result).toEqual({
      valid: false,
      status: "invalid",
      errorCode: "401",
      errorMessage: "invalid x-api-key",
    });
  });

  test("403 with Anthropic error body extracts message correctly", async () => {
    mockResponse(403, {
      type: "error",
      error: { type: "forbidden", message: "Account has been disabled" },
    });

    const result = await validateAnthropicKey("sk-ant-forbidden");

    expect(result).toEqual({
      valid: false,
      status: "forbidden",
      errorCode: "403",
      errorMessage: "Account has been disabled",
    });
  });

  test("401 with JSON body missing error.message falls back to 'Invalid API key'", async () => {
    mockResponse(401, { error: { type: "authentication_error" } });

    const result = await validateAnthropicKey("sk-ant-bad");

    expect(result).toEqual({
      valid: false,
      status: "invalid",
      errorCode: "401",
      errorMessage: "Invalid API key",
    });
  });

  test("403 with JSON body missing error.message falls back to 'Permission denied'", async () => {
    mockResponse(403, { error: { type: "forbidden" } });

    const result = await validateAnthropicKey("sk-ant-forbidden");

    expect(result).toEqual({
      valid: false,
      status: "forbidden",
      errorCode: "403",
      errorMessage: "Permission denied",
    });
  });

  test("401 with empty JSON object falls back to 'Invalid API key'", async () => {
    mockResponse(401, {});

    const result = await validateAnthropicKey("sk-ant-bad");

    expect(result).toEqual({
      valid: false,
      status: "invalid",
      errorCode: "401",
      errorMessage: "Invalid API key",
    });
  });

  test("returns invalid with string status code for unexpected status like 503", async () => {
    mockResponse(503);

    const result = await validateAnthropicKey("sk-ant-test");

    expect(result).toEqual({ valid: false, status: "invalid", errorCode: "503" });
  });
});
