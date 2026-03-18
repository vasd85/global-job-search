import type { FetchResult } from "../utils/http";
import { createEmptyDiagnostics } from "../types";
import type { Diagnostics } from "../types";

// ---------------------------------------------------------------------------
// Mock fetchText — the sole external dependency of fetchJson
// ---------------------------------------------------------------------------

const mockFetchText = vi.fn<() => Promise<FetchResult>>();

vi.mock("../utils/http", () => ({
  fetchText: (...args: unknown[]) => mockFetchText(...(args as [])),
}));

// Import after mock setup so the module picks up the mocked fetchText
const { fetchJson } = await import("./common");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDiagnostics(): Diagnostics {
  return createEmptyDiagnostics();
}

function okFetchResult(body: string, overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    ok: true,
    status: 200,
    url: "https://api.example.com/jobs",
    body,
    contentType: "application/json",
    error: null,
    ...overrides,
  };
}

function errorFetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    ok: false,
    status: null,
    url: "https://api.example.com/jobs",
    body: null,
    contentType: null,
    error: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// fetchJson
// ---------------------------------------------------------------------------

describe("fetchJson", () => {
  beforeEach(() => {
    mockFetchText.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---- Happy path: successful JSON parsing --------------------------------

  describe("returns parsed JSON data on successful fetch", () => {
    test.each([
      ["an object", JSON.stringify({ title: "Engineer", location: "Remote" }), { title: "Engineer", location: "Remote" }],
      ["an array", JSON.stringify([{ id: 1 }, { id: 2 }]), [{ id: 1 }, { id: 2 }]],
      ["a number", "42", 42],
      ["a string", '"hello"', "hello"],
      ["a boolean", "true", true],
      // NOTE: when body is "null", data will be null. The result shape is
      // { data: null, error: null } which is indistinguishable from an error
      // return where error is also null — callers should be aware.
      // TODO: fetchJson returns { data: null, error: null } for JSON-null,
      // making it impossible for callers to distinguish "fetched null" from
      // certain error paths. Consider a discriminated union or ok flag.
      ["null", "null", null],
    ])("parses %s as valid JSON", async (_label, body, expected) => {
      mockFetchText.mockResolvedValueOnce(okFetchResult(body as string));

      const result = await fetchJson("https://api.example.com/jobs", makeDiagnostics(), 5_000, 0);

      expect(result.data).toEqual(expected);
      expect(result.error).toBeNull();
    });
  });

  // ---- Argument forwarding to fetchText -----------------------------------

  describe("forwards arguments to fetchText correctly", () => {
    test("passes url, timeoutMs, maxRetries, and diagnostics", async () => {
      const diag = makeDiagnostics();
      mockFetchText.mockResolvedValueOnce(okFetchResult("{}"));

      await fetchJson("https://api.example.com/jobs", diag, 8_000, 3);

      expect(mockFetchText).toHaveBeenCalledOnce();
      expect(mockFetchText).toHaveBeenCalledWith(
        "https://api.example.com/jobs",
        expect.objectContaining({
          timeoutMs: 8_000,
          maxRetries: 3,
          diagnostics: diag,
        }),
      );
    });

    test("passes optional maxAttempts when provided", async () => {
      const diag = makeDiagnostics();
      mockFetchText.mockResolvedValueOnce(okFetchResult("{}"));

      await fetchJson("https://api.example.com/jobs", diag, 5_000, 1, 10);

      expect(mockFetchText).toHaveBeenCalledWith("https://api.example.com/jobs", {
        timeoutMs: 5_000,
        maxRetries: 1,
        maxAttempts: 10,
        diagnostics: diag,
      });
    });
  });

  // ---- Non-ok fetch result handling ---------------------------------------

  describe("returns an error when fetchText reports a non-ok result", () => {
    test("uses the error string from fetchText when available", async () => {
      mockFetchText.mockResolvedValueOnce(
        errorFetchResult({ error: "ECONNREFUSED" }),
      );

      const result = await fetchJson(
        "https://api.example.com/jobs",
        makeDiagnostics(),
        5_000,
        0,
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe("ECONNREFUSED");
    });

    test("falls back to 'non-200 response: <status>' when error is null but status exists", async () => {
      mockFetchText.mockResolvedValueOnce(
        errorFetchResult({ status: 404, error: null }),
      );

      const result = await fetchJson(
        "https://api.example.com/jobs",
        makeDiagnostics(),
        5_000,
        0,
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe("non-200 response: 404");
    });

    test.each([
      [403, "non-200 response: 403"],
      [500, "non-200 response: 500"],
      [502, "non-200 response: 502"],
    ])("reports status %i as '%s'", async (status, expectedError) => {
      mockFetchText.mockResolvedValueOnce(
        errorFetchResult({ status, error: null }),
      );

      const result = await fetchJson("https://api.example.com/jobs", makeDiagnostics(), 5_000, 0);

      expect(result.data).toBeNull();
      expect(result.error).toBe(expectedError);
    });

    test("falls back to 'unknown fetch failure' when both error and status are absent", async () => {
      mockFetchText.mockResolvedValueOnce(
        errorFetchResult({ status: null, error: null }),
      );

      const result = await fetchJson(
        "https://api.example.com/jobs",
        makeDiagnostics(),
        5_000,
        0,
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe("unknown fetch failure");
    });

    test("treats a response with ok: false and non-null body as an error (body is ignored)", async () => {
      // fetchText can return ok: false with a body (e.g. a 404 HTML page).
      // fetchJson should still report an error and not attempt to parse.
      mockFetchText.mockResolvedValueOnce({
        ok: false,
        status: 404,
        url: "https://api.example.com/jobs",
        body: "<html>Not Found</html>",
        contentType: "text/html",
        error: null,
      });

      const result = await fetchJson(
        "https://api.example.com/jobs",
        makeDiagnostics(),
        5_000,
        0,
      );

      expect(result.data).toBeNull();
      expect(result.error).toBe("non-200 response: 404");
    });
  });

  // ---- Null / falsy body handling ------------------------------------------
  // The condition `!response.body` treats both null and empty string as
  // missing, since "" is falsy in JavaScript.

  describe("returns an error when fetch is ok but body is null or empty", () => {
    // TODO: When ok is true and body is null/empty, the error message will be
    // "non-200 response: 200" which is misleading. The condition should
    // arguably separate the ok-check from the body-null check.
    test.each([
      ["null", null],
      ["empty string", ""],
    ])("reports status-based error when body is %s despite ok: true", async (_label, body) => {
      mockFetchText.mockResolvedValueOnce(
        okFetchResult("placeholder", { body, status: 200 }),
      );

      const result = await fetchJson("https://api.example.com/jobs", makeDiagnostics(), 5_000, 0);

      expect(result.data).toBeNull();
      expect(result.error).toBe("non-200 response: 200");
    });
  });

  // ---- Invalid JSON handling ----------------------------------------------

  describe("returns an error when the response body is not valid JSON", () => {
    test.each([
      ["plain HTML", "<html><body>Hello</body></html>"],
      ["truncated JSON object", '{"title": "Engineer"'],
      ["trailing comma in object", '{"a": 1,}'],
      ["plain text", "not json at all"],
      // Adversarial near-miss: looks like JSON but has invalid syntax
      ["single-quoted keys", "{'key': 'value'}"],
    ])("rejects %s with an 'invalid json' error", async (_label, body) => {
      mockFetchText.mockResolvedValueOnce(okFetchResult(body));

      const result = await fetchJson("https://api.example.com/jobs", makeDiagnostics(), 5_000, 0);

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/^invalid json/);
    });

    test("includes the original SyntaxError message in the error string", async () => {
      mockFetchText.mockResolvedValueOnce(okFetchResult("{bad json}"));

      const result = await fetchJson(
        "https://api.example.com/jobs",
        makeDiagnostics(),
        5_000,
        0,
      );

      expect(result.data).toBeNull();
      // The error should start with "invalid json: " followed by the SyntaxError message
      expect(result.error).toMatch(/^invalid json: /);
      expect(result.error!.length).toBeGreaterThan("invalid json: ".length);
    });
  });

});
