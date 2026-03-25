// ---- Hoisted Mock State (accessible inside vi.mock factories) ---------------

const {
  selectResult,
  insertReturningResult,
  transcriptResult,
  mockOrderBy,
  mockSelectFrom,
  mockSelect,
  mockInsert,
  mockUpdate,
  txInsert,
  txUpdate,
  mockTransaction,
  getSessionMock,
  deserializeStateMock,
  serializeStateMock,
  validateDraftMock,
  goToStepMock,
  markCompletedMock,
  processMessageMock,
  initializeConversationMock,
  getUserAnthropicKeyMock,
  mockLlmInstance,
  createPreferenceLlmMock,
  STEPS_MOCK,
  insertValuesCalls,
  updateSetCalls,
  txInsertValuesCalls,
  txUpdateSetCalls,
} = vi.hoisted(() => {
  const selectResult: unknown[] = [];
  const insertReturningResult: unknown[] = [];
  const transcriptResult: unknown[] = [];
  const insertValuesCalls: unknown[] = [];
  const updateSetCalls: unknown[] = [];
  const txInsertValuesCalls: unknown[] = [];
  const txUpdateSetCalls: unknown[] = [];

  const mockOrderBy = vi.fn().mockImplementation(() => transcriptResult);
  const mockSelectWhere = vi.fn().mockImplementation(() => ({
    limit: vi.fn().mockImplementation(() => selectResult),
    orderBy: mockOrderBy,
  }));
  const mockSelectFrom = vi.fn().mockImplementation(() => ({
    where: mockSelectWhere,
  }));
  const mockSelect = vi.fn().mockImplementation(() => ({
    from: mockSelectFrom,
  }));

  const mockInsertReturning = vi.fn().mockImplementation(() => insertReturningResult);
  const mockInsertValues = vi.fn().mockImplementation((vals: unknown) => {
    insertValuesCalls.push(vals);
    return {
      returning: mockInsertReturning,
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    };
  });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

  const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const mockUpdateSet = vi.fn().mockImplementation((data: unknown) => {
    updateSetCalls.push(data);
    return { where: mockUpdateWhere };
  });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  const txInsertOnConflict = vi.fn().mockResolvedValue(undefined);
  const txInsertValues = vi.fn().mockImplementation((vals: unknown) => {
    txInsertValuesCalls.push(vals);
    return { onConflictDoUpdate: txInsertOnConflict };
  });
  const txInsert = vi.fn().mockReturnValue({ values: txInsertValues });

  const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
  const txUpdateSet = vi.fn().mockImplementation((data: unknown) => {
    txUpdateSetCalls.push(data);
    return { where: txUpdateWhere };
  });
  const txUpdate = vi.fn().mockReturnValue({ set: txUpdateSet });

  const mockTransaction = vi.fn().mockImplementation(
    async (fn: (tx: unknown) => Promise<void>) => {
      const tx = { insert: txInsert, update: txUpdate };
      await fn(tx);
    },
  );

  const getSessionMock = vi.fn();
  const deserializeStateMock = vi.fn();
  const serializeStateMock = vi.fn().mockImplementation(
    (state: unknown) => ({ serialized: state }),
  );
  const validateDraftMock = vi.fn();
  const goToStepMock = vi.fn();
  const markCompletedMock = vi.fn();
  const processMessageMock = vi.fn();
  const initializeConversationMock = vi.fn();
  const getUserAnthropicKeyMock = vi.fn();
  const mockLlmInstance = {
    extractPartialPreferences: vi.fn(),
    summarizeDraft: vi.fn(),
  };
  const createPreferenceLlmMock = vi.fn().mockReturnValue(mockLlmInstance);

  const STEPS_MOCK = [
    {
      slug: "target_roles",
      inputType: "free_text",
      question: "What position are you looking for?",
      structuredConfig: undefined,
    },
    {
      slug: "target_seniority",
      inputType: "structured",
      question: "What seniority level(s)?",
      structuredConfig: {
        type: "multi_select",
        options: [{ value: "senior", label: "Senior" }],
      },
    },
    {
      slug: "core_skills",
      inputType: "hybrid",
      question: "What are your core skills?",
      structuredConfig: undefined,
    },
    {
      slug: "review",
      inputType: "structured",
      question: "Please review your preferences.",
      structuredConfig: undefined,
      fields: [],
    },
  ];

  return {
    selectResult,
    insertReturningResult,
    transcriptResult,
    mockOrderBy,
    mockSelectWhere,
    mockSelectFrom,
    mockSelect,
    mockInsertReturning,
    mockInsertValues,
    mockInsert,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
    txInsertOnConflict,
    txInsertValues,
    txInsert,
    txUpdateWhere,
    txUpdateSet,
    txUpdate,
    mockTransaction,
    getSessionMock,
    deserializeStateMock,
    serializeStateMock,
    validateDraftMock,
    goToStepMock,
    markCompletedMock,
    processMessageMock,
    initializeConversationMock,
    getUserAnthropicKeyMock,
    mockLlmInstance,
    createPreferenceLlmMock,
    STEPS_MOCK,
    insertValuesCalls,
    updateSetCalls,
    txInsertValuesCalls,
    txUpdateSetCalls,
  };
});

