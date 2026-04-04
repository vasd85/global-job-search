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
  Output: { object: vi.fn(() => "mock-output-schema") },
  stepCountIs: vi.fn(() => "mock-stop-when"),
  NoObjectGeneratedError: {
    isInstance: vi.fn(() => false),
  },
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

  test("happy path -- AI returns structured output with companies", async () => {
    const company = makeDiscoveredCompany();
    mockGenerateText.mockResolvedValue({
      output: { companies: [company] },
    });

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

  test("AI returns no structured output (output is null) -- returns empty array", async () => {
    mockGenerateText.mockResolvedValue({ output: null });

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
    mockGenerateText.mockResolvedValue({
      output: { companies: [] },
    });

    await discoverCompanies(makeInput({ apiKey: "sk-user-byok" }));

    expect(mockCreateAnthropic).toHaveBeenCalledWith({
      apiKey: "sk-user-byok",
    });
  });

  test("generateText called with correct model, web search tool, and prompts", async () => {
    mockGenerateText.mockResolvedValue({
      output: { companies: [] },
    });

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

    // Output schema was applied
    expect(callArgs.output).toBe("mock-output-schema");

    // stepCountIs(5) was used
    expect(mockStepCountIs).toHaveBeenCalledWith(5);
    expect(callArgs.stopWhen).toBe("mock-stop-when");

    // System and user prompts are strings from buildDiscoveryPrompt
    expect(typeof callArgs.system).toBe("string");
    expect(typeof callArgs.prompt).toBe("string");
    expect(callArgs.system).toContain("company research assistant");
  });

  test("AI returns empty companies array -- returns empty array", async () => {
    mockGenerateText.mockResolvedValue({
      output: { companies: [] },
    });

    const result = await discoverCompanies(makeInput());

    expect(result).toEqual([]);
  });
});
