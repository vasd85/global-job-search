import type { ConversationState, PreferencesDraft } from "./schemas";
import { STEPS, getStepIndex } from "./steps";
import {
  createInitialState,
  applyExtraction,
  advanceStep,
  skipCurrentStep,
  goToStep,
  markCompleted,
  validateDraft,
  deserializeState,
  serializeState,
  applyDefaultWeights,
  DEFAULT_WEIGHTS,
} from "./state";

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

// ─── createInitialState ────────────────────────────────────────────────────

describe("createInitialState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns correct shape with step 0, empty draft, and in_progress status", () => {
    const state = createInitialState();
    expect(state).toEqual({
      currentStepIndex: 0,
      draft: {},
      completedSteps: [],
      status: "in_progress",
      createdAt: FROZEN_TIME,
      updatedAt: FROZEN_TIME,
    });
  });
});

// ─── applyExtraction ───────────────────────────────────────────────────────

describe("applyExtraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("merges fields into draft and strips meta-fields", () => {
    const state = stateAtStep(0);
    const extraction = {
      targetTitles: ["SWE"],
      confidence: "high",
      clarificationNeeded: false,
    };

    const result = applyExtraction(state, "target_roles", extraction);

    expect(result.draft).toEqual({ targetTitles: ["SWE"] });
    expect(result.draft).not.toHaveProperty("confidence");
    expect(result.draft).not.toHaveProperty("clarificationNeeded");
  });

  test("adds step slug to completedSteps", () => {
    const state = stateAtStep(0);
    const result = applyExtraction(state, "target_roles", {
      targetTitles: ["SWE"],
    });
    expect(result.completedSteps).toContain("target_roles");
  });

  test("does not duplicate step slug in completedSteps", () => {
    const state = stateAtStep(0, { completedSteps: ["target_roles"] });
    const result = applyExtraction(state, "target_roles", {
      targetTitles: ["QA"],
    });
    expect(
      result.completedSteps.filter((s) => s === "target_roles"),
    ).toHaveLength(1);
  });

  test("preserves existing draft fields when merging new ones", () => {
    const state = stateAtStep(2, { draft: { targetTitles: ["SWE"] } });
    const result = applyExtraction(state, "core_skills", {
      coreSkills: ["JS"],
    });
    expect(result.draft.targetTitles).toEqual(["SWE"]);
    expect(result.draft.coreSkills).toEqual(["JS"]);
  });

  test("overwrites same-key fields on re-extraction", () => {
    const state = stateAtStep(0, { draft: { targetTitles: ["SWE"] } });
    const result = applyExtraction(state, "target_roles", {
      targetTitles: ["QA Engineer"],
    });
    expect(result.draft.targetTitles).toEqual(["QA Engineer"]);
  });

  test("updates updatedAt timestamp", () => {
    const oldTime = "2026-01-01T12:00:00.000Z";
    const state = stateAtStep(0, { updatedAt: oldTime });
    const result = applyExtraction(state, "target_roles", {
      targetTitles: ["SWE"],
    });
    expect(result.updatedAt).not.toBe(oldTime);
    expect(result.updatedAt).toBe(FROZEN_TIME);
  });

  // TODO: Extra unknown fields in extraction objects silently spread into
  // the draft. The code does `{ ...state.draft, ...draftFields }` with no
  // validation against PreferencesDraftSchema. This could pollute the draft
  // with unexpected data.
  test("extra unknown fields in extraction silently spread into draft", () => {
    const state = stateAtStep(0);
    const extraction = {
      targetTitles: ["SWE"],
      unknownField: "value",
      confidence: "high",
      clarificationNeeded: false,
    };

    const result = applyExtraction(state, "target_roles", extraction);
    // unknownField is not in META_KEYS, so it gets spread
    expect((result.draft as Record<string, unknown>)["unknownField"]).toBe(
      "value",
    );
  });
});

// ─── advanceStep ────────────────────────────────────────────────────────────

