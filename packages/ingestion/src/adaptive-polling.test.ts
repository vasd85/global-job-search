import {
  computeNextPoll,
  type AdaptivePollInput,
  type AdaptivePollOutput,
  type PollPriority,
} from "./adaptive-polling";

// ─── Constants ──────────────────────────────────────────────────────────────

const NOW = new Date("2025-06-15T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Create an AdaptivePollInput with sensible defaults. */
function makeInput(overrides: Partial<AdaptivePollInput> = {}): AdaptivePollInput {
  return {
    lastPollStatus: "ok",
    consecutiveErrors: 0,
    // TODO: lastPolledAt is accepted in AdaptivePollInput but never read
    // by computeNextPoll(). Consider removing from the interface or using
    // it for a future heuristic.
    lastPolledAt: NOW,
    createdAt: new Date(NOW.getTime() - 60 * DAY_MS), // 60 days old by default
    lastChangedAt: null, // null = never had changes, falls back to createdAt
    jobsNew: 0,
    jobsClosed: 0,
    ...overrides,
  };
}

/** Return the expected nextPollAfter Date given a delay in hours from NOW. */
function expectedTime(delayHours: number): Date {
  return new Date(NOW.getTime() + delayHours * HOUR_MS);
}

// ─── Error path ─────────────────────────────────────────────────────────────

describe("computeNextPoll -- error path", () => {
  test.each<{
    label: string;
    status: string;
    prevErrors: number;
    expectedPriority: PollPriority;
    expectedDelayHours: number;
    expectedErrors: number;
  }>([
    {
      label: "first error schedules daily retry",
      status: "error",
      prevErrors: 0,
      expectedPriority: "daily",
      expectedDelayHours: 24,
      expectedErrors: 1,
    },
    {
      label: "second error still schedules daily",
      status: "error",
      prevErrors: 1,
      expectedPriority: "daily",
      expectedDelayHours: 24,
      expectedErrors: 2,
    },
    {
      label: "third error triggers backoff at threshold (7d * 1)",
      status: "error",
      prevErrors: 2,
      expectedPriority: "weekly",
      expectedDelayHours: 168,
      expectedErrors: 3,
    },
    {
      label: "fourth error increases backoff multiplier (7d * 2)",
      status: "error",
      prevErrors: 3,
      expectedPriority: "weekly",
      expectedDelayHours: 336,
      expectedErrors: 4,
    },
    {
      label: "sixth error hits backoff cap boundary (7d * 4)",
      status: "error",
      prevErrors: 5,
      expectedPriority: "weekly",
      expectedDelayHours: 672,
      expectedErrors: 6,
    },
    {
      label: "backoff multiplier caps at 4 (28 days max) for high error count",
      status: "error",
      prevErrors: 10,
      expectedPriority: "weekly",
      expectedDelayHours: 672,
      expectedErrors: 11,
    },
    {
      label: '"not_found" is treated identically to "error" (first error)',
      status: "not_found",
      prevErrors: 0,
      expectedPriority: "daily",
      expectedDelayHours: 24,
      expectedErrors: 1,
    },
    {
      label: '"not_found" with backoff (prevErrors: 4)',
      status: "not_found",
      prevErrors: 4,
      expectedPriority: "weekly",
      expectedDelayHours: 504,
      expectedErrors: 5,
    },
  ])(
    "$label",
    ({ status, prevErrors, expectedPriority, expectedDelayHours, expectedErrors }) => {
      const result = computeNextPoll(
        makeInput({ lastPollStatus: status, consecutiveErrors: prevErrors }),
        NOW
      );

      expect(result).toEqual({
        nextPollAfter: expectedTime(expectedDelayHours),
        pollPriority: expectedPriority,
        consecutiveErrors: expectedErrors,
      });
    }
  );

  test("error path ignores jobsNew/jobsClosed values", () => {
    const result = computeNextPoll(
      makeInput({
        lastPollStatus: "error",
        consecutiveErrors: 0,
        jobsNew: 50,
        jobsClosed: 10,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 1,
    });
  });
});

// ─── New company path (<7 days) ─────────────────────────────────────────────

describe("computeNextPoll -- new company (<7 days old)", () => {
  test("company created today with no changes -> daily", () => {
    const result = computeNextPoll(
      makeInput({ createdAt: NOW, jobsNew: 0, jobsClosed: 0 }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    });
  });

  test("company created 6.9 days ago (just under threshold) -> daily", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 6.9 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    });
  });

  test("company created exactly 7.0 days ago -> NOT treated as new (falls to stable)", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 7 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    // Exactly 7 days: companyAgeDays == 7, NOT < 7, so not new.
    // Falls through to staleness: >= 7 days -> "regular" (72h).
    expect(result).toEqual({
      nextPollAfter: expectedTime(72),
      pollPriority: "regular",
      consecutiveErrors: 0,
    });
  });

  test("new company resets consecutiveErrors on success", () => {
    const result = computeNextPoll(
      makeInput({
        consecutiveErrors: 5,
        createdAt: new Date(NOW.getTime() - 1 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    expect(result.consecutiveErrors).toBe(0);
  });

  test("new company with active changes still returns daily (not double-scheduled)", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 3 * DAY_MS),
        jobsNew: 5,
        jobsClosed: 2,
      }),
      NOW
    );

    // The new-company check runs before the active-changes check.
    // Both would produce "daily", but the new-company path takes precedence.
    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    });
  });
});

