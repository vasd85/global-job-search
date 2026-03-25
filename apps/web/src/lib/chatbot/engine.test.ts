import type { ConversationState, PreferencesDraft } from "./schemas";
import type { PreferenceCollectionLlm } from "@/lib/llm/preference-llm";
import { STEPS } from "./steps";
import { DEFAULT_WEIGHTS, validateDraft, goToStep } from "./state";
import {
  initializeConversation,
  processMessage,
  EngineError,
} from "./engine";

// ─── Helpers ────────────────────────────────────────────────────────────────

const FROZEN_TIME = "2026-03-15T12:00:00.000Z";

function stateAtStep(
  index: number,
  overrides?: Partial<ConversationState>,
): ConversationState {
  return {
    currentStepIndex: index,
    draft: {},
    completedSteps: [],
    status: "in_progress",
    createdAt: FROZEN_TIME,
    updatedAt: FROZEN_TIME,
    ...overrides,
  };
}

function createMockLlm(): PreferenceCollectionLlm {
  return {
    extractPartialPreferences: vi.fn(),
    summarizeDraft: vi.fn(),
    proposeClarification: vi.fn(),
    proposeRoleFamilyExpansion: vi.fn(),
  };
}

// ─── initializeConversation ─────────────────────────────────────────────────

describe("initializeConversation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns first step's question with correct state shape", () => {
    const result = initializeConversation();

    expect(result.state.currentStepIndex).toBe(0);
    expect(result.state.status).toBe("in_progress");
    expect(result.assistantMessage).toContain(STEPS[0]!.question);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: result.assistantMessage,
    });
    // First step is free_text, so no structured controls
    expect(result.structuredControls).toBeUndefined();
  });
});

// ─── processMessage: skip behavior ──────────────────────────────────────────

describe("processMessage: skip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("__SKIP__ on skippable step advances without LLM call", async () => {
    // growth_skills is at index 3, skippable=true
    const state = stateAtStep(3);
    const result = await processMessage(state, "__SKIP__", null);

    expect(result.updatedState.currentStepIndex).toBe(4);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.role).toBe("user");
    expect(result.messages[1]!.role).toBe("assistant");
  });

  test("__SKIP__ on required step returns error message without advancing", async () => {
    // target_roles is at index 0, required, not skippable
    const state = stateAtStep(0);
    const result = await processMessage(state, "__SKIP__", null);

    expect(result.updatedState.currentStepIndex).toBe(0);
    expect(result.assistantMessage).toContain("required");
    expect(result.assistantMessage).toContain("cannot be skipped");
  });

  test("__SKIP__ on dimension_weights applies default weights at review", async () => {
    const mockLlm = createMockLlm();
    (mockLlm.summarizeDraft as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Here is your summary...",
    );

    // dimension_weights is at index 15, skippable=true
    const state = stateAtStep(15);
    const result = await processMessage(state, "__SKIP__", mockLlm);

    expect(result.updatedState.currentStepIndex).toBe(16);
    expect(result.updatedState.status).toBe("review");
    expect(result.updatedState.draft.weightRole).toBe(
      DEFAULT_WEIGHTS.weightRole,
    );
    expect(result.updatedState.draft.weightSkills).toBe(
      DEFAULT_WEIGHTS.weightSkills,
    );
    expect(result.updatedState.draft.weightLocation).toBe(
      DEFAULT_WEIGHTS.weightLocation,
    );
    expect(result.updatedState.draft.weightCompensation).toBe(
      DEFAULT_WEIGHTS.weightCompensation,
    );
    expect(result.updatedState.draft.weightDomain).toBe(
      DEFAULT_WEIGHTS.weightDomain,
    );
  });
});

// ─── processMessage: structured steps ───────────────────────────────────────