// ---- Module Mocks ---------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    select: (...args: unknown[]) => mockSelect(...args),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    insert: (...args: unknown[]) => mockInsert(...args),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    update: (...args: unknown[]) => mockUpdate(...args),
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(
    (col: unknown, val: unknown) => `eq(${String(col)},${String(val)})`,
  ),
}));

vi.mock("@/lib/db/schema", () => ({
  conversationStates: {
    userId: "conversationStates.userId",
    id: "conversationStates.id",
  },
  conversationMessages: {
    conversationStateId: "conversationMessages.conversationStateId",
    role: "conversationMessages.role",
    content: "conversationMessages.content",
    createdAt: "conversationMessages.createdAt",
  },
  userProfiles: {
    userId: "userProfiles.userId",
  },
  userCompanyPreferences: {
    userId: "userCompanyPreferences.userId",
  },
}));

vi.mock("@/lib/chatbot/state", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  deserializeState: (...args: unknown[]) => deserializeStateMock(...args),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  serializeState: (...args: unknown[]) => serializeStateMock(...args),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  validateDraft: (...args: unknown[]) => validateDraftMock(...args),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  goToStep: (...args: unknown[]) => goToStepMock(...args),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  markCompleted: (...args: unknown[]) => markCompletedMock(...args),
}));

vi.mock("@/lib/chatbot/engine", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  processMessage: (...args: unknown[]) => processMessageMock(...args),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  initializeConversation: (...args: unknown[]) => initializeConversationMock(...args),
  EngineError: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = "EngineError";
    }
  },
}));

vi.mock("@/lib/chatbot/steps", () => ({
  STEPS: STEPS_MOCK,
}));

vi.mock("@/lib/api-keys/get-user-key", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  getUserAnthropicKey: (...args: unknown[]) => getUserAnthropicKeyMock(...args),
}));

vi.mock("@/lib/llm/preference-llm", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  createPreferenceLlm: (...args: unknown[]) => createPreferenceLlmMock(...args),
}));

// ---- Imports (after mocks) ------------------------------------------------

import { POST as messagePost } from "./message/route";
import { GET as stateGet } from "./state/route";
import { POST as savePost } from "./save/route";
import { EngineError } from "@/lib/chatbot/engine";

// ---- Helpers --------------------------------------------------------------

const userSession = { user: { id: "u1", role: "user" }, session: {} };

function jsonRequest(method: string, body?: unknown): Request {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  return new Request("http://localhost/api/chatbot", init);
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    currentStepIndex: 0,
    draft: {},
    completedSteps: [],
    status: "in_progress",
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

function makeProcessMessageResult(overrides: Record<string, unknown> = {}) {
  return {
    updatedState: makeState({ currentStepIndex: 1 }),
    assistantMessage: "Next question...",
    structuredControls: undefined,
    messages: [
      { role: "user", content: "test message" },
      { role: "assistant", content: "Next question..." },
    ],
    ...overrides,
  };
}

// ---- Setup ----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue(userSession);

  // Reset mutable state
  selectResult.length = 0;
  insertReturningResult.length = 0;
  transcriptResult.length = 0;
  insertValuesCalls.length = 0;
  updateSetCalls.length = 0;
  txInsertValuesCalls.length = 0;
  txUpdateSetCalls.length = 0;

  // Default engine mock
  initializeConversationMock.mockReturnValue({
    state: makeState(),
    assistantMessage: "Welcome! What position?",
    structuredControls: undefined,
    messages: [{ role: "assistant", content: "Welcome! What position?" }],
  });
});

// ===========================================================================
// POST /api/chatbot/message
// ===========================================================================

