// ─── Mocks ──────────────────────────────────────────────────────────────────

// vi.mock factories are hoisted, so we must use vi.hoisted to create mocks
// that are accessible inside the factory functions.
const {
  generateTextMock,
  outputObjectMock,
  createAnthropicMock,
  anthropicFactoryMock,
} = vi.hoisted(() => {
  const anthropicFactoryMock = vi.fn();
  return {
    generateTextMock: vi.fn(),
    outputObjectMock: vi.fn((opts: unknown) => opts),
    createAnthropicMock: vi.fn(() => anthropicFactoryMock),
    anthropicFactoryMock,
  };
});

vi.mock("ai", () => ({
  generateText: generateTextMock,
  Output: { object: outputObjectMock },
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: createAnthropicMock,
}));

import {
  createPreferenceLlm,
  PreferenceLlmError,
} from "./preference-llm";
import {
  TargetRolesExtractionSchema,
} from "@/lib/chatbot/schemas";

// ─── Setup ──────────────────────────────────────────────────────────────────

function createTestLlm() {
  return createPreferenceLlm("sk-test-key-123");
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── createPreferenceLlm factory ────────────────────────────────────────────

describe("createPreferenceLlm", () => {
  test("passes apiKey to createAnthropic", () => {
    createPreferenceLlm("sk-test-key-123");
    expect(createAnthropicMock).toHaveBeenCalledWith({
      apiKey: "sk-test-key-123",
    });
  });

  test("uses the correct model ID", () => {
    createPreferenceLlm("sk-test");
    expect(anthropicFactoryMock).toHaveBeenCalledWith("claude-sonnet-4-20250514");
  });
});

// ─── extractPartialPreferences ──────────────────────────────────────────────

describe("extractPartialPreferences", () => {
  test("calls generateText with step's extraction schema", async () => {
    const mockOutput = {
      targetTitles: ["SWE"],
      confidence: "high",
      clarificationNeeded: false,
    };
    generateTextMock.mockResolvedValue({ output: mockOutput });

    const llm = createTestLlm();
    const result = await llm.extractPartialPreferences({
      userText: "SWE roles",
      currentStep: "target_roles",
      currentDraft: {},
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const callArgs = generateTextMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(callArgs).toHaveProperty("output");
    expect(callArgs).toHaveProperty("system");
    expect(callArgs).toHaveProperty("prompt");
    expect(result).toBe(mockOutput);
  });

  test("passes schema matching TargetRolesExtractionSchema", async () => {
    generateTextMock.mockResolvedValue({ output: {} });

    const llm = createTestLlm();
    await llm.extractPartialPreferences({
      userText: "SWE",
      currentStep: "target_roles",
      currentDraft: {},
    });

    // Output.object should have been called with the step's extraction schema
    expect(outputObjectMock).toHaveBeenCalledWith({
      schema: TargetRolesExtractionSchema,
    });
  });

  test("passes system and prompt from buildExtractionPrompt", async () => {
    generateTextMock.mockResolvedValue({ output: {} });

    const llm = createTestLlm();
    await llm.extractPartialPreferences({
      userText: "Senior QA",
      currentStep: "target_roles",
      currentDraft: { coreSkills: ["JS"] },
    });

    const callArgs = generateTextMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // System prompt should come from EXTRACTION_SYSTEM_PROMPT
    expect(typeof callArgs["system"]).toBe("string");
    expect(callArgs["system"] as string).toContain("NEVER invent");
    // Prompt should contain user text and step context
    expect(typeof callArgs["prompt"]).toBe("string");
    expect(callArgs["prompt"] as string).toContain("Senior QA");
    expect(callArgs["prompt"] as string).toContain("target_roles");
  });

  test("throws PreferenceLlmError for unknown step", async () => {
    const llm = createTestLlm();
    await expect(
      llm.extractPartialPreferences({
        userText: "test",
        currentStep: "nonexistent_step",
        currentDraft: {},
      }),
    ).rejects.toThrow(PreferenceLlmError);
    await expect(
      llm.extractPartialPreferences({
        userText: "test",
        currentStep: "nonexistent_step",
        currentDraft: {},
      }),
    ).rejects.toThrow(/Unknown conversation step/);
  });

  test("throws PreferenceLlmError for step without extraction schema", async () => {
    const llm = createTestLlm();
    // target_seniority is a structured step with no extractionSchema
    await expect(
      llm.extractPartialPreferences({
        userText: "test",
        currentStep: "target_seniority",
        currentDraft: {},
      }),
    ).rejects.toThrow(PreferenceLlmError);
    await expect(
      llm.extractPartialPreferences({
        userText: "test",
        currentStep: "target_seniority",
        currentDraft: {},
      }),
    ).rejects.toThrow(/does not have an extraction schema/);
  });
});

// ─── summarizeDraft ─────────────────────────────────────────────────────────

describe("summarizeDraft", () => {
  test("calls generateText and returns text", async () => {
    generateTextMock.mockResolvedValue({ text: "Your preferences summary" });

    const llm = createTestLlm();
    const result = await llm.summarizeDraft({
      currentDraft: { targetTitles: ["SWE"] },
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(result).toBe("Your preferences summary");
  });
});

// ─── proposeClarification ───────────────────────────────────────────────────

describe("proposeClarification", () => {
  test("calls generateText and returns text", async () => {
    generateTextMock.mockResolvedValue({
      text: "What specific roles interest you?",
    });

    const llm = createTestLlm();
    const result = await llm.proposeClarification({
      userText: "hmm",
      currentStep: "target_roles",
      currentDraft: {},
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(result).toBe("What specific roles interest you?");
  });

  test("throws PreferenceLlmError for unknown step", async () => {
    const llm = createTestLlm();
    await expect(
      llm.proposeClarification({
        userText: "test",
        currentStep: "nonexistent",
        currentDraft: {},
      }),
    ).rejects.toThrow(PreferenceLlmError);
  });
});

// ─── proposeRoleFamilyExpansion ─────────────────────────────────────────────

describe("proposeRoleFamilyExpansion", () => {
  test("calls generateText with RoleFamilyExpansionSchema", async () => {
    const mockOutput = {
      fitsExisting: false,
      suggestedFamily: "MLOps",
      confidence: "high",
    };
    generateTextMock.mockResolvedValue({ output: mockOutput });

    const llm = createTestLlm();
    const result = await llm.proposeRoleFamilyExpansion({
      targetRole: "ML Ops",
      existingFamilies: ["SWE"],
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(result).toBe(mockOutput);
    // Output.object should have been called with the expansion schema
    expect(outputObjectMock).toHaveBeenCalled();
  });
});

// ─── Error propagation ─────────────────────────────────────────────────────

describe("error propagation", () => {
  test("generateText API error propagates from extractPartialPreferences", async () => {
    generateTextMock.mockRejectedValue(new Error("401 Unauthorized"));

    const llm = createTestLlm();
    await expect(
      llm.extractPartialPreferences({
        userText: "test",
        currentStep: "target_roles",
        currentDraft: {},
      }),
    ).rejects.toThrow("401 Unauthorized");
  });

  test("generateText API error propagates from summarizeDraft", async () => {
    generateTextMock.mockRejectedValue(new Error("Rate limited"));

    const llm = createTestLlm();
    await expect(
      llm.summarizeDraft({ currentDraft: {} }),
    ).rejects.toThrow("Rate limited");
  });
});

// ─── PreferenceLlmError ─────────────────────────────────────────────────────

describe("PreferenceLlmError", () => {
  test("has correct name property and extends Error", () => {
    const error = new PreferenceLlmError("test message");
    expect(error.name).toBe("PreferenceLlmError");
    expect(error.message).toBe("test message");
    expect(error).toBeInstanceOf(Error);
  });
});