describe("processMessage: structured step", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("parses JSON and advances, no LLM needed", async () => {
    // target_seniority is at index 1, structured
    const state = stateAtStep(1);
    const result = await processMessage(
      state,
      '{"targetSeniority": ["senior", "lead"]}',
      null,
    );

    expect(result.updatedState.draft.targetSeniority).toEqual([
      "senior",
      "lead",
    ]);
    expect(result.updatedState.currentStepIndex).toBe(2);
  });

  test("rejects invalid JSON", async () => {
    const state = stateAtStep(1);
    await expect(
      processMessage(state, "not json at all", null),
    ).rejects.toThrow(EngineError);
  });

  test.each([
    ["42", "number"],
    ['"just a string"', "string"],
    ["null", "null"],
  ])("rejects non-object JSON: %s (%s)", async (input) => {
    const state = stateAtStep(1);
    await expect(processMessage(state, input, null)).rejects.toThrow(
      EngineError,
    );
  });

  // TODO: JSON arrays pass the `typeof parsed !== "object"` check because
  // `typeof [] === "object"`. The array [1,2,3] gets spread as {0:1, 1:2, 2:3}
  // into the draft. The parseStructuredInput function should additionally check
  // `Array.isArray(parsed)` to reject arrays. Documenting current behavior.
  test("JSON array is accepted (typeof [] is object -- potential bug)", async () => {
    const state = stateAtStep(1);
    // This does NOT throw, even though it should arguably reject arrays
    const result = await processMessage(state, "[1,2,3]", null);
    // The array is spread into the draft as indexed keys
    const draft = result.updatedState.draft as Record<string, unknown>;
    expect(draft["0"]).toBe(1);
  });
});

// ─── processMessage: free_text steps ────────────────────────────────────────

describe("processMessage: free_text step", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("calls LLM and applies extraction", async () => {
    const mockLlm = createMockLlm();
    (
      mockLlm.extractPartialPreferences as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      targetTitles: ["Senior QA Engineer", "SDET"],
      confidence: "high",
      clarificationNeeded: false,
    });

    const state = stateAtStep(0);
    const result = await processMessage(
      state,
      "Senior QA Engineer and SDET",
      mockLlm,
    );

    expect(result.updatedState.draft.targetTitles).toEqual([
      "Senior QA Engineer",
      "SDET",
    ]);
    expect(result.updatedState.currentStepIndex).toBe(1);
    expect(mockLlm.extractPartialPreferences).toHaveBeenCalledWith({
      userText: "Senior QA Engineer and SDET",
      currentStep: "target_roles",
      currentDraft: {},
    });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.role).toBe("user");
    expect(result.messages[1]!.role).toBe("assistant");
  });

  test("clarificationNeeded does not advance", async () => {
    const mockLlm = createMockLlm();
    (
      mockLlm.extractPartialPreferences as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      targetTitles: [],
      confidence: "low",
      clarificationNeeded: true,
      clarificationQuestion: "Could you be more specific?",
    });

    const state = stateAtStep(0);
    const result = await processMessage(state, "something", mockLlm);

    expect(result.updatedState.currentStepIndex).toBe(0);
    expect(result.assistantMessage).toBe("Could you be more specific?");
    expect(result.messages).toHaveLength(2);
  });

  test("empty clarificationQuestion falls back to proposeClarification", async () => {
    const mockLlm = createMockLlm();
    (
      mockLlm.extractPartialPreferences as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      targetTitles: [],
      confidence: "low",
      clarificationNeeded: true,
      clarificationQuestion: "",
    });
    (
      mockLlm.proposeClarification as ReturnType<typeof vi.fn>
    ).mockResolvedValue("What roles interest you?");

    const state = stateAtStep(0);
    const result = await processMessage(state, "hmm", mockLlm);

    expect(mockLlm.proposeClarification).toHaveBeenCalled();
    expect(result.assistantMessage).toBe("What roles interest you?");
    expect(result.updatedState.currentStepIndex).toBe(0);
  });

  test("throws EngineError when free_text step has no LLM", async () => {
    const state = stateAtStep(0);
    await expect(processMessage(state, "hello", null)).rejects.toThrow(
      EngineError,
    );
    await expect(processMessage(state, "hello", null)).rejects.toThrow(
      /LLM.*required/,
    );
  });
});

// ─── processMessage: review transition ──────────────────────────────────────

