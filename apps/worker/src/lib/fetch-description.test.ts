import { fetchJobDescription } from "./fetch-description";

// ─── Module mocks ──────────────────────────────────────────────────────────

vi.mock("@gjs/ats-core", () => ({
  htmlToText: vi.fn(),
  sha256: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ _eq: val })),
}));

vi.mock("@gjs/db/schema", () => ({
  jobs: {
    id: Symbol("jobs.id"),
    descriptionText: Symbol("jobs.descriptionText"),
    descriptionHash: Symbol("jobs.descriptionHash"),
    updatedAt: Symbol("jobs.updatedAt"),
  },
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { htmlToText, sha256 } from "@gjs/ats-core";

// ─── Helpers ───────────────────────────────────────────────────────────────

const mockHtmlToText = htmlToText as ReturnType<typeof vi.fn>;
const mockSha256 = sha256 as ReturnType<typeof vi.fn>;

interface JobRow {
  id: string;
  descriptionText: string | null;
  atsJobId: string;
  sourceRef: string;
}

function makeJobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: "j1",
    descriptionText: null,
    atsJobId: "posting-123",
    sourceRef: "smartrecruiters",
    ...overrides,
  };
}

function makeCompanyRow(atsSlug = "acme") {
  return { atsSlug };
}

function createMockDb() {
  const setCalls: Record<string, unknown>[] = [];
  const mockWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn().mockImplementation((data: Record<string, unknown>) => {
    setCalls.push(data);
    return { where: mockWhere };
  });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

  return {
    db: { update: mockUpdate } as unknown as Parameters<typeof fetchJobDescription>[0],
    mocks: { mockUpdate, mockSet, mockWhere },
    setCalls,
  };
}

function mockFetchSuccess(body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  }));
}

function mockFetchFailure(status: number) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    status,
  }));
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("fetchJobDescription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── Critical ──────────────────────────────────────────────────────────

  test("job already has description -- returns it immediately without fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { db } = createMockDb();
    const jobRow = makeJobRow({ descriptionText: "existing description" });

    const result = await fetchJobDescription(db, jobRow, makeCompanyRow());

    expect(result).toBe("existing description");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  test("non-SmartRecruiters vendor -- returns null without fetching", async () => {
    const { db } = createMockDb();
    const jobRow = makeJobRow({ sourceRef: "greenhouse" });

    const result = await fetchJobDescription(db, jobRow, makeCompanyRow());

    expect(result).toBeNull();
  });

  test("SmartRecruiters job with valid response -- fetches, parses, updates DB, returns text", async () => {
    const responseBody = {
      jobAd: {
        sections: {
          jobDescription: {
            text: "<p>Hello World</p>",
          },
        },
      },
    };
    mockFetchSuccess(responseBody);
    mockHtmlToText.mockReturnValue("Hello World");
    mockSha256.mockReturnValue("abc123");

    const { db, setCalls } = createMockDb();
    const jobRow = makeJobRow();

    const result = await fetchJobDescription(db, jobRow, makeCompanyRow());

    // Correct URL construction
    expect(fetch).toHaveBeenCalledWith(
      "https://api.smartrecruiters.com/v1/companies/acme/postings/posting-123",
      expect.objectContaining({
        headers: { accept: "application/json" },
      }),
    );

    // HTML -> text conversion
    expect(mockHtmlToText).toHaveBeenCalledWith("<p>Hello World</p>");

    // DB update with description and hash
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toEqual(
      expect.objectContaining({
        descriptionText: "Hello World",
        descriptionHash: "abc123",
      }),
    );

    expect(result).toBe("Hello World");
  });

  test("SmartRecruiters returns non-OK status -- returns null, no DB update", async () => {
    mockFetchFailure(404);
    const { db } = createMockDb();

    const result = await fetchJobDescription(db, makeJobRow(), makeCompanyRow());

    expect(result).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });

  test("fetch throws (network error) -- returns null, no DB update", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));
    const { db } = createMockDb();

    const result = await fetchJobDescription(db, makeJobRow(), makeCompanyRow());

    expect(result).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("SmartRecruiters response missing 'jobAd' key -- returns null", async () => {
    mockFetchSuccess({ content: "something else" });
    const { db } = createMockDb();

    const result = await fetchJobDescription(db, makeJobRow(), makeCompanyRow());

    expect(result).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });

  test("SmartRecruiters response with empty string text -- returns null", async () => {
    mockFetchSuccess({
      jobAd: { sections: { jobDescription: { text: "" } } },
    });
    const { db } = createMockDb();

    const result = await fetchJobDescription(db, makeJobRow(), makeCompanyRow());

    expect(result).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });

  test("htmlToText returns null -- returns null, no DB update", async () => {
    mockFetchSuccess({
      jobAd: { sections: { jobDescription: { text: "<br/>" } } },
    });
    mockHtmlToText.mockReturnValue(null);
    const { db } = createMockDb();

    const result = await fetchJobDescription(db, makeJobRow(), makeCompanyRow());

    expect(result).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });

  test("URL construction with special characters in atsSlug", async () => {
    mockFetchSuccess({
      jobAd: { sections: { jobDescription: { text: "<p>ok</p>" } } },
    });
    mockHtmlToText.mockReturnValue("ok");
    mockSha256.mockReturnValue("hash");
    const { db } = createMockDb();

    const jobRow = makeJobRow({ atsJobId: "job/123" });
    await fetchJobDescription(db, jobRow, makeCompanyRow("acme corp"));

    // Characters are URL-encoded
    expect(fetch).toHaveBeenCalledWith(
      "https://api.smartrecruiters.com/v1/companies/acme%20corp/postings/job%2F123",
      expect.anything(),
    );
  });

  test("response body is not valid JSON -- returns null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    }));
    const { db } = createMockDb();

    const result = await fetchJobDescription(db, makeJobRow(), makeCompanyRow());

    expect(result).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });

  // ── Nice-to-have ──────────────────────────────────────────────────────

  test.each(["greenhouse", "lever", "ashby"] as const)(
    "non-SmartRecruiters vendor '%s' returns null without fetching",
    async (vendor) => {
      const { db } = createMockDb();
      const jobRow = makeJobRow({ sourceRef: vendor });

      const result = await fetchJobDescription(db, jobRow, makeCompanyRow());

      expect(result).toBeNull();
    },
  );

  test.each<[string, unknown]>([
    ["null", null],
    ["number", 42],
    ["jobAd is null", { jobAd: null }],
    ["jobAd is number", { jobAd: 42 }],
    ["sections is null", { jobAd: { sections: null } }],
    ["jobDescription is null", { jobAd: { sections: { jobDescription: null } } }],
    ["text is number", { jobAd: { sections: { jobDescription: { text: 42 } } } }],
  ])("nested extraction -- %s returns null", async (_desc, responseBody) => {
    mockFetchSuccess(responseBody);
    const { db } = createMockDb();

    const result = await fetchJobDescription(db, makeJobRow(), makeCompanyRow());

    expect(result).toBeNull();
  });

  // ── Corner Cases ──────────────────────────────────────────────────────

  test("htmlToText returns empty string -- treated as absent description", async () => {
    mockFetchSuccess({
      jobAd: { sections: { jobDescription: { text: "<p></p>" } } },
    });
    mockHtmlToText.mockReturnValue("");
    const { db } = createMockDb();

    const result = await fetchJobDescription(db, makeJobRow(), makeCompanyRow());

    // Empty string is falsy, so `if (!descriptionText) return null`
    expect(result).toBeNull();
    expect(db.update).not.toHaveBeenCalled();
  });
});