describe("POST /api/chatbot/message", () => {
  // ---- Auth ----

  test("returns 401 when session is null", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const res = await messagePost(jsonRequest("POST", { message: "hello" }));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(json.error).toBe("Authentication required");
  });

  // ---- Input validation ----

  test("returns 400 for non-JSON request body", async () => {
    const req = new Request("http://localhost/api/chatbot/message", {
      method: "POST",
      body: "not-json",
    });

    const res = await messagePost(req);
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(json.error).toBe("Invalid JSON body");
  });

  test("returns 400 when message field is missing from body", async () => {
    const res = await messagePost(jsonRequest("POST", {}));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(json.error).toBe("Invalid input");
    expect(json.details).toBeDefined();
  });

  test("returns 400 when message is empty string", async () => {
    const res = await messagePost(jsonRequest("POST", { message: "" }));

    expect(res.status).toBe(400);
  });

  test.each([
    ["null body", null],
    ["message is a number", { message: 42 }],
    ["message is boolean", { message: true }],
  ])("returns 400 for invalid input: %s", async (_label, body) => {
    const res = await messagePost(jsonRequest("POST", body));
    expect(res.status).toBe(400);
  });

  // TODO: `.min(1)` on `z.string()` does NOT trim -- `"   "` has length 3
  // and passes validation. Consider whether `z.string().trim().min(1)` would
  // be better to reject whitespace-only messages.
  test("whitespace-only message passes validation (documents behavior)", async () => {
    const state = makeState();
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue("sk-test-key");
    processMessageMock.mockResolvedValue(makeProcessMessageResult());

    const res = await messagePost(
      jsonRequest("POST", { message: "   " }),
    );

    // Whitespace-only passes Zod .min(1) since length is 3
    expect(res.status).not.toBe(400);
  });

  // ---- New conversation creation ----

  test("creates new conversation state when none exists in DB", async () => {
    insertReturningResult.push({ id: "new-conv-1" });
    processMessageMock.mockResolvedValue(makeProcessMessageResult());

    const res = await messagePost(
      jsonRequest("POST", { message: "QA Engineer" }),
    );

    expect(initializeConversationMock).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
    expect(insertValuesCalls.length).toBeGreaterThanOrEqual(1);
    expect(res.status).toBe(200);
  });

  test("returns 500 when conversation state insert fails (no row returned)", async () => {
    // selectResult is empty -> new user
    // insertReturningResult is empty -> insert returned nothing

    const res = await messagePost(
      jsonRequest("POST", { message: "hello" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to create conversation state");
  });

  // ---- Existing conversation ----

  test("loads existing conversation state from DB", async () => {
    const existingState = makeState({ currentStepIndex: 2 });
    selectResult.push({
      id: "conv-1",
      state: { raw: "data" },
      userId: "u1",
    });
    deserializeStateMock.mockReturnValue(existingState);
    getUserAnthropicKeyMock.mockResolvedValue("sk-test-key");
    processMessageMock.mockResolvedValue(makeProcessMessageResult());

    await messagePost(jsonRequest("POST", { message: "Selenium" }));

    expect(deserializeStateMock).toHaveBeenCalledWith({ raw: "data" });
    expect(initializeConversationMock).not.toHaveBeenCalled();
  });

  // ---- Happy path ----

  test("processes a free-text message and returns response", async () => {
    const state = makeState({ currentStepIndex: 0 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue("sk-ant-test-key");

    const engineResult = makeProcessMessageResult();
    processMessageMock.mockResolvedValue(engineResult);

    const res = await messagePost(
      jsonRequest("POST", { message: "Senior QA Engineer" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(getUserAnthropicKeyMock).toHaveBeenCalledWith("u1");
    expect(createPreferenceLlmMock).toHaveBeenCalledWith("sk-ant-test-key");
    expect(processMessageMock).toHaveBeenCalledWith(
      state,
      "Senior QA Engineer",
      mockLlmInstance,
    );
    expect(json.assistantMessage).toBe("Next question...");
    expect(json.state).toBeDefined();
    expect(json.transcript).toBeDefined();
  });

  test("response body shape includes all expected fields", async () => {
    const state = makeState({ currentStepIndex: 0 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue("sk-key");
    processMessageMock.mockResolvedValue(
      makeProcessMessageResult({
        structuredControls: { type: "multi_select", options: [] },
      }),
    );

    const res = await messagePost(
      jsonRequest("POST", { message: "test" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json).toHaveProperty("assistantMessage");
    expect(json).toHaveProperty("state");
    expect(json).toHaveProperty("structuredControls");
    expect(json).toHaveProperty("transcript");

    const responseState = json.state as Record<string, unknown>;
    expect(responseState).toHaveProperty("currentStepIndex");
    expect(responseState).toHaveProperty("currentStep");
    expect(responseState).toHaveProperty("status");
    expect(responseState).toHaveProperty("completedSteps");
    expect(responseState).toHaveProperty("draft");
  });

  // ---- API key handling ----

  test("returns 422 when API key is required but not found", async () => {
    const state = makeState({ currentStepIndex: 0 }); // free_text step
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue(null);

    const res = await messagePost(
      jsonRequest("POST", { message: "QA Engineer" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(422);
    expect(json.error).toContain("Anthropic API key required");
  });

  test("skips API key fetch for structured steps", async () => {
    const state = makeState({ currentStepIndex: 1 }); // structured
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    processMessageMock.mockResolvedValue(makeProcessMessageResult());

    await messagePost(
      jsonRequest("POST", { message: '{"targetSeniority":["senior"]}' }),
    );

    expect(getUserAnthropicKeyMock).not.toHaveBeenCalled();
    expect(processMessageMock).toHaveBeenCalledWith(
      state,
      '{"targetSeniority":["senior"]}',
      null,
    );
  });

  test("skips API key fetch for __SKIP__ sentinel", async () => {
    const state = makeState({ currentStepIndex: 0 }); // free_text step
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    processMessageMock.mockResolvedValue(makeProcessMessageResult());

    await messagePost(jsonRequest("POST", { message: "__SKIP__" }));

    expect(getUserAnthropicKeyMock).not.toHaveBeenCalled();
  });

  // ---- __EDIT__ sentinel handling ----

  test("handles __EDIT__ sentinel -- navigates to valid step", async () => {
    const state = makeState({ currentStepIndex: 3, status: "review" });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);

    const editedState = makeState({
      currentStepIndex: 2,
      status: "in_progress",
    });
    goToStepMock.mockReturnValue(editedState);

    const res = await messagePost(
      jsonRequest("POST", { message: "__EDIT__:core_skills" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(goToStepMock).toHaveBeenCalledWith(state, "core_skills");
    expect(mockUpdate).toHaveBeenCalled();
    expect(serializeStateMock).toHaveBeenCalledWith(editedState);
    expect((json.assistantMessage as string)).toContain("Editing:");
  });

  test("handles __EDIT__ -- returns 400 for unknown step slug", async () => {
    const state = makeState({ currentStepIndex: 3, status: "review" });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);

    // goToStep returns same reference for unknown slugs
    goToStepMock.mockReturnValue(state);

    const res = await messagePost(
      jsonRequest("POST", { message: "__EDIT__:nonexistent_step" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(json.error).toBe("Unknown step: nonexistent_step");
  });

  test("__EDIT__ includes structuredControls when target is structured", async () => {
    const state = makeState({ currentStepIndex: 3, status: "review" });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);

    // Navigate to target_seniority (index 1, structured multi_select)
    const editedState = makeState({
      currentStepIndex: 1,
      status: "in_progress",
    });
    goToStepMock.mockReturnValue(editedState);

    const res = await messagePost(
      jsonRequest("POST", { message: "__EDIT__:target_seniority" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.structuredControls).toEqual({
      type: "multi_select",
      options: [{ value: "senior", label: "Senior" }],
    });
  });

  test("__EDIT__ has structuredControls = null for free_text step", async () => {
    const state = makeState({ currentStepIndex: 3, status: "review" });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);

    // Navigate to target_roles (index 0, free_text, no structuredConfig)
    const editedState = makeState({
      currentStepIndex: 0,
      status: "in_progress",
    });
    goToStepMock.mockReturnValue(editedState);

    const res = await messagePost(
      jsonRequest("POST", { message: "__EDIT__:target_roles" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.structuredControls).toBeNull();
  });

  // ---- Completed conversation ----

  test("returns 400 when completed and message is not __EDIT__", async () => {
    const state = makeState({ status: "completed" });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);

    const res = await messagePost(
      jsonRequest("POST", { message: "hello" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect((json.error as string)).toContain("Conversation already completed");
  });

  test("allows __EDIT__ on a completed conversation", async () => {
    const state = makeState({
      status: "completed",
      currentStepIndex: 3,
    });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);

    const editedState = makeState({
      currentStepIndex: 0,
      status: "in_progress",
    });
    goToStepMock.mockReturnValue(editedState);

    const res = await messagePost(
      jsonRequest("POST", { message: "__EDIT__:target_roles" }),
    );

    expect(res.status).toBe(200);
    expect(goToStepMock).toHaveBeenCalledWith(state, "target_roles");
  });

  // ---- Message persistence ----

  test("persists engine messages to conversation_messages table", async () => {
    const state = makeState({ currentStepIndex: 0 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue("sk-key");

    const messages = [
      { role: "user", content: "my msg" },
      { role: "assistant", content: "response" },
    ];
    processMessageMock.mockResolvedValue(
      makeProcessMessageResult({ messages }),
    );

    await messagePost(jsonRequest("POST", { message: "my msg" }));

    // Find the insert call that contains engine messages
    const messagesInsert = insertValuesCalls.find((call) => {
      if (!Array.isArray(call)) return false;
      return (
        call.length === 2 &&
        (call as Array<Record<string, unknown>>)[0]?.role === "user"
      );
    }) as Array<Record<string, unknown>> | undefined;

    expect(messagesInsert).toBeDefined();
    expect(messagesInsert![0]).toEqual(
      expect.objectContaining({
        role: "user",
        content: "my msg",
        conversationStateId: "conv-1",
      }),
    );
    expect(messagesInsert![1]).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: "response",
        conversationStateId: "conv-1",
      }),
    );
  });

  test("no message insert when engine returns empty messages array", async () => {
    const state = makeState({ currentStepIndex: 0 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue("sk-key");
    processMessageMock.mockResolvedValue(
      makeProcessMessageResult({ messages: [] }),
    );

    await messagePost(jsonRequest("POST", { message: "test" }));

    // No insert call should contain arrays of messages with role field
    const messagesInsertCalls = insertValuesCalls.filter((call) => {
      if (!Array.isArray(call)) return false;
      return (
        call.length > 0 &&
        (call as Array<Record<string, unknown>>)[0]?.role !== undefined
      );
    });
    expect(messagesInsertCalls).toHaveLength(0);
  });

  // ---- State persistence ----

  test("saves updated state to DB after processing", async () => {
    const state = makeState({ currentStepIndex: 0 });
    const updatedState = makeState({ currentStepIndex: 1 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue("sk-key");
    processMessageMock.mockResolvedValue(
      makeProcessMessageResult({ updatedState }),
    );

    await messagePost(jsonRequest("POST", { message: "test" }));

    expect(mockUpdate).toHaveBeenCalled();
    expect(serializeStateMock).toHaveBeenCalledWith(updatedState);
    expect(updateSetCalls.length).toBeGreaterThanOrEqual(1);
    const stateUpdate = updateSetCalls[0] as Record<string, unknown>;
    expect(stateUpdate).toHaveProperty("state");
    expect(stateUpdate).toHaveProperty("updatedAt");
  });

  // ---- Error categorization ----

  test("returns EngineError as 400 (not 500)", async () => {
    const state = makeState({ currentStepIndex: 0 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue("sk-key");
    processMessageMock.mockRejectedValue(
      new EngineError("Invalid step index: 99"),
    );

    const res = await messagePost(
      jsonRequest("POST", { message: "test" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(json.error).toBe("Invalid step index: 99");
  });

  test("returns 500 for unexpected errors", async () => {
    const state = makeState({ currentStepIndex: 0 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue("sk-key");
    processMessageMock.mockRejectedValue(new Error("DB connection lost"));

    const res = await messagePost(
      jsonRequest("POST", { message: "test" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to process message");
  });

  // ---- Transcript loading ----

  test("transcript is loaded in chronological order", async () => {
    const state = makeState({ currentStepIndex: 0 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue("sk-key");
    processMessageMock.mockResolvedValue(makeProcessMessageResult());

    const orderedTranscript = [
      {
        role: "assistant",
        content: "Welcome!",
        createdAt: "2026-01-01T12:00:00Z",
      },
      {
        role: "user",
        content: "QA Engineer",
        createdAt: "2026-01-01T12:01:00Z",
      },
      {
        role: "assistant",
        content: "Next",
        createdAt: "2026-01-01T12:02:00Z",
      },
    ];
    transcriptResult.push(...orderedTranscript);

    const res = await messagePost(
      jsonRequest("POST", { message: "QA Engineer" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(mockOrderBy).toHaveBeenCalled();
    expect(json.transcript).toEqual(orderedTranscript);
  });

  // ---- Corner cases ----

  test("__EDIT__: with empty slug returns 400", async () => {
    const state = makeState({ currentStepIndex: 3 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    goToStepMock.mockReturnValue(state);

    const res = await messagePost(
      jsonRequest("POST", { message: "__EDIT__:" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(json.error).toBe("Unknown step: ");
  });

  test("__EDIT__:target_roles:extra with extra colons returns 400", async () => {
    const state = makeState({ currentStepIndex: 3 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    goToStepMock.mockReturnValue(state);

    const res = await messagePost(
      jsonRequest("POST", { message: "__EDIT__:target_roles:extra" }),
    );
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(json.error).toBe("Unknown step: target_roles:extra");
  });

  test("__EDIT__ as substring is NOT treated as edit sentinel", async () => {
    const state = makeState({ currentStepIndex: 0 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue("sk-key");
    processMessageMock.mockResolvedValue(makeProcessMessageResult());

    const res = await messagePost(
      jsonRequest("POST", {
        message: "I want to __EDIT__:target_roles",
      }),
    );

    expect(goToStepMock).not.toHaveBeenCalled();
    expect(processMessageMock).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  test("extra unexpected fields in body are stripped by Zod", async () => {
    const state = makeState({ currentStepIndex: 0 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    getUserAnthropicKeyMock.mockResolvedValue("sk-key");
    processMessageMock.mockResolvedValue(makeProcessMessageResult());

    const res = await messagePost(
      jsonRequest("POST", { message: "hello", extra: "ignored" }),
    );

    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// GET /api/chatbot/state
// ===========================================================================

describe("GET /api/chatbot/state", () => {
  // ---- Auth ----

  test("returns 401 when session is null", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const res = await stateGet(jsonRequest("GET"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(json.error).toBe("Authentication required");
  });

  // ---- New user ----

  test("returns initial state for new user (no conversation exists)", async () => {
    const res = await stateGet(jsonRequest("GET"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.isNew).toBe(true);
    expect(json.initialMessage).toBeDefined();
    expect(json.transcript).toEqual([]);

    const state = json.state as Record<string, unknown>;
    expect(state.currentStepIndex).toBe(0);
    expect(state.status).toBe("in_progress");
    expect(state.draft).toEqual({});
  });

  test("structuredControls coerced to null for new user free_text step", async () => {
    // initializeConversation returns structuredControls: undefined
    const res = await stateGet(jsonRequest("GET"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(json.structuredControls).toBeNull();
  });

  // ---- Returning user ----

  test("returns existing state and transcript for returning user", async () => {
    const existingState = makeState({
      currentStepIndex: 2,
      completedSteps: ["target_roles", "target_seniority"],
    });
    selectResult.push({
      id: "conv-1",
      state: { raw: "stored" },
      userId: "u1",
    });
    deserializeStateMock.mockReturnValue(existingState);

    const mockTranscript = [
      {
        role: "assistant",
        content: "Welcome!",
        createdAt: "2026-01-01T12:00:00Z",
      },
      {
        role: "user",
        content: "QA Engineer",
        createdAt: "2026-01-01T12:01:00Z",
      },
      {
        role: "assistant",
        content: "Next",
        createdAt: "2026-01-01T12:02:00Z",
      },
    ];
    transcriptResult.push(...mockTranscript);

    const res = await stateGet(jsonRequest("GET"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.isNew).toBe(false);
    expect(json.transcript).toEqual(mockTranscript);

    const state = json.state as Record<string, unknown>;
    expect(state.currentStepIndex).toBe(2);
    expect(state.completedSteps).toEqual([
      "target_roles",
      "target_seniority",
    ]);
  });

  test("returns structuredControls for structured step", async () => {
    const existingState = makeState({ currentStepIndex: 1 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(existingState);

    const res = await stateGet(jsonRequest("GET"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.structuredControls).toEqual({
      type: "multi_select",
      options: [{ value: "senior", label: "Senior" }],
    });
  });

  test("returns structuredControls = null for free_text step", async () => {
    const existingState = makeState({ currentStepIndex: 0 });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(existingState);

    const res = await stateGet(jsonRequest("GET"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.structuredControls).toBeNull();
  });

  // ---- Response shape ----

  test("response shape matches client expectations", async () => {
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(makeState());

    const res = await stateGet(jsonRequest("GET"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json).toHaveProperty("state");
    expect(json).toHaveProperty("transcript");
    expect(json).toHaveProperty("structuredControls");
    expect(json).toHaveProperty("isNew");

    const state = json.state as Record<string, unknown>;
    expect(state).toHaveProperty("currentStepIndex");
    expect(state).toHaveProperty("currentStep");
    expect(state).toHaveProperty("status");
    expect(state).toHaveProperty("completedSteps");
    expect(state).toHaveProperty("draft");
  });

  test("currentStep falls back to 'review' when stepIndex beyond STEPS", async () => {
    const existingState = makeState({
      currentStepIndex: STEPS_MOCK.length,
    });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(existingState);

    const res = await stateGet(jsonRequest("GET"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    const state = json.state as Record<string, unknown>;
    expect(state.currentStep).toBe("review");
  });

  // ---- Error handling ----

  test("returns 500 for database errors", async () => {
    mockSelectFrom.mockImplementationOnce(() => {
      throw new Error("connection refused");
    });

    const res = await stateGet(jsonRequest("GET"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to load conversation state");
  });
});

// ===========================================================================
// POST /api/chatbot/save
// ===========================================================================

describe("POST /api/chatbot/save", () => {
  // ---- Auth ----

  test("returns 401 when session is null", async () => {
    getSessionMock.mockResolvedValueOnce(null);

    const res = await savePost(jsonRequest("POST"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(json.error).toBe("Authentication required");
  });

  // ---- No conversation found ----

  test("returns 404 when no conversation state exists", async () => {
    const res = await savePost(jsonRequest("POST"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(404);
    expect(json.error).toBe(
      "No conversation found. Please complete onboarding first.",
    );
  });

  // ---- Draft validation ----

  test("returns 400 when draft validation fails", async () => {
    const state = makeState({ draft: {} });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    validateDraftMock.mockReturnValue({
      valid: false,
      missingRequired: ["target_roles", "industries"],
    });

    const res = await savePost(jsonRequest("POST"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(json.error).toBe("Missing required preferences");
    expect(json.missingSteps).toEqual(["target_roles", "industries"]);
  });

  test("draft with empty arrays for required fields fails validation", async () => {
    const state = makeState({
      draft: {
        targetTitles: [],
        companySizes: [],
        targetSeniority: ["senior"],
        coreSkills: ["test"],
        preferredLocations: ["US"],
        industries: ["fintech"],
      },
    });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    validateDraftMock.mockReturnValue({
      valid: false,
      missingRequired: ["target_roles", "company_sizes"],
    });

    const res = await savePost(jsonRequest("POST"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(json.missingSteps).toEqual(["target_roles", "company_sizes"]);
  });

  // ---- Happy path: transaction ----

  test("saves valid draft within a transaction", async () => {
    const draft = {
      targetTitles: ["QA Lead"],
      targetSeniority: ["senior"],
      coreSkills: ["Selenium"],
      preferredLocations: ["Israel"],
      industries: ["fintech"],
      companySizes: ["startup"],
      growthSkills: ["AI testing"],
      avoidSkills: ["manual testing"],
      dealBreakers: ["travel"],
      minSalary: 120000,
      targetSalary: 150000,
      salaryCurrency: "USD",
      remotePreference: "remote_only",
      weightRole: 0.3,
      weightSkills: 0.25,
      weightLocation: 0.2,
      weightCompensation: 0.15,
      weightDomain: 0.1,
      companyStages: ["series_a"],
      workFormat: "remote_first",
      hqGeographies: ["US", "EU"],
      productTypes: ["B2B SaaS"],
      exclusions: ["gambling"],
    };
    const state = makeState({ draft });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    validateDraftMock.mockReturnValue({
      valid: true,
      missingRequired: [],
    });
    markCompletedMock.mockReturnValue(
      makeState({ ...state, status: "completed" }),
    );

    const res = await savePost(jsonRequest("POST"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockTransaction).toHaveBeenCalled();

    // Three writes inside the transaction:
    // 1. insert userProfiles, 2. insert userCompanyPreferences
    expect(txInsert).toHaveBeenCalledTimes(2);
    // 3. update conversationStates
    expect(txUpdate).toHaveBeenCalledTimes(1);
  });

  test("user profiles upsert maps draft fields correctly", async () => {
    const draft = {
      targetTitles: ["QA Lead"],
      targetSeniority: ["senior"],
      coreSkills: ["Selenium"],
      growthSkills: ["AI testing"],
      avoidSkills: ["manual"],
      dealBreakers: ["travel"],
      preferredLocations: ["Tel Aviv"],
      remotePreference: "hybrid_ok",
      minSalary: 120000,
      targetSalary: 150000,
      salaryCurrency: "EUR",
      industries: ["fintech"],
      weightRole: 0.3,
      weightSkills: 0.25,
      weightLocation: 0.2,
      weightCompensation: 0.15,
      weightDomain: 0.1,
      companySizes: ["startup"],
    };
    const state = makeState({ draft });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    validateDraftMock.mockReturnValue({
      valid: true,
      missingRequired: [],
    });
    markCompletedMock.mockReturnValue(makeState({ status: "completed" }));

    await savePost(jsonRequest("POST"));

    const profileValues = txInsertValuesCalls[0] as Record<string, unknown>;

    expect(profileValues.userId).toBe("u1");
    expect(profileValues.targetTitles).toEqual(["QA Lead"]);
    expect(profileValues.targetSeniority).toEqual(["senior"]);
    expect(profileValues.coreSkills).toEqual(["Selenium"]);
    expect(profileValues.growthSkills).toEqual(["AI testing"]);
    expect(profileValues.avoidSkills).toEqual(["manual"]);
    expect(profileValues.dealBreakers).toEqual(["travel"]);
    expect(profileValues.preferredLocations).toEqual(["Tel Aviv"]);
    expect(profileValues.remotePreference).toBe("hybrid_ok");
    expect(profileValues.minSalary).toBe(120000);
    expect(profileValues.targetSalary).toBe(150000);
    expect(profileValues.salaryCurrency).toBe("EUR");
    expect(profileValues.preferredIndustries).toEqual(["fintech"]);
    expect(profileValues.weightRole).toBe(0.3);
  });

  test("company preferences upsert maps draft fields correctly", async () => {
    const draft = {
      targetTitles: ["QA"],
      targetSeniority: ["senior"],
      coreSkills: ["test"],
      preferredLocations: ["US"],
      industries: ["fintech", "healthtech"],
      companySizes: ["startup"],
      companyStages: ["series_a"],
      workFormat: "remote_first",
      hqGeographies: ["US", "EU"],
      productTypes: ["B2B SaaS"],
      exclusions: ["gambling"],
    };
    const state = makeState({ draft });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    validateDraftMock.mockReturnValue({
      valid: true,
      missingRequired: [],
    });
    markCompletedMock.mockReturnValue(makeState({ status: "completed" }));

    await savePost(jsonRequest("POST"));

    const companyValues = txInsertValuesCalls[1] as Record<string, unknown>;

    expect(companyValues.userId).toBe("u1");
    expect(companyValues.industries).toEqual(["fintech", "healthtech"]);
    expect(companyValues.companySizes).toEqual(["startup"]);
    expect(companyValues.companyStages).toEqual(["series_a"]);
    expect(companyValues.workFormat).toBe("remote_first");
    expect(companyValues.hqGeographies).toEqual(["US", "EU"]);
    expect(companyValues.productTypes).toEqual(["B2B SaaS"]);
    expect(companyValues.exclusions).toEqual(["gambling"]);
  });

  test("industries field maps to BOTH tables", async () => {
    const draft = {
      targetTitles: ["QA"],
      targetSeniority: ["senior"],
      coreSkills: ["test"],
      preferredLocations: ["US"],
      industries: ["fintech", "healthtech"],
      companySizes: ["startup"],
    };
    const state = makeState({ draft });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    validateDraftMock.mockReturnValue({
      valid: true,
      missingRequired: [],
    });
    markCompletedMock.mockReturnValue(makeState({ status: "completed" }));

    await savePost(jsonRequest("POST"));

    const profileValues = txInsertValuesCalls[0] as Record<string, unknown>;
    const companyValues = txInsertValuesCalls[1] as Record<string, unknown>;

    expect(profileValues.preferredIndustries).toEqual([
      "fintech",
      "healthtech",
    ]);
    expect(companyValues.industries).toEqual(["fintech", "healthtech"]);
  });

  // ---- Null-coalescion defaults ----

  test("null-coalescion defaults applied for optional fields", async () => {
    const draft = {
      targetTitles: ["QA"],
      targetSeniority: ["senior"],
      coreSkills: ["test"],
      preferredLocations: ["US"],
      industries: ["fintech"],
      companySizes: ["startup"],
      // All optional fields left undefined
    };
    const state = makeState({ draft });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    validateDraftMock.mockReturnValue({
      valid: true,
      missingRequired: [],
    });
    markCompletedMock.mockReturnValue(makeState({ status: "completed" }));

    await savePost(jsonRequest("POST"));

    const profileValues = txInsertValuesCalls[0] as Record<string, unknown>;
    const companyValues = txInsertValuesCalls[1] as Record<string, unknown>;

    // Profile defaults
    expect(profileValues.growthSkills).toEqual([]);
    expect(profileValues.avoidSkills).toEqual([]);
    expect(profileValues.dealBreakers).toEqual([]);
    expect(profileValues.salaryCurrency).toBe("USD");
    expect(profileValues.remotePreference).toBe("any");
    expect(profileValues.minSalary).toBeNull();
    expect(profileValues.targetSalary).toBeNull();
    expect(profileValues.weightRole).toBe(0.25);
    expect(profileValues.weightSkills).toBe(0.25);
    expect(profileValues.weightLocation).toBe(0.2);
    expect(profileValues.weightCompensation).toBe(0.15);
    expect(profileValues.weightDomain).toBe(0.15);

    // Company defaults
    expect(companyValues.companyStages).toEqual([]);
    expect(companyValues.workFormat).toBeNull();
    expect(companyValues.hqGeographies).toEqual([]);
    expect(companyValues.productTypes).toEqual([]);
    expect(companyValues.exclusions).toEqual([]);
  });

  // ---- markCompleted ----

  test("markCompleted is called and state persisted as completed", async () => {
    const draft = {
      targetTitles: ["QA"],
      targetSeniority: ["senior"],
      coreSkills: ["test"],
      preferredLocations: ["US"],
      industries: ["fintech"],
      companySizes: ["startup"],
    };
    const state = makeState({ draft });
    const completedState = makeState({ draft, status: "completed" });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    validateDraftMock.mockReturnValue({
      valid: true,
      missingRequired: [],
    });
    markCompletedMock.mockReturnValue(completedState);

    await savePost(jsonRequest("POST"));

    expect(markCompletedMock).toHaveBeenCalledWith(state);
    expect(serializeStateMock).toHaveBeenCalledWith(completedState);

    expect(txUpdateSetCalls.length).toBe(1);
    const stateUpdate = txUpdateSetCalls[0] as Record<string, unknown>;
    expect(stateUpdate).toHaveProperty("state");
    expect(stateUpdate).toHaveProperty("updatedAt");
  });

  // ---- Error handling ----

  test("returns 500 for unexpected errors during transaction", async () => {
    const state = makeState({
      draft: {
        targetTitles: ["QA"],
        targetSeniority: ["senior"],
        coreSkills: ["test"],
        preferredLocations: ["US"],
        industries: ["fintech"],
        companySizes: ["startup"],
      },
    });
    selectResult.push({ id: "conv-1", state: {}, userId: "u1" });
    deserializeStateMock.mockReturnValue(state);
    validateDraftMock.mockReturnValue({
      valid: true,
      missingRequired: [],
    });
    mockTransaction.mockRejectedValueOnce(new Error("deadlock detected"));

    const res = await savePost(jsonRequest("POST"));
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(500);
    expect(json.error).toBe("Failed to save preferences");
  });
});

// ===========================================================================
// Cross-route auth guard consistency
// ===========================================================================

describe("auth guard consistency across all routes", () => {
  test.each([
    [
      "POST /api/chatbot/message",
      () => messagePost(jsonRequest("POST", { message: "hello" })),
    ],
    ["GET /api/chatbot/state", () => stateGet(jsonRequest("GET"))],
    ["POST /api/chatbot/save", () => savePost(jsonRequest("POST"))],
  ] as [string, () => Promise<Response>][])(
    "%s returns 401 when session is null",
    async (_route, callRoute) => {
      getSessionMock.mockResolvedValueOnce(null);

      const res = await callRoute();
      const json = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(401);
      expect(json.error).toBe("Authentication required");
    },
  );
});