describe("processMessage: review transition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("at second-to-last step advances to review with summary", async () => {
    const mockLlm = createMockLlm();
    (mockLlm.summarizeDraft as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Here is your summary...",
    );

    // dimension_weights is at index 15, structured
    const state = stateAtStep(15);
    const result = await processMessage(
      state,
      '{"weightRole": 0.25, "weightSkills": 0.25, "weightLocation": 0.2, "weightCompensation": 0.15, "weightDomain": 0.15}',
      mockLlm,
    );

    expect(result.updatedState.currentStepIndex).toBe(16);
    expect(result.updatedState.status).toBe("review");
    expect(mockLlm.summarizeDraft).toHaveBeenCalled();
    expect(result.assistantMessage).toBe("Here is your summary...");
  });

  test("at review with no LLM uses static fallback message", async () => {
    // dimension_weights at index 15 is structured, so we can advance to
    // review without LLM
    const state = stateAtStep(15);
    const result = await processMessage(
      state,
      '{"weightRole": 0.25, "weightSkills": 0.25, "weightLocation": 0.2, "weightCompensation": 0.15, "weightDomain": 0.15}',
      null,
    );

    expect(result.updatedState.status).toBe("review");
    // Falls back to the review step's static question
    expect(result.assistantMessage).toContain("summary");
  });
});

// ─── processMessage: message structure ──────────────────────────────────────

describe("processMessage: messages array", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns messages array with user + assistant entries", async () => {
    // Use a structured step to avoid needing LLM
    const state = stateAtStep(1);
    const result = await processMessage(
      state,
      '{"targetSeniority": ["senior"]}',
      null,
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: "user",
      content: '{"targetSeniority": ["senior"]}',
    });
    expect(result.messages[1]).toEqual({
      role: "assistant",
      content: result.assistantMessage,
    });
  });
});

// ─── processMessage: error cases ────────────────────────────────────────────

describe("processMessage: error cases", () => {
  test("invalid step index throws EngineError", async () => {
    const state = stateAtStep(999);
    await expect(processMessage(state, "hello", null)).rejects.toThrow(
      EngineError,
    );
    await expect(processMessage(state, "hello", null)).rejects.toThrow(
      /Invalid step index/,
    );
  });

  test("LLM extractPartialPreferences rejection propagates", async () => {
    const mockLlm = createMockLlm();
    (
      mockLlm.extractPartialPreferences as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("API timeout"));

    const state = stateAtStep(0);
    await expect(
      processMessage(state, "test input", mockLlm),
    ).rejects.toThrow("API timeout");
  });

  test("LLM summarizeDraft rejection at review propagates", async () => {
    const mockLlm = createMockLlm();
    (mockLlm.summarizeDraft as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Summary generation failed"),
    );

    // Use dimension_weights (structured) to reach review
    const state = stateAtStep(15);
    await expect(
      processMessage(
        state,
        '{"weightRole": 0.25, "weightSkills": 0.25, "weightLocation": 0.2, "weightCompensation": 0.15, "weightDomain": 0.15}',
        mockLlm,
      ),
    ).rejects.toThrow("Summary generation failed");
  });

  test("extremely long userMessage does not crash", async () => {
    const mockLlm = createMockLlm();
    (
      mockLlm.extractPartialPreferences as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      targetTitles: ["SWE"],
      confidence: "high",
      clarificationNeeded: false,
    });

    const state = stateAtStep(0);
    const longMessage = "x".repeat(100_000);
    const result = await processMessage(state, longMessage, mockLlm);

    expect(result.updatedState.currentStepIndex).toBe(1);
  });
});

// ─── applyDefaultWeightsIfNeeded behavior ───────────────────────────────────

describe("applyDefaultWeightsIfNeeded", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("applies defaults only at review status, not during in_progress", async () => {
    // Test in_progress: skip a non-weight step -- weights should not be added
    const state = stateAtStep(3); // growth_skills, skippable
    const result = await processMessage(state, "__SKIP__", null);

    expect(result.updatedState.status).toBe("in_progress");
    expect(result.updatedState.draft.weightRole).toBeUndefined();
  });
});

// ─── getStructuredControls behavior ─────────────────────────────────────────

