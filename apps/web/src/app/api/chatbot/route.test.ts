// Chatbot was retired: all three routes are now identical HTTP 501 stubs.
// These tests lock in the as-built contract — every method, every input,
// always 501 with body { error: "chatbot endpoints retired" } — and prove
// the handlers no longer auth, parse the body, or read query/headers.
//
// NO mocks: the stubs import only `next/server`. The deliberate absence of a
// `@/lib/auth` mock is itself meaningful — a clean 501 (not 401, not a thrown
// import error) proves no auth dependency survived the rewrite.
//
// Note: the stub handlers are declared `GET()` / `POST()` with ZERO params, so
// they are invoked with `()`. The retired input-specific behaviors (malformed
// body → was 400, empty body → would throw, query/header auth → was 401) are
// each given a named test below; the zero-param signature is *why* none of
// those inputs can be read — there is no Request parameter to inspect.

import { GET as messageGet, POST as messagePost } from "./message/route";
import { GET as stateGet, POST as statePost } from "./state/route";
import { GET as saveGet, POST as savePost } from "./save/route";

// ---- Helpers ---------------------------------------------------------------

const RETIRED_BODY = { error: "chatbot endpoints retired" } as const;

// ---- Tests -----------------------------------------------------------------

describe("retired /api/chatbot/* route stubs", () => {
  // S1–S6: all six handlers (3 routes × {GET, POST}) share one assertion shape:
  // status 501 + body deep-equals { error: "chatbot endpoints retired" }.
  // `toEqual` is exact, so this also subsumes S12 (only the `error` key) and
  // S13 (the GET cases here invoke with zero args).
  test.each<[string, () => Response]>([
    ["message GET", messageGet],
    ["message POST", messagePost],
    ["state GET", stateGet],
    ["state POST", statePost],
    ["save GET", saveGet],
    ["save POST", savePost],
  ])("%s returns 501 with the exact retired body", async (_label, handler) => {
    const res = handler();

    expect(res.status).toBe(501);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toEqual(RETIRED_BODY);
  });

  // S7: no auth gate. The predecessor of POST /state returned 401 when
  // unauthenticated; with no session context configured at all, a clean 501
  // proves the auth dependency is gone.
  test("POST /state returns 501 with no session context (no auth gate)", async () => {
    const res = statePost();

    expect(res.status).toBe(501);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toEqual(RETIRED_BODY);
  });

  // S8: handler never reads the body. The old route returned 400 for a non-JSON
  // body; the stub returns 501 without throwing a parse error. Because the
  // handler takes no parameters, there is no `req` to call `.json()` on — a
  // malformed body is structurally unreachable, so invocation cannot throw a
  // SyntaxError. Asserting "does not throw" locks in that the parse path is gone.
  test("POST /message returns 501 without throwing on a would-be malformed body", async () => {
    let res: Response | undefined;
    expect(() => {
      res = messagePost();
    }).not.toThrow();

    expect(res?.status).toBe(501);
    const json = (await res!.json()) as Record<string, unknown>;
    expect(json).toEqual(RETIRED_BODY);
  });

  // S9: an empty/absent body is a distinct retired path from a malformed one —
  // `await req.json()` on an empty body would have thrown "Unexpected end of
  // JSON input". The zero-arg handler reads no body, so it returns 501 cleanly.
  test("POST /save returns 501 without throwing on a would-be empty body", async () => {
    let res: Response | undefined;
    expect(() => {
      res = savePost();
    }).not.toThrow();

    expect(res?.status).toBe(501);
    const json = (await res!.json()) as Record<string, unknown>;
    expect(json).toEqual(RETIRED_BODY);
  });

  // S10: no query parsing and no header/cookie-based auth shortcut survived.
  // The handler signature takes no Request, so a query string, Authorization
  // header, or session cookie cannot be inspected — the result is an
  // unconditional 501.
  test("GET /state returns 501, having no parameter to read query/headers/cookie from", async () => {
    const res = stateGet();

    expect(res.status).toBe(501);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toEqual(RETIRED_BODY);
  });

  // S11: response Content-Type is JSON. Query the actual header rather than
  // inferring it from res.json() succeeding; tolerate a charset suffix.
  test("GET /message responds with a JSON Content-Type", () => {
    const res = messageGet();

    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