describe("advanceStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("increments currentStepIndex by 1", () => {
    const state = stateAtStep(0);
    const result = advanceStep(state);
    expect(result.currentStepIndex).toBe(1);
    expect(result.status).toBe("in_progress");
  });

  test("transitions to review status when reaching review step", () => {
    const state = stateAtStep(15);
    const result = advanceStep(state);
    expect(result.currentStepIndex).toBe(16);
    expect(result.status).toBe("review");
  });

  test("clamps to last step when past end", () => {
    const state = stateAtStep(16, { status: "review" });
    const result = advanceStep(state);
    expect(result.currentStepIndex).toBe(STEPS.length - 1);
    expect(result.status).toBe("review");
  });

  test("from the second-to-last step (dimension_weights, index 15) reaches review", () => {
    const state = stateAtStep(STEPS.length - 2);
    const result = advanceStep(state);
    expect(result.currentStepIndex).toBe(16);
    expect(result.status).toBe("review");
  });

  test("multiple calls when already at review stay idempotent", () => {
    const state = stateAtStep(16, { status: "review" });
    const r1 = advanceStep(state);
    const r2 = advanceStep(r1);
    expect(r2.currentStepIndex).toBe(16);
    expect(r2.status).toBe("review");
  });
});

// ─── skipCurrentStep ────────────────────────────────────────────────────────

describe("skipCurrentStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("advances past a skippable step", () => {
    // growth_skills is at index 3, skippable=true
    const state = stateAtStep(3);
    const result = skipCurrentStep(state);
    expect(result.currentStepIndex).toBe(4);
    expect(result.completedSteps).toContain("growth_skills");
  });

  test("returns state unchanged for non-skippable step", () => {
    // target_roles is at index 0, skippable=false
    const state = stateAtStep(0);
    const result = skipCurrentStep(state);
    expect(result).toBe(state);
  });

  test("on an out-of-bounds index returns state unchanged", () => {
    const state = stateAtStep(999);
    const result = skipCurrentStep(state);
    expect(result).toBe(state);
  });
});

// ─── goToStep ───────────────────────────────────────────────────────────────

describe("goToStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("jumps to valid step and resets status to in_progress", () => {
    const state = stateAtStep(16, { status: "review" });
    const result = goToStep(state, "target_roles");
    expect(result.currentStepIndex).toBe(0);
    expect(result.status).toBe("in_progress");
  });

  test("returns state unchanged for unknown slug", () => {
    const state = stateAtStep(16, { status: "review" });
    const result = goToStep(state, "nonexistent");
    expect(result).toBe(state);
  });

  test("goToStep to review step sets status to review", () => {
    const state = stateAtStep(0);
    const result = goToStep(state, "review");
    expect(result.currentStepIndex).toBe(16);
    expect(result.status).toBe("review");
  });
});

// ─── markCompleted ──────────────────────────────────────────────────────────

describe("markCompleted", () => {
  test("sets status to completed", () => {
    const state = stateAtStep(16, { status: "review" });
    const result = markCompleted(state);
    expect(result.status).toBe("completed");
  });
});

// ─── validateDraft ──────────────────────────────────────────────────────────

describe("validateDraft", () => {
  test("returns valid when all required fields present", () => {
    const draft: PreferencesDraft = {
      targetTitles: ["SWE"],
      targetSeniority: ["senior"],
      coreSkills: ["JS"],
      locationPreferences: {
        tiers: [
          { rank: 1, workFormats: ["remote"], scope: { type: "cities", include: ["NYC"] } },
        ],
      },
      industries: ["fintech"],
      companySizes: ["startup"],
    };
    const result = validateDraft(draft);
    expect(result).toEqual({ valid: true, missingRequired: [] });
  });

  test("returns invalid with all missing required fields listed", () => {
    const result = validateDraft({});
    expect(result.valid).toBe(false);
    expect(result.missingRequired).toEqual(
      expect.arrayContaining([
        "target_roles",
        "target_seniority",
        "core_skills",
        "location",
        "industries",
        "company_sizes",
      ]),
    );
    expect(result.missingRequired).toHaveLength(6);
  });

  test("treats empty arrays as missing", () => {
    const result = validateDraft({ targetTitles: [] });
    expect(result.missingRequired).toContain("target_roles");
  });
});

// ─── deserializeState / serializeState ──────────────────────────────────────