describe("getStructuredControls (via processMessage responses)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns undefined for free_text steps", async () => {
    // Advance from structured step 1 to free_text step 2 (core_skills is hybrid)
    // Step 1 (target_seniority) is structured, step 2 (core_skills) is hybrid
    const state = stateAtStep(1);
    const result = await processMessage(
      state,
      '{"targetSeniority": ["senior"]}',
      null,
    );

    // core_skills (step 2) is hybrid but has no structuredConfig
    expect(result.structuredControls).toBeUndefined();
  });

  test("returns structuredConfig for structured steps", async () => {
    const mockLlm = createMockLlm();
    (
      mockLlm.extractPartialPreferences as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      targetTitles: ["SWE"],
      confidence: "high",
      clarificationNeeded: false,
    });

    // Advance from step 0 (target_roles, free_text) to step 1 (target_seniority, structured)
    const state = stateAtStep(0);
    const result = await processMessage(
      state,
      "Senior SWE",
      mockLlm,
    );

    // target_seniority has structuredConfig
    expect(result.structuredControls).toBeDefined();
    expect(result.structuredControls?.type).toBe("multi_select");
  });
});

// ─── buildStepMessage behavior ──────────────────────────────────────────────

describe("buildStepMessage (via processMessage responses)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("includes helpText when present", async () => {
    const mockLlm = createMockLlm();
    (
      mockLlm.extractPartialPreferences as ReturnType<typeof vi.fn>
    ).mockResolvedValue({
      targetTitles: ["SWE"],
      confidence: "high",
      clarificationNeeded: false,
    });

    // Advance from step 0 to step 1
    const state = stateAtStep(0);
    const result = await processMessage(state, "SWE", mockLlm);

    const step1 = STEPS[1]!;
    // The assistant message should include question and helpText separated by newlines
    expect(result.assistantMessage).toContain(step1.question);
    if (step1.helpText) {
      expect(result.assistantMessage).toContain(step1.helpText);
    }
  });
});

// ─── Integration: multi-step flow ───────────────────────────────────────────

describe("integration: complete happy path through all required steps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("completes full conversation reaching review with valid draft", async () => {
    const mockLlm = createMockLlm();
    const extractMock = mockLlm.extractPartialPreferences as ReturnType<
      typeof vi.fn
    >;
    const summarizeMock = mockLlm.summarizeDraft as ReturnType<typeof vi.fn>;
    summarizeMock.mockResolvedValue("Here is your summary...");

    // Initialize
    const { state: initialState } = initializeConversation();
    let state = initialState;

    // Step 0: target_roles (free_text)
    extractMock.mockResolvedValueOnce({
      targetTitles: ["Senior QA Engineer"],
      confidence: "high",
      clarificationNeeded: false,
    });
    let result = await processMessage(state, "Senior QA Engineer", mockLlm);
    state = result.updatedState;
    expect(state.currentStepIndex).toBe(1);

    // Step 1: target_seniority (structured)
    result = await processMessage(
      state,
      '{"targetSeniority": ["senior"]}',
      mockLlm,
    );
    state = result.updatedState;
    expect(state.currentStepIndex).toBe(2);

    // Step 2: core_skills (hybrid)
    extractMock.mockResolvedValueOnce({
      coreSkills: ["Selenium", "Python"],
      confidence: "high",
      clarificationNeeded: false,
    });
    result = await processMessage(state, "Selenium, Python", mockLlm);
    state = result.updatedState;
    expect(state.currentStepIndex).toBe(3);

    // Step 3: growth_skills (skip)
    result = await processMessage(state, "__SKIP__", mockLlm);
    state = result.updatedState;
    expect(state.currentStepIndex).toBe(4);

    // Step 4: avoid_skills (skip)
    result = await processMessage(state, "__SKIP__", mockLlm);
    state = result.updatedState;

    // Step 5: deal_breakers (skip)
    result = await processMessage(state, "__SKIP__", mockLlm);
    state = result.updatedState;

    // Step 6: salary (skip)
    result = await processMessage(state, "__SKIP__", mockLlm);
    state = result.updatedState;

    // Step 7: location (hybrid)
    extractMock.mockResolvedValueOnce({
      preferredLocations: ["NYC"],
      remotePreference: "remote_only",
      confidence: "high",
      clarificationNeeded: false,
    });
    result = await processMessage(state, "NYC, remote ok", mockLlm);
    state = result.updatedState;
    expect(state.currentStepIndex).toBe(8);

    // Step 8: industries (hybrid)
    extractMock.mockResolvedValueOnce({
      industries: ["fintech"],
      confidence: "high",
      clarificationNeeded: false,
    });
    result = await processMessage(state, "fintech", mockLlm);
    state = result.updatedState;
    expect(state.currentStepIndex).toBe(9);

    // Step 9: company_sizes (structured)
    result = await processMessage(
      state,
      '{"companySizes": ["startup", "scaleup"]}',
      mockLlm,
    );
    state = result.updatedState;
    expect(state.currentStepIndex).toBe(10);

    // Steps 10-14: skip remaining optional steps
    result = await processMessage(state, "__SKIP__", mockLlm); // company_stages
    state = result.updatedState;
    result = await processMessage(state, "__SKIP__", mockLlm); // work_format
    state = result.updatedState;
    result = await processMessage(state, "__SKIP__", mockLlm); // hq_geographies
    state = result.updatedState;
    result = await processMessage(state, "__SKIP__", mockLlm); // product_types
    state = result.updatedState;
    result = await processMessage(state, "__SKIP__", mockLlm); // exclusions
    state = result.updatedState;

    // Step 15: dimension_weights (skip)
    result = await processMessage(state, "__SKIP__", mockLlm);
    state = result.updatedState;

    // Verify final state
    expect(state.status).toBe("review");
    expect(state.currentStepIndex).toBe(16);
    expect(state.draft.targetTitles).toEqual(["Senior QA Engineer"]);
    expect(state.draft.targetSeniority).toEqual(["senior"]);
    expect(state.draft.coreSkills).toEqual(["Selenium", "Python"]);
    expect(state.draft.preferredLocations).toEqual(["NYC"]);
    expect(state.draft.industries).toEqual(["fintech"]);
    expect(state.draft.companySizes).toEqual(["startup", "scaleup"]);

    // Default weights should be applied
    expect(state.draft.weightRole).toBe(DEFAULT_WEIGHTS.weightRole);

    // Draft validation should pass
    expect(validateDraft(state.draft).valid).toBe(true);

    // summarizeDraft should have been called
    expect(summarizeMock).toHaveBeenCalled();
  });
});