// ─── Active company path (had changes) ─────────────────────────────────────

describe("computeNextPoll -- active company (had changes)", () => {
  test("old company with new jobs -> daily", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        jobsNew: 3,
        jobsClosed: 0,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    });
  });

  test("old company with closed jobs only -> daily", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 5,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    });
  });

  test("old company with both new and closed jobs -> daily", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        jobsNew: 2,
        jobsClosed: 3,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    });
  });

  test("active company with prior errors resets consecutiveErrors", () => {
    const result = computeNextPoll(
      makeInput({
        consecutiveErrors: 8,
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        jobsNew: 1,
        jobsClosed: 0,
      }),
      NOW
    );

    expect(result.consecutiveErrors).toBe(0);
  });
});

// ─── Staleness tiers (no changes) ──────────────────────────────────────────

describe("computeNextPoll -- stable tiers (no changes)", () => {
  test("company 30+ days old -> weekly (very stable)", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 30 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(168),
      pollPriority: "weekly",
      consecutiveErrors: 0,
    });
  });

  test("company exactly 30 days old -> weekly (boundary)", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 30 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    // >= 30 days -> weekly
    expect(result.pollPriority).toBe("weekly");
    expect(result.nextPollAfter).toEqual(expectedTime(168));
  });

  test("company 29.9 days old -> regular (stable, not very stable)", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 29.9 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(72),
      pollPriority: "regular",
      consecutiveErrors: 0,
    });
  });

  test("company 7 days old with no changes -> regular (stable)", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 7 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(72),
      pollPriority: "regular",
      consecutiveErrors: 0,
    });
  });

  test("company 365 days old with no changes -> weekly", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 365 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(168),
      pollPriority: "weekly",
      consecutiveErrors: 0,
    });
  });
});

// ─── "empty" status ─────────────────────────────────────────────────────────

