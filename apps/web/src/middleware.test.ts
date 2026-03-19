// ---- Mocks ----------------------------------------------------------------

const getSessionCookieMock = vi.fn();
vi.mock("better-auth/cookies", () => ({
  getSessionCookie: (...args: unknown[]) =>
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    getSessionCookieMock(...args),
}));

import { NextRequest } from "next/server";
import { middleware } from "./middleware";

// ---- Helpers ---------------------------------------------------------------

function makeRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

// ---- Setup -----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- Tests -----------------------------------------------------------------

describe("middleware", () => {
  describe("protected paths redirect unauthenticated users to /login", () => {
    test.each([
      ["/dashboard"],
      ["/dashboard/overview"],
      ["/profile"],
      ["/profile/edit"],
      ["/settings"],
      ["/settings/notifications"],
    ])("%s without session redirects to /login", (path) => {
      getSessionCookieMock.mockReturnValue(undefined);

      const response = middleware(makeRequest(path));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe(
        "/login"
      );
    });

    test.each([
      ["/dashboard"],
      ["/profile"],
      ["/settings"],
    ])("%s with session passes through", (path) => {
      getSessionCookieMock.mockReturnValue("session-token-value");

      const response = middleware(makeRequest(path));

      // NextResponse.next() does not set a location header
      expect(response.headers.get("location")).toBeNull();
    });
  });

  describe("auth paths redirect authenticated users away", () => {
    test("/login with session redirects to /", () => {
      getSessionCookieMock.mockReturnValue("session-token-value");

      const response = middleware(makeRequest("/login"));

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/");
    });

    test("/login without session passes through", () => {
      getSessionCookieMock.mockReturnValue(undefined);

      const response = middleware(makeRequest("/login"));

      expect(response.headers.get("location")).toBeNull();
    });
  });

  describe("admin API paths return 401 for unauthenticated requests", () => {
    test.each([["/api/seed"], ["/api/seed/batch"], ["/api/ingestion"], ["/api/ingestion/run"]])(
      "%s without session returns 401 JSON",
      async (path) => {
        getSessionCookieMock.mockReturnValue(undefined);

        const response = middleware(makeRequest(path));
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const json: Record<string, unknown> = await response.json();

        expect(response.status).toBe(401);
        expect(json).toEqual({ error: "Authentication required" });
      }
    );

    test.each([["/api/seed"], ["/api/ingestion"]])(
      "%s with session passes through",
      (path) => {
        getSessionCookieMock.mockReturnValue("session-token-value");

        const response = middleware(makeRequest(path));

        expect(response.headers.get("location")).toBeNull();
        expect(response.status).not.toBe(401);
      }
    );
  });

  describe("non-matched paths pass through", () => {
    test.each([["/"], ["/about"], ["/api/jobs"], ["/api/companies"]])(
      "%s passes through regardless of session state",
      (path) => {
        getSessionCookieMock.mockReturnValue(undefined);

        const response = middleware(makeRequest(path));

        expect(response.headers.get("location")).toBeNull();
        expect(response.status).not.toBe(401);
      }
    );
  });

  test("passes the request to getSessionCookie", () => {
    getSessionCookieMock.mockReturnValue(undefined);
    const request = makeRequest("/dashboard");

    middleware(request);

    expect(getSessionCookieMock).toHaveBeenCalledWith(request);
  });
});
