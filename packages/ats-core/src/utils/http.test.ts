import { addAttempt, fetchText } from "./http";
import { createEmptyDiagnostics } from "../types";
import type { FetchContext } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<FetchContext> = {}): FetchContext {
  return {
    timeoutMs: 5_000,
    maxRetries: 0,
    ...overrides,
  };
}

function okResponse(body = "<html>OK</html>", overrides: Partial<ResponseInit & { url?: string }> = {}): Response {
  const { url, ...init } = overrides;
  const res = new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    ...init,
  });
  // Response.url is readonly, so we define it via property override
  if (url !== undefined) {
    Object.defineProperty(res, "url", { value: url });
  }
  return res;
}

// ---------------------------------------------------------------------------
// addAttempt
// ---------------------------------------------------------------------------

describe("addAttempt", () => {
  test("records url and increments attempt counter", () => {
    const diag = createEmptyDiagnostics();
    addAttempt(diag, "https://example.com/careers");

    expect(diag.attempted_urls).toEqual(["https://example.com/careers"]);
    expect(diag.attempts).toBe(1);
  });

  test("accumulates across multiple calls", () => {
    const diag = createEmptyDiagnostics();
    addAttempt(diag, "https://a.com");
    addAttempt(diag, "https://b.com");
    addAttempt(diag, "https://c.com");

    expect(diag.attempts).toBe(3);
    expect(diag.attempted_urls).toEqual([
      "https://a.com",
      "https://b.com",
      "https://c.com",
    ]);
  });
});

// ---------------------------------------------------------------------------
// fetchText
// ---------------------------------------------------------------------------

