// ---- Mocks ----------------------------------------------------------------

const getSessionMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  headers: () => headersMock(),
}));

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    redirectMock(...args);
    // Next.js redirect() throws to halt execution; simulate that behavior
    throw new Error("NEXT_REDIRECT");
  },
}));

import { getSession, requireSession, requireAdmin } from "./auth-session";

// ---- Helpers ---------------------------------------------------------------

const fakeHeaders = new Headers({ cookie: "session=abc" });

const userSession = {
  user: { id: "u1", name: "Alice", role: "user" },
  session: { id: "s1" },
};

const adminSession = {
  user: { id: "u2", name: "Admin Bob", role: "admin" },
  session: { id: "s2" },
};

// ---- Setup -----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  headersMock.mockResolvedValue(fakeHeaders);
});

// ---- Tests -----------------------------------------------------------------

describe("getSession", () => {
  test("passes awaited headers to auth.api.getSession", async () => {
    getSessionMock.mockResolvedValueOnce(userSession);

    await getSession();

    expect(getSessionMock).toHaveBeenCalledWith({ headers: fakeHeaders });
  });

  test("returns the session when authenticated", async () => {
    getSessionMock.mockResolvedValueOnce(userSession);

    const result = await getSession();

    expect(result).toBe(userSession);
  });

  test("returns null when no valid session exists", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const result = await getSession();

    expect(result).toBeNull();
  });
});

describe("requireSession", () => {
  test("returns the session when authenticated", async () => {
    getSessionMock.mockResolvedValueOnce(userSession);

    const result = await requireSession();

    expect(result).toBe(userSession);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  test("redirects to /login when session is null", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    await expect(requireSession()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});

describe("requireAdmin", () => {
  test("returns the session when user has admin role", async () => {
    getSessionMock.mockResolvedValueOnce(adminSession);

    const result = await requireAdmin();

    expect(result).toBe(adminSession);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  test("redirects to / when user role is not admin", async () => {
    getSessionMock.mockResolvedValueOnce(userSession);

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  test("redirects to /login when not authenticated at all", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");

    // requireAdmin calls requireSession first, which redirects to /login
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