describe('computeNextPoll -- "empty" status', () => {
  test('"empty" is treated as a successful poll, not an error', () => {
    const result = computeNextPoll(
      makeInput({
        lastPollStatus: "empty",
        consecutiveErrors: 3,
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    // "empty" does not enter the error path; resets errors and
    // falls through to staleness tiers (60 days, no changes -> weekly)
    expect(result).toEqual({
      nextPollAfter: expectedTime(168),
      pollPriority: "weekly",
      consecutiveErrors: 0,
    });
  });

  test('"empty" for a new company -> daily', () => {
    const result = computeNextPoll(
      makeInput({
        lastPollStatus: "empty",
        consecutiveErrors: 0,
        createdAt: new Date(NOW.getTime() - 3 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    });
  });
});

// ─── Fallback path ──────────────────────────────────────────────────────────

describe("computeNextPoll -- fallback (unreachable for valid inputs)", () => {
  test("company 3 days old with no changes -> daily (caught by new-company path)", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 3 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    // This input is caught by the new-company check (3 < 7).
    // The generic fallback at the end of the function is never reached.
    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    });
  });
});

// ─── `now` parameter ────────────────────────────────────────────────────────

describe("computeNextPoll -- now parameter", () => {
  test("custom now parameter is used for all date calculations", () => {
    const customNow = new Date("2025-06-15T12:00:00Z");
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date("2025-01-01T12:00:00Z"),
        jobsNew: 1,
        jobsClosed: 0,
      }),
      customNow
    );

    // Active company -> daily (24h from customNow)
    expect(result.nextPollAfter).toEqual(
      new Date(customNow.getTime() + 24 * HOUR_MS)
    );
  });

  test("default now parameter uses current time when omitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-08-01T12:00:00Z"));

    try {
      const result = computeNextPoll(
        makeInput({
          // 60 days old relative to the faked clock -> well past "new"
          createdAt: new Date("2025-06-01T12:00:00Z"),
          jobsNew: 1,
          jobsClosed: 0,
        })
      );

      // Active -> daily. nextPollAfter should be faked time + 24h
      const fakedNow = new Date("2025-08-01T12:00:00Z");
      expect(result.nextPollAfter).toEqual(
        new Date(fakedNow.getTime() + 24 * HOUR_MS)
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── Table-driven comprehensive coverage ────────────────────────────────────

describe("computeNextPoll -- state machine transitions (table-driven)", () => {
  test.each<{
    label: string;
    lastPollStatus: string;
    consecutiveErrors: number;
    companyAgeDays: number;
    jobsNew: number;
    jobsClosed: number;
    expectedPriority: PollPriority;
    expectedDelayHours: number;
    expectedErrors: number;
  }>([
    // Error path: below threshold
    { label: 'error, 0 prev errors', lastPollStatus: "error", consecutiveErrors: 0, companyAgeDays: 60, jobsNew: 0, jobsClosed: 0, expectedPriority: "daily", expectedDelayHours: 24, expectedErrors: 1 },
    { label: 'error, 1 prev error', lastPollStatus: "error", consecutiveErrors: 1, companyAgeDays: 60, jobsNew: 0, jobsClosed: 0, expectedPriority: "daily", expectedDelayHours: 24, expectedErrors: 2 },
    // Error path: at and above threshold
    { label: 'error, 2 prev -> threshold', lastPollStatus: "error", consecutiveErrors: 2, companyAgeDays: 60, jobsNew: 0, jobsClosed: 0, expectedPriority: "weekly", expectedDelayHours: 168, expectedErrors: 3 },
    { label: 'error, 3 prev -> backoff*2', lastPollStatus: "error", consecutiveErrors: 3, companyAgeDays: 60, jobsNew: 0, jobsClosed: 0, expectedPriority: "weekly", expectedDelayHours: 336, expectedErrors: 4 },
    { label: 'error, 5 prev -> cap hit', lastPollStatus: "error", consecutiveErrors: 5, companyAgeDays: 60, jobsNew: 0, jobsClosed: 0, expectedPriority: "weekly", expectedDelayHours: 672, expectedErrors: 6 },
    { label: 'error, 10 prev -> cap stays', lastPollStatus: "error", consecutiveErrors: 10, companyAgeDays: 60, jobsNew: 0, jobsClosed: 0, expectedPriority: "weekly", expectedDelayHours: 672, expectedErrors: 11 },
    // not_found path
    { label: 'not_found, 0 prev', lastPollStatus: "not_found", consecutiveErrors: 0, companyAgeDays: 60, jobsNew: 0, jobsClosed: 0, expectedPriority: "daily", expectedDelayHours: 24, expectedErrors: 1 },
    { label: 'not_found, 4 prev -> backoff*3', lastPollStatus: "not_found", consecutiveErrors: 4, companyAgeDays: 60, jobsNew: 0, jobsClosed: 0, expectedPriority: "weekly", expectedDelayHours: 504, expectedErrors: 5 },
    // New company path
    { label: 'ok, new (0 days)', lastPollStatus: "ok", consecutiveErrors: 0, companyAgeDays: 0, jobsNew: 0, jobsClosed: 0, expectedPriority: "daily", expectedDelayHours: 24, expectedErrors: 0 },
    { label: 'ok, new (3 days)', lastPollStatus: "ok", consecutiveErrors: 0, companyAgeDays: 3, jobsNew: 0, jobsClosed: 0, expectedPriority: "daily", expectedDelayHours: 24, expectedErrors: 0 },
    { label: 'ok, new (6.9 days)', lastPollStatus: "ok", consecutiveErrors: 0, companyAgeDays: 6.9, jobsNew: 0, jobsClosed: 0, expectedPriority: "daily", expectedDelayHours: 24, expectedErrors: 0 },
    // Stable tiers
    { label: 'ok, stable (7 days)', lastPollStatus: "ok", consecutiveErrors: 0, companyAgeDays: 7, jobsNew: 0, jobsClosed: 0, expectedPriority: "regular", expectedDelayHours: 72, expectedErrors: 0 },
    { label: 'ok, stable (15 days)', lastPollStatus: "ok", consecutiveErrors: 0, companyAgeDays: 15, jobsNew: 0, jobsClosed: 0, expectedPriority: "regular", expectedDelayHours: 72, expectedErrors: 0 },
    { label: 'ok, stable (29.9 days)', lastPollStatus: "ok", consecutiveErrors: 0, companyAgeDays: 29.9, jobsNew: 0, jobsClosed: 0, expectedPriority: "regular", expectedDelayHours: 72, expectedErrors: 0 },
    { label: 'ok, very stable (30 days)', lastPollStatus: "ok", consecutiveErrors: 0, companyAgeDays: 30, jobsNew: 0, jobsClosed: 0, expectedPriority: "weekly", expectedDelayHours: 168, expectedErrors: 0 },
    { label: 'ok, very stable (365 days)', lastPollStatus: "ok", consecutiveErrors: 0, companyAgeDays: 365, jobsNew: 0, jobsClosed: 0, expectedPriority: "weekly", expectedDelayHours: 168, expectedErrors: 0 },
    // Active with prior errors -> resets
    { label: 'ok, active with new jobs, resets errors', lastPollStatus: "ok", consecutiveErrors: 5, companyAgeDays: 60, jobsNew: 1, jobsClosed: 0, expectedPriority: "daily", expectedDelayHours: 24, expectedErrors: 0 },
    { label: 'ok, active with closed jobs, resets errors', lastPollStatus: "ok", consecutiveErrors: 5, companyAgeDays: 60, jobsNew: 0, jobsClosed: 3, expectedPriority: "daily", expectedDelayHours: 24, expectedErrors: 0 },
    // New company with errors -> resets
    { label: 'ok, new with errors, resets', lastPollStatus: "ok", consecutiveErrors: 5, companyAgeDays: 3, jobsNew: 0, jobsClosed: 0, expectedPriority: "daily", expectedDelayHours: 24, expectedErrors: 0 },
    // "empty" status
    { label: 'empty, old company -> weekly', lastPollStatus: "empty", consecutiveErrors: 3, companyAgeDays: 60, jobsNew: 0, jobsClosed: 0, expectedPriority: "weekly", expectedDelayHours: 168, expectedErrors: 0 },
    { label: 'empty, new company -> daily', lastPollStatus: "empty", consecutiveErrors: 0, companyAgeDays: 3, jobsNew: 0, jobsClosed: 0, expectedPriority: "daily", expectedDelayHours: 24, expectedErrors: 0 },
  ])(
    "$label (status=$lastPollStatus, age=$companyAgeDays, errs=$consecutiveErrors)",
    ({
      lastPollStatus,
      consecutiveErrors,
      companyAgeDays,
      jobsNew,
      jobsClosed,
      expectedPriority,
      expectedDelayHours,
      expectedErrors,
    }) => {
      const result = computeNextPoll(
        makeInput({
          lastPollStatus,
          consecutiveErrors,
          createdAt: new Date(NOW.getTime() - companyAgeDays * DAY_MS),
          jobsNew,
          jobsClosed,
        }),
        NOW
      );

      expect(result).toEqual({
        nextPollAfter: expectedTime(expectedDelayHours),
        pollPriority: expectedPriority,
        consecutiveErrors: expectedErrors,
      } satisfies AdaptivePollOutput);
    }
  );
});

// ─── Edge cases and adversarial inputs ──────────────────────────────────────

describe("computeNextPoll -- edge cases", () => {
  test("createdAt in the future (data corruption) -> treated as new (daily)", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() + 1 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    // companyAgeDays is negative, which is < 7 -> "new company" -> daily
    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    });
  });

  test("createdAt equals now exactly -> age 0, treated as new (daily)", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: NOW,
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    });
  });

  test("negative jobsNew does not trigger active path", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        jobsNew: -1,
        jobsClosed: 0,
      }),
      NOW
    );

    // -1 > 0 is false -> hadChanges is false -> falls to staleness (60d -> weekly)
    expect(result).toEqual({
      nextPollAfter: expectedTime(168),
      pollPriority: "weekly",
      consecutiveErrors: 0,
    });
  });

  test("negative jobsClosed does not trigger active path", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        jobsNew: 0,
        jobsClosed: -5,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(168),
      pollPriority: "weekly",
      consecutiveErrors: 0,
    });
  });

  test("unknown lastPollStatus is treated as a success (not error path)", () => {
    // TODO: lastPollStatus is typed as `string`, not a union. An unknown
    // status silently falls through to the success path. Consider
    // tightening the type to "ok" | "error" | "empty" | "not_found".
    const result = computeNextPoll(
      makeInput({
        lastPollStatus: "timeout",
        consecutiveErrors: 0,
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    // "timeout" does not match "error" or "not_found" -> success path
    // 60 days, no changes -> weekly
    expect(result).toEqual({
      nextPollAfter: expectedTime(168),
      pollPriority: "weekly",
      consecutiveErrors: 0,
    });
  });

  test("lastPolledAt: null does not affect computation", () => {
    // lastPolledAt is accepted in the interface but never read.
    // This test documents that null does not cause errors.
    const result = computeNextPoll(
      makeInput({
        lastPolledAt: null,
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    expect(result).toEqual({
      nextPollAfter: expectedTime(168),
      pollPriority: "weekly",
      consecutiveErrors: 0,
    });
  });

  test("invalid Date for createdAt falls through to daily fallback", () => {
    const result = computeNextPoll(
      makeInput({
        createdAt: new Date("invalid"),
        jobsNew: 0,
        jobsClosed: 0,
      }),
      NOW
    );

    // new Date("invalid").getTime() returns NaN
    // companyAgeDays = NaN
    // NaN < 7 -> false, NaN >= 30 -> false, NaN >= 7 -> false
    // Falls through to daily fallback
    expect(result).toEqual({
      nextPollAfter: expectedTime(24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    });
  });

  test("fractional consecutiveErrors produces non-standard but valid schedule", () => {
    // The function trusts its caller to provide integer error counts.
    // With 2.5, newErrors = 3.5, which is >= 3 (threshold).
    // backoffMultiplier = min(3.5 - 2, 4) = 1.5
    // delayMs = 168h * 1.5 = 252h
    const result = computeNextPoll(
      makeInput({
        lastPollStatus: "error",
        consecutiveErrors: 2.5,
        createdAt: new Date(NOW.getTime() - 60 * DAY_MS),
      }),
      NOW
    );

    expect(result.consecutiveErrors).toBe(3.5);
    expect(result.pollPriority).toBe("weekly");
    expect(result.nextPollAfter).toEqual(expectedTime(252));
  });
});