describe("integration: clarification loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("does not advance on clarification, then retry succeeds", async () => {
    const mockLlm = createMockLlm();
    const extractMock = mockLlm.extractPartialPreferences as ReturnType<
      typeof vi.fn
    >;

    const state = stateAtStep(0);

    // First attempt: clarification needed
    extractMock.mockResolvedValueOnce({
      targetTitles: [],
      confidence: "low",
      clarificationNeeded: true,
      clarificationQuestion: "Could you be more specific about the roles?",
    });

    let result = await processMessage(state, "something", mockLlm);
    expect(result.updatedState.currentStepIndex).toBe(0);

    // Second attempt: success
    extractMock.mockResolvedValueOnce({
      targetTitles: ["SWE"],
      confidence: "high",
      clarificationNeeded: false,
    });

    result = await processMessage(
      result.updatedState,
      "Software Engineer",
      mockLlm,
    );
    expect(result.updatedState.currentStepIndex).toBe(1);

    // Two extraction calls total
    expect(extractMock).toHaveBeenCalledTimes(2);
  });
});

describe("integration: goToStep during review, edit, then re-advance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("editing during review preserves other draft fields", async () => {
    const mockLlm = createMockLlm();
    const extractMock = mockLlm.extractPartialPreferences as ReturnType<
      typeof vi.fn
    >;
    const summarizeMock = mockLlm.summarizeDraft as ReturnType<typeof vi.fn>;
    summarizeMock.mockResolvedValue("Summary...");

    // Create state at review with a populated draft
    const draft: PreferencesDraft = {
      targetTitles: ["SWE"],
      targetSeniority: ["senior"],
      coreSkills: ["JS"],
      preferredLocations: ["NYC"],
      industries: ["fintech"],
      companySizes: ["startup"],
      weightRole: 0.25,
      weightSkills: 0.25,
      weightLocation: 0.2,
      weightCompensation: 0.15,
      weightDomain: 0.15,
    };

    const reviewState = stateAtStep(16, {
      status: "review",
      draft,
      completedSteps: [
        "target_roles",
        "target_seniority",
        "core_skills",
        "location",
        "industries",
        "company_sizes",
      ],
    });

    // Jump back to core_skills (index 2)
    const editState = goToStep(reviewState, "core_skills");
    expect(editState.currentStepIndex).toBe(2);
    expect(editState.status).toBe("in_progress");

    // Edit core_skills with new value
    extractMock.mockResolvedValueOnce({
      coreSkills: ["TypeScript", "React"],
      confidence: "high",
      clarificationNeeded: false,
    });

    const result = await processMessage(editState, "TypeScript and React", mockLlm);

    // Draft should have updated core_skills but kept other fields
    expect(result.updatedState.draft.coreSkills).toEqual([
      "TypeScript",
      "React",
    ]);
    expect(result.updatedState.draft.targetTitles).toEqual(["SWE"]);
    expect(result.updatedState.draft.industries).toEqual(["fintech"]);
  });
});