describe("fetchText", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ---- Happy path --------------------------------------------------------

  test("returns successful result for a 200 response", async () => {
    mockFetch.mockResolvedValueOnce(okResponse("<h1>Hello</h1>"));

    const result = await fetchText("https://example.com", makeContext());

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toBe("<h1>Hello</h1>");
    expect(result.contentType).toBe("text/html; charset=utf-8");
    expect(result.error).toBeNull();
  });

  test("uses the response url as the returned url (redirect following)", async () => {
    const redirectedResponse = okResponse("body", { url: "https://example.com/final" });
    mockFetch.mockResolvedValueOnce(redirectedResponse);

    const result = await fetchText("https://example.com/start", makeContext());

    expect(result.url).toBe("https://example.com/final");
  });

  test("falls back to the original url when response.url is empty", async () => {
    const res = okResponse("body");
    Object.defineProperty(res, "url", { value: "" });
    mockFetch.mockResolvedValueOnce(res);

    const result = await fetchText("https://original.com", makeContext());

    expect(result.url).toBe("https://original.com");
  });

  test("passes redirect: follow and correct headers to fetch", async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    await fetchText("https://example.com", makeContext());

    expect(mockFetch).toHaveBeenCalledWith("https://example.com", {
      redirect: "follow",
      headers: {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        "user-agent": expect.stringContaining("Mozilla/5.0"),
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  });

  test.each<[string, string | undefined, string]>([
    ["default", undefined, "Chrome/130.0.0.0"],
    ["custom", "CustomBot/1.0", "CustomBot/1.0"],
  ])("uses %s user agent", async (_label, userAgent, expectedSubstring) => {
    mockFetch.mockResolvedValueOnce(okResponse());

    await fetchText("https://example.com", makeContext({ userAgent }));

    const callArgs = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers["user-agent"]).toContain(expectedSubstring);
  });

  // ---- Non-2xx responses --------------------------------------------------

  test("returns ok: false for a non-2xx response", async () => {
    const res = new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
    mockFetch.mockResolvedValueOnce(res);

    const result = await fetchText("https://example.com/missing", makeContext());

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.body).toBe("Not Found");
    expect(result.error).toBeNull();
  });

  // ---- Diagnostics recording ----------------------------------------------

  test("records attempted_urls and attempts in diagnostics", async () => {
    const diag = createEmptyDiagnostics();
    mockFetch.mockResolvedValueOnce(okResponse());

    await fetchText("https://example.com", makeContext({ diagnostics: diag }));

    expect(diag.attempted_urls).toEqual(["https://example.com"]);
    expect(diag.attempts).toBe(1);
  });

  test("records http_status as a string in diagnostics", async () => {
    const diag = createEmptyDiagnostics();
    mockFetch.mockResolvedValueOnce(okResponse());

    await fetchText("https://example.com", makeContext({ diagnostics: diag }));

    expect(diag.http_status).toBe("200");
  });

  test.each<[number, string, string | null]>([
    [200, "https://example.com/ok", "https://example.com/ok"],
    [301, "https://example.com/redirect", "https://example.com/redirect"],
    [404, "https://example.com/missing", null],
    [500, "https://example.com/error", null],
  ])("status %i → last_reachable_url = %s", async (status, responseUrl, expected) => {
    const diag = createEmptyDiagnostics();
    const res = new Response("body", { status, headers: { "content-type": "text/html" } });
    Object.defineProperty(res, "url", { value: responseUrl });
    mockFetch.mockResolvedValueOnce(res);

    await fetchText("https://example.com", makeContext({ diagnostics: diag }));

    expect(diag.last_reachable_url).toBe(expected);
  });

  test("works correctly without diagnostics provided", async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    const result = await fetchText("https://example.com", makeContext());

    expect(result.ok).toBe(true);
    // No error thrown even without diagnostics
  });

  // ---- Retry behavior (no timers) -----------------------------------------

  test("does not retry when maxRetries is 0", async () => {
    mockFetch.mockRejectedValueOnce(new Error("single failure"));

    const result = await fetchText("https://example.com", makeContext({ maxRetries: 0 }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("single failure");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test("treats negative maxRetries as 0 (no retries)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fail"));

    const result = await fetchText("https://example.com", makeContext({ maxRetries: -1 }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe("fail");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ---- maxAttempts budget (no timers) -------------------------------------

  test.each<[string, number, number, boolean]>([
    ["blocks when budget exhausted", 3, 3, false],
    ["allows when budget remaining", 2, 3, true],
  ])("%s (attempts=%i, max=%i)", async (_label, attempts, maxAttempts, expectedOk) => {
    const diag = createEmptyDiagnostics();
    diag.attempts = attempts;
    if (expectedOk) mockFetch.mockResolvedValueOnce(okResponse("allowed"));

    const result = await fetchText(
      "https://example.com",
      makeContext({ maxAttempts, diagnostics: diag }),
    );

    expect(result.ok).toBe(expectedOk);
    if (!expectedOk) {
      expect(result.error).toBe(`attempt budget exceeded (${maxAttempts})`);
      expect(mockFetch).not.toHaveBeenCalled();
    }
  });

  test("ignores maxAttempts when it is 0 or negative (no budget)", async () => {
    const diag = createEmptyDiagnostics();
    diag.attempts = 100;
    mockFetch.mockResolvedValueOnce(okResponse("no limit"));

    const result = await fetchText(
      "https://example.com",
      makeContext({ maxAttempts: 0, diagnostics: diag }),
    );

    expect(result.ok).toBe(true);
    expect(result.body).toBe("no limit");
  });

  test("ignores maxAttempts when diagnostics are not provided", async () => {
    mockFetch.mockResolvedValueOnce(okResponse("no diag"));

    const result = await fetchText(
      "https://example.com",
      makeContext({ maxAttempts: 1 }),
    );

    expect(result.ok).toBe(true);
    expect(result.body).toBe("no diag");
  });

  // ---- Error message handling (no timers) ---------------------------------

  test("captures non-Error thrown values as strings", async () => {
    mockFetch.mockRejectedValueOnce("string error");

    const result = await fetchText("https://example.com", makeContext());

    expect(result.error).toBe("string error");
  });

  test("does not record non-timeout errors in diagnostics.errors", async () => {
    const diag = createEmptyDiagnostics();
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await fetchText(
      "https://example.com",
      makeContext({ diagnostics: diag }),
    );

    expect(diag.errors).toEqual([]);
  });

  // ---- Timer-dependent tests ----------------------------------------------

  describe("with fake timers", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    test("retries on fetch failure and succeeds on second attempt", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce(okResponse("retry success"));

      const promise = fetchText("https://example.com", makeContext({ maxRetries: 1 }));

      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.body).toBe("retry success");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("returns error result after exhausting all retries", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockRejectedValueOnce(new Error("fail 3"));

      const promise = fetchText("https://example.com", makeContext({ maxRetries: 2 }));

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.status).toBeNull();
      expect(result.body).toBeNull();
      expect(result.error).toBe("fail 3");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    test("records each retry attempt in diagnostics", async () => {
      const diag = createEmptyDiagnostics();
      mockFetch
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce(okResponse("ok"));

      const promise = fetchText(
        "https://example.com",
        makeContext({ maxRetries: 1, diagnostics: diag }),
      );

      await vi.advanceTimersByTimeAsync(1_000);
      await promise;

      expect(diag.attempts).toBe(2);
      expect(diag.attempted_urls).toEqual([
        "https://example.com",
        "https://example.com",
      ]);
    });

    test("uses exponential backoff: delay increases with attempt number", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockRejectedValueOnce(new Error("fail 3"))
        .mockResolvedValueOnce(okResponse("finally"));

      const promise = fetchText("https://example.com", makeContext({ maxRetries: 3 }));

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await vi.advanceTimersByTimeAsync(3_000);
      const result = await promise;

      expect(result.ok).toBe(true);
      expect(result.body).toBe("finally");
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    test("returns timeout error when fetch exceeds timeoutMs", async () => {
      mockFetch.mockImplementationOnce(
        () => new Promise(() => { /* never resolves */ }),
      );

      const promise = fetchText(
        "https://slow.example.com",
        makeContext({ timeoutMs: 3_000, maxRetries: 0 }),
      );

      await vi.advanceTimersByTimeAsync(3_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toContain("timeout");
      expect(result.status).toBeNull();
    });

    test("records timeout errors in diagnostics.errors", async () => {
      const diag = createEmptyDiagnostics();
      mockFetch.mockImplementationOnce(
        () => new Promise(() => { /* never resolves */ }),
      );

      const promise = fetchText(
        "https://slow.example.com",
        makeContext({ timeoutMs: 2_000, maxRetries: 0, diagnostics: diag }),
      );

      await vi.advanceTimersByTimeAsync(2_000);
      await promise;

      expect(diag.errors.length).toBe(1);
      expect(diag.errors[0]).toContain("Timeout while fetching https://slow.example.com");
    });

    test("enforces minimum timeout of 1000ms even if a lower value is provided", async () => {
      mockFetch.mockImplementationOnce(
        () => new Promise(() => { /* never resolves */ }),
      );

      const promise = fetchText(
        "https://slow.example.com",
        makeContext({ timeoutMs: 100, maxRetries: 0 }),
      );

      await vi.advanceTimersByTimeAsync(999);
      await vi.advanceTimersByTimeAsync(1);
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toContain("timeout after 1000ms");
    });

    test("also applies timeout to response.text() reading", async () => {
      const slowTextResponse = {
        ok: true,
        status: 200,
        url: "https://example.com",
        headers: new Headers({ "content-type": "text/html" }),
        text: () => new Promise<string>(() => { /* never resolves */ }),
      } as unknown as Response;
      mockFetch.mockResolvedValueOnce(slowTextResponse);

      const promise = fetchText(
        "https://example.com",
        makeContext({ timeoutMs: 2_000, maxRetries: 0 }),
      );

      await vi.advanceTimersByTimeAsync(2_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toContain("timeout");
    });

    test("maxAttempts budget check runs per retry iteration", async () => {
      const diag = createEmptyDiagnostics();
      diag.attempts = 1;

      mockFetch
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValueOnce(okResponse("should not reach"));

      const promise = fetchText(
        "https://example.com",
        makeContext({ maxRetries: 2, maxAttempts: 2, diagnostics: diag }),
      );

      await vi.advanceTimersByTimeAsync(1_000);
      const result = await promise;

      expect(result.ok).toBe(false);
      expect(result.error).toBe("attempt budget exceeded (2)");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("records timeout errors but not generic network errors in diagnostics.errors", async () => {
      const diag = createEmptyDiagnostics();

      mockFetch
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockImplementationOnce(() => new Promise(() => { /* never resolves */ }));

      const promise = fetchText(
        "https://example.com",
        makeContext({ maxRetries: 1, timeoutMs: 2_000, diagnostics: diag }),
      );

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(2_000);
      await promise;

      expect(diag.errors.length).toBe(1);
      expect(diag.errors[0]).toContain("Timeout");
    });
  });
});