describe("deserializeState", () => {
  test("validates raw JSONB from DB", () => {
    const raw = {
      currentStepIndex: 0,
      draft: {},
      completedSteps: [],
      status: "in_progress",
      createdAt: "2026-01-15T12:00:00.000Z",
      updatedAt: "2026-01-15T12:00:00.000Z",
    };

    const result = deserializeState(raw);
    expect(result.currentStepIndex).toBe(0);
    expect(result.status).toBe("in_progress");
  });

  test("falls back to raw state on schema mismatch instead of throwing", () => {
    const corrupt = {
      currentStepIndex: "not a number",
      draft: {},
    };
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = deserializeState(corrupt);
    expect(result).toBe(corrupt);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("serializeState", () => {
  test("produces JSON-safe output", () => {
    const state = stateAtStep(0);
    const serialized = serializeState(state);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- JSON.parse always returns unknown; safe in test context
    const roundTripped = JSON.parse(JSON.stringify(serialized));
    expect(roundTripped).toEqual(serialized);
  });
});

// ─── DEFAULT_WEIGHTS ────────────────────────────────────────────────────────

describe("DEFAULT_WEIGHTS", () => {
  test("sum to 1.0", () => {
    const sum =
      (DEFAULT_WEIGHTS.weightRole ?? 0) +
      (DEFAULT_WEIGHTS.weightSkills ?? 0) +
      (DEFAULT_WEIGHTS.weightLocation ?? 0) +
      (DEFAULT_WEIGHTS.weightCompensation ?? 0) +
      (DEFAULT_WEIGHTS.weightDomain ?? 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

// ─── applyDefaultWeights ────────────────────────────────────────────────────

describe("applyDefaultWeights", () => {
  test("sets all five weights when none are set", () => {
    const draft: PreferencesDraft = {};
    const result = applyDefaultWeights(draft);
    expect(result.weightRole).toBe(DEFAULT_WEIGHTS.weightRole);
    expect(result.weightSkills).toBe(DEFAULT_WEIGHTS.weightSkills);
    expect(result.weightLocation).toBe(DEFAULT_WEIGHTS.weightLocation);
    expect(result.weightCompensation).toBe(DEFAULT_WEIGHTS.weightCompensation);
    expect(result.weightDomain).toBe(DEFAULT_WEIGHTS.weightDomain);
  });

  test("returns same draft reference when all weights already set", () => {
    const draft: PreferencesDraft = {
      weightRole: 0.3,
      weightSkills: 0.3,
      weightLocation: 0.2,
      weightCompensation: 0.1,
      weightDomain: 0.1,
    };
    const result = applyDefaultWeights(draft);
    expect(result).toBe(draft);
  });

  // TODO: applyDefaultWeights replaces ALL weights with defaults when only
  // some are set, rather than filling only the missing ones. This means
  // a user who sets only weightRole = 0.5 will have it overwritten with
  // the default value. The current behavior should be documented because
  // it may surprise callers who expect a merge.
  test("applies defaults when only some weights are set (overwrites partial)", () => {
    const draft: PreferencesDraft = { weightRole: 0.5 };
    const result = applyDefaultWeights(draft);
    expect(result.weightRole).toBe(DEFAULT_WEIGHTS.weightRole);
    expect(result.weightSkills).toBe(DEFAULT_WEIGHTS.weightSkills);
  });
});

// ─── advanceStep: editingFromReview behavior ──────────────────────────────

describe("advanceStep: editingFromReview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns to review when editingFromReview is true", () => {
    const reviewIndex = getStepIndex("review");
    const state = stateAtStep(2, { editingFromReview: true });
    const result = advanceStep(state);
    expect(result.currentStepIndex).toBe(reviewIndex);
    expect(result.status).toBe("review");
  });

  test("clears editingFromReview flag after returning to review", () => {
    const state = stateAtStep(2, { editingFromReview: true });
    const result = advanceStep(state);
    expect(result.editingFromReview).toBeUndefined();
  });

  test("advances normally when editingFromReview is absent", () => {
    const state = stateAtStep(2);
    const result = advanceStep(state);
    expect(result.currentStepIndex).toBe(3);
  });

  test("advances normally when editingFromReview is explicitly undefined", () => {
    const state = stateAtStep(2, { editingFromReview: undefined });
    const result = advanceStep(state);
    expect(result.currentStepIndex).toBe(3);
  });

  test("uses getStepIndex('review') result for target index", () => {
    const reviewIndex = getStepIndex("review");
    const state = stateAtStep(5, { editingFromReview: true });
    const result = advanceStep(state);
    expect(result.currentStepIndex).toBe(reviewIndex);
  });

  test("updates the timestamp when returning to review", () => {
    const oldTime = "2026-01-01T12:00:00.000Z";
    const state = stateAtStep(2, {
      editingFromReview: true,
      updatedAt: oldTime,
    });
    const result = advanceStep(state);
    expect(result.updatedAt).toBe(FROZEN_TIME);
    expect(result.updatedAt).not.toBe(oldTime);
  });
});

// ─── advanceStep: editingFromReview corner case ───────────────────────────

describe("advanceStep: editingFromReview corner case", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns to review even when status is in_progress (flag is authority)", () => {
    // The advanceStep function only checks state.editingFromReview,
    // not state.status. If something sets the flag incorrectly on an
    // in_progress state, advanceStep still jumps to review.
    const state = stateAtStep(2, {
      status: "in_progress",
      editingFromReview: true,
    });
    const result = advanceStep(state);
    expect(result.currentStepIndex).toBe(getStepIndex("review"));
    expect(result.status).toBe("review");
  });
});

// ─── goToStep: editingFromReview flag setting ─────────────────────────────

describe("goToStep: editingFromReview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_TIME));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("from review to non-review step sets editingFromReview: true", () => {
    const state = stateAtStep(16, { status: "review" });
    const result = goToStep(state, "core_skills");
    expect(result.editingFromReview).toBe(true);
    expect(result.status).toBe("in_progress");
    expect(result.currentStepIndex).toBe(2);
  });

  test("from review to review step does NOT set editingFromReview", () => {
    const state = stateAtStep(16, { status: "review" });
    const result = goToStep(state, "review");
    expect(result.editingFromReview).toBeUndefined();
    expect(result.status).toBe("review");
  });

  test("from in_progress status does NOT set editingFromReview", () => {
    const state = stateAtStep(0, { status: "in_progress" });
    const result = goToStep(state, "core_skills");
    expect(result.editingFromReview).toBeUndefined();
  });

  test("from in_progress to review sets status without editingFromReview", () => {
    const state = stateAtStep(0, { status: "in_progress" });
    const result = goToStep(state, "review");
    expect(result.status).toBe("review");
    expect(result.editingFromReview).toBeUndefined();
  });

  test("unknown slug returns state unchanged (no editingFromReview leak)", () => {
    const state = stateAtStep(16, { status: "review" });
    const result = goToStep(state, "nonexistent");
    expect(result).toBe(state);
    expect(result.editingFromReview).toBeUndefined();
  });
});

// ─── validateDraft: locationPreferences special case ──────────────────────

describe("validateDraft: locationPreferences", () => {
  // Base draft with all required fields except locationPreferences
  const baseDraft: PreferencesDraft = {
    targetTitles: ["SWE"],
    targetSeniority: ["senior"],
    coreSkills: ["JS"],
    industries: ["fintech"],
    companySizes: ["startup"],
  };

  test("treats locationPreferences with empty tiers as missing", () => {
    const result = validateDraft({
      ...baseDraft,
      locationPreferences: { tiers: [] },
    });
    expect(result.missingRequired).toContain("location");
  });

  test("accepts locationPreferences with at least one tier", () => {
    const result = validateDraft({
      ...baseDraft,
      locationPreferences: {
        tiers: [
          {
            rank: 1,
            workFormats: ["remote"],
            scope: { type: "any", include: [] },
          },
        ],
      },
    });
    expect(result.missingRequired).not.toContain("location");
  });

  test("treats locationPreferences without tiers property as missing", () => {
    const result = validateDraft({
      ...baseDraft,
      // Cast needed: simulating corrupt state where tiers key is absent
      locationPreferences: {} as PreferencesDraft["locationPreferences"],
    });
    expect(result.missingRequired).toContain("location");
  });

  // TODO: A flat array in locationPreferences (old-style data) passes
  // validation because the typeof-object/isArray check rejects it, then
  // it falls through to the array check which sees a non-empty array.
  // This is a false-negative: semantically invalid data passes as valid.
  test("locationPreferences as array (wrong shape) is not flagged as missing", () => {
    const draft = {
      ...baseDraft,
      locationPreferences: ["NYC", "London"],
    };
    const result = validateDraft(
      draft as unknown as PreferencesDraft,
    );
    // Falls through typeof-object check (arrays are objects but
    // Array.isArray rejects), then the generic array check sees
    // length > 0, so it is NOT flagged as missing.
    expect(result.missingRequired).not.toContain("location");
  });

  test("locationPreferences as non-object string does not crash", () => {
    const draft = {
      ...baseDraft,
      locationPreferences: "NYC",
    };
    const result = validateDraft(
      draft as unknown as PreferencesDraft,
    );
    // typeof "NYC" === "string", so the object check fails.
    // Then Array.isArray("NYC") is false, so it is NOT flagged.
    expect(result.missingRequired).not.toContain("location");
  });
});

// ─── deserializeState: lenient fallback ───────────────────────────────────

describe("deserializeState: lenient fallback", () => {
  test("returns parsed data when schema is valid", () => {
    const raw = {
      currentStepIndex: 0,
      draft: {},
      completedSteps: [],
      status: "in_progress",
      createdAt: "2026-01-15T12:00:00.000Z",
      updatedAt: "2026-01-15T12:00:00.000Z",
    };
    const result = deserializeState(raw);
    expect(result.currentStepIndex).toBe(0);
    expect(result.status).toBe("in_progress");
    // Parsed through Zod, not raw reference
    expect(result).not.toBe(raw);
  });

  test("returns raw value as-is when schema validation fails", () => {
    const corrupt = {
      currentStepIndex: "not a number",
      draft: {},
    };
    const consoleSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const result = deserializeState(corrupt);
    expect(result).toBe(corrupt);
    consoleSpy.mockRestore();
  });

  test("logs warning message containing 'schema mismatch'", () => {
    const corrupt = { currentStepIndex: "bad" };
    const consoleSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    deserializeState(corrupt);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("schema mismatch"),
      expect.any(String),
    );
    consoleSpy.mockRestore();
  });

  test("falls back for future enum values not in current schema", () => {
    const futureState = {
      currentStepIndex: 0,
      draft: {},
      completedSteps: [],
      status: "paused", // future value not in ConversationStatus
      createdAt: "2026-01-15T12:00:00.000Z",
      updatedAt: "2026-01-15T12:00:00.000Z",
    };
    const consoleSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const result = deserializeState(futureState);
    // safeParse fails, returns raw cast
    expect(result).toBe(futureState);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test.each([null, "hello", 42])(
    "falls back for completely non-object input: %s",
    (input) => {
      const consoleSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      const result = deserializeState(input);
      // Returns raw as ConversationState regardless
      expect(result).toBe(input);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    },
  );

  test("preserves editingFromReview field when schema is valid", () => {
    const raw = {
      currentStepIndex: 2,
      draft: {},
      completedSteps: [],
      status: "in_progress",
      editingFromReview: true,
      createdAt: "2026-01-15T12:00:00.000Z",
      updatedAt: "2026-01-15T12:00:00.000Z",
    };
    const result = deserializeState(raw);
    expect(result.editingFromReview).toBe(true);
  });

  test("fallback returns structurally invalid data (crash-at-use tradeoff)", () => {
    const corrupt = {
      draft: null,
      currentStepIndex: -5,
      completedSteps: "not an array",
    };
    const consoleSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const result = deserializeState(corrupt);
    // Does not throw at deserialization time
    expect(result).toBe(corrupt);
    // But downstream usage would crash:
    // e.g., result.draft.targetTitles -> TypeError: Cannot read properties of null
    expect(result.draft).toBeNull();
    consoleSpy.mockRestore();
  });
});
