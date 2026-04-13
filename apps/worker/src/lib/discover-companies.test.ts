import {
  discoverCompanies,
  type DiscoverCompaniesInput,
} from "./discover-companies";

// ─── Module mocks ──────────────────────────────────────────────────────────

const mockWebSearchTool = vi.fn(() => "mock-web-search-tool");
const mockModelFn = vi.fn(() => "mock-model");

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() =>
    Object.assign(mockModelFn, {
      tools: { webSearch_20250305: mockWebSearchTool },
    }),
  ),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn(() => "mock-stop-when"),
}));

// ─── Imports (after mocks) ─────────────────────────────────────────────────

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs } from "ai";

const mockCreateAnthropic = createAnthropic as ReturnType<typeof vi.fn>;
const mockGenerateText = generateText as ReturnType<typeof vi.fn>;
const mockStepCountIs = stepCountIs as ReturnType<typeof vi.fn>;

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeInput(
  overrides: Partial<DiscoverCompaniesInput> = {},
): DiscoverCompaniesInput {
  return {
    apiKey: "sk-test-key",
    preferences: {
      industries: ["saas"],
      companySizes: ["50-200"],
      companyStages: [],
      productTypes: [],
      exclusions: [],
      hqGeographies: [],
    },
    existingCompanyNames: [],
    budget: 20,
    ...overrides,
  };
}

function makeDiscoveredCompany(overrides: Record<string, unknown> = {}) {
  return {
    name: "Foo",
    website: "https://foo.com",
    careersUrl: "https://boards.greenhouse.io/foo",
    industry: ["saas"],
    reasoning: "matches criteria",
    ...overrides,
  };
}

/** Simulate generateText returning text (no Output.object — text parsing only). */
function mockTextResult(text: string, steps = 1) {
  mockGenerateText.mockResolvedValue({
    text,
    steps: Array.from({ length: steps }),
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("discoverCompanies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Re-set mock return values after clearAllMocks
    mockCreateAnthropic.mockReturnValue(
      Object.assign(mockModelFn, {
        tools: { webSearch_20250305: mockWebSearchTool },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Critical ──────────────────────────────────────────────────────────

  test("happy path -- AI returns JSON text with companies", async () => {
    const company = makeDiscoveredCompany();
    mockTextResult(JSON.stringify({ companies: [company] }), 5);

    const result = await discoverCompanies(makeInput());

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        name: "Foo",
        website: "https://foo.com",
        careersUrl: "https://boards.greenhouse.io/foo",
      }),
    );
  });

  test("AI returns empty text -- returns empty array", async () => {
    mockTextResult("", 1);

    const result = await discoverCompanies(makeInput());

    expect(result).toEqual([]);
  });

  test("AI returns null text -- returns empty array", async () => {
    mockGenerateText.mockResolvedValue({ text: null, steps: [] });

    const result = await discoverCompanies(makeInput());

    expect(result).toEqual([]);
  });

  test("API call throws (network error, 401, etc.) -- returns empty array, does not throw", async () => {
    mockGenerateText.mockRejectedValue(new Error("401 Unauthorized"));

    const result = await discoverCompanies(makeInput());

    expect(result).toEqual([]);
  });

  // ── Important ─────────────────────────────────────────────────────────

  test("createAnthropic called with the provided apiKey", async () => {
    mockTextResult(JSON.stringify({ companies: [] }));

    await discoverCompanies(makeInput({ apiKey: "sk-user-byok" }));

    expect(mockCreateAnthropic).toHaveBeenCalledWith({
      apiKey: "sk-user-byok",
    });
  });

  test("generateText called with web search tool but no Output.object", async () => {
    mockTextResult(JSON.stringify({ companies: [] }));

    await discoverCompanies(makeInput());

    expect(mockGenerateText).toHaveBeenCalledOnce();
    const callArgs = mockGenerateText.mock.calls[0][0] as Record<
      string,
      unknown
    >;

    // Model was constructed from provider
    expect(callArgs.model).toBe("mock-model");

    // Web search tool present
    expect(callArgs.tools).toEqual(
      expect.objectContaining({ web_search: "mock-web-search-tool" }),
    );

    // No Output.object -- tools + structured output conflict
    expect(callArgs.output).toBeUndefined();

    // stepCountIs(20) was used
    expect(mockStepCountIs).toHaveBeenCalledWith(20);
    expect(callArgs.stopWhen).toBe("mock-stop-when");

    // System and user prompts are strings from buildDiscoveryPrompt
    expect(typeof callArgs.system).toBe("string");
    expect(typeof callArgs.prompt).toBe("string");
    expect(callArgs.system).toContain("company research assistant");
  });

  test("AI returns empty companies array -- returns empty array", async () => {
    mockTextResult(JSON.stringify({ companies: [] }));

    const result = await discoverCompanies(makeInput());

    expect(result).toEqual([]);
  });

  // ── Text parsing / fallback ──────────────────────────────────────────

  test("concatenated JSON objects from multi-step output -- extracts last non-empty fragment", async () => {
    const company = makeDiscoveredCompany({ name: "Marqeta" });
    const concatenated =
      '{"companies": []}{"companies": []}{"companies": []}' +
      JSON.stringify({ companies: [company] });
    mockTextResult(concatenated, 4);

    const result = await discoverCompanies(makeInput());

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ name: "Marqeta" }));
  });

  test("concatenated JSON objects all empty -- returns empty array", async () => {
    const concatenated = '{"companies": []}{"companies": []}{"companies": []}';
    mockTextResult(concatenated, 3);

    const result = await discoverCompanies(makeInput());

    expect(result).toEqual([]);
  });

  test("markdown-fenced JSON -- extracts from code fence", async () => {
    const company = makeDiscoveredCompany({ name: "TRM Labs" });
    const fenced =
      "Here are the companies I found:\n\n```json\n" +
      JSON.stringify({ companies: [company] }) +
      "\n```";
    mockTextResult(fenced, 3);

    const result = await discoverCompanies(makeInput());

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ name: "TRM Labs" }));
  });

  test("JSON embedded in prose -- extracts from braces", async () => {
    const company = makeDiscoveredCompany({ name: "Chainalysis" });
    const prose =
      "Based on my research, here are the matching companies:\n\n" +
      JSON.stringify({ companies: [company] }) +
      "\n\nThese companies match your criteria.";
    mockTextResult(prose, 5);

    const result = await discoverCompanies(makeInput());

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({ name: "Chainalysis" }),
    );
  });
});