describe("integration: all skippable steps skipped reaches review", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("minimum viable completion path with only required steps", async () => {
    const mockLlm = createMockLlm();
    const extractMock = mockLlm.extractPartialPreferences as ReturnType<
      typeof vi.fn
    >;
    const summarizeMock = mockLlm.summarizeDraft as ReturnType<typeof vi.fn>;
    summarizeMock.mockResolvedValue("Minimum summary...");

    const { state: initialState } = initializeConversation();
    let state = initialState;

    // Step 0: target_roles (required, free_text)
    extractMock.mockResolvedValueOnce({
      targetTitles: ["SWE"],
      confidence: "high",
      clarificationNeeded: false,
    });
    let result = await processMessage(state, "SWE", mockLlm);
    state = result.updatedState;

    // Step 1: target_seniority (required, structured)
    result = await processMessage(
      state,
      '{"targetSeniority": ["senior"]}',
      mockLlm,
    );
    state = result.updatedState;

    // Step 2: core_skills (required, hybrid)
    extractMock.mockResolvedValueOnce({
      coreSkills: ["JS"],
      confidence: "high",
      clarificationNeeded: false,
    });
    result = await processMessage(state, "JS", mockLlm);
    state = result.updatedState;

    // Skip all skippable steps 3-6
    for (let i = 0; i < 4; i++) {
      result = await processMessage(state, "__SKIP__", mockLlm);
      state = result.updatedState;
    }

    // Step 7: location (required, hybrid)
    extractMock.mockResolvedValueOnce({
      preferredLocations: ["Remote"],
      confidence: "high",
      clarificationNeeded: false,
    });
    result = await processMessage(state, "Remote anywhere", mockLlm);
    state = result.updatedState;

    // Step 8: industries (required, hybrid)
    extractMock.mockResolvedValueOnce({
      industries: ["tech"],
      confidence: "high",
      clarificationNeeded: false,
    });
    result = await processMessage(state, "tech", mockLlm);
    state = result.updatedState;

    // Step 9: company_sizes (required, structured)
    result = await processMessage(
      state,
      '{"companySizes": ["startup"]}',
      mockLlm,
    );
    state = result.updatedState;

    // Skip all remaining optional steps 10-15
    for (let i = 0; i < 6; i++) {
      result = await processMessage(state, "__SKIP__", mockLlm);
      state = result.updatedState;
    }

    // Should be at review
    expect(state.status).toBe("review");
    expect(state.currentStepIndex).toBe(16);
    expect(validateDraft(state.draft).valid).toBe(true);
    expect(state.draft.weightRole).toBe(DEFAULT_WEIGHTS.weightRole);
  });
});

// ─── Corner case: completed status ──────────────────────────────────────────

describe("corner case: completed status", () => {
  // TODO: There is no guard in processMessage against status "completed".
  // Messages can still be processed on a finalized conversation. The engine
  // reads STEPS[state.currentStepIndex], which would be the review step
  // (index 16), and attempts to process structured input at the review step.
  // The engine should arguably reject messages once the conversation is
  // finalized.
  test("processMessage on completed state still processes (no guard)", async () => {
    const state = stateAtStep(16, { status: "completed" });
    // Review step is structured, so it attempts JSON parse
    // This just documents the current behavior
    await expect(
      processMessage(state, '{"something": true}', null),
    ).resolves.toBeDefined();
  });
});
