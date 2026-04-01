// ─── Types ──────────────────────────────────────────────────────────────────

export type PollPriority = "daily" | "regular" | "weekly";

export interface AdaptivePollInput {
  /** Status from the latest poll: "ok" | "error" | "empty" | "not_found" */
  lastPollStatus: string;
  /** Running count of consecutive errors (before this poll) */
  consecutiveErrors: number;
  /** When the company was last polled (null if never) */
  lastPolledAt: Date | null;
  /** When the company record was created */
  createdAt: Date;
  /** Number of new jobs found in this poll */
  jobsNew: number;
  /** Number of jobs marked closed/stale in this poll */
  jobsClosed: number;
}

export interface AdaptivePollOutput {
  /** When the company should next be polled */
  nextPollAfter: Date;
  /** Priority bucket for the company */
  pollPriority: PollPriority;
  /** Updated consecutive error count */
  consecutiveErrors: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const HOURS_24 = 24 * 60 * 60 * 1000;
const HOURS_72 = 72 * 60 * 60 * 1000;
const HOURS_168 = 168 * 60 * 60 * 1000;

const NEW_COMPANY_DAYS = 7;
const STABLE_THRESHOLD_DAYS = 7;
const VERY_STABLE_THRESHOLD_DAYS = 30;
const ERROR_BACKOFF_THRESHOLD = 3;

// ─── Pure function ──────────────────────────────────────────────────────────

/**
 * Compute the next poll time and priority for a company based on its
 * current activity and error state. This function is pure -- it takes
 * the current state and returns the new state without DB access.
 *
 * Rules:
 *   New (<7 days old)            -> daily  (24h)
 *   Active (jobs changed)        -> daily  (24h)
 *   Stable (no changes 7+ days)  -> every 3 days (72h)
 *   Very stable (30+ days)       -> every 7 days (168h)
 *   Error (3+ consecutive)       -> every 7 days + backoff
 */
export function computeNextPoll(
  input: AdaptivePollInput,
  now: Date = new Date()
): AdaptivePollOutput {
  const { lastPollStatus, consecutiveErrors, createdAt, jobsNew, jobsClosed } =
    input;

  // Handle error state first
  if (lastPollStatus === "error" || lastPollStatus === "not_found") {
    const newErrors = consecutiveErrors + 1;
    if (newErrors >= ERROR_BACKOFF_THRESHOLD) {
      // Backoff: 7 days * (errors - 2), capped at 28 days
      const backoffMultiplier = Math.min(newErrors - 2, 4);
      const delayMs = HOURS_168 * backoffMultiplier;
      return {
        nextPollAfter: new Date(now.getTime() + delayMs),
        pollPriority: "weekly",
        consecutiveErrors: newErrors,
      };
    }
    // Under threshold: poll daily, but track the error
    return {
      nextPollAfter: new Date(now.getTime() + HOURS_24),
      pollPriority: "daily",
      consecutiveErrors: newErrors,
    };
  }

  // Successful poll -- reset consecutive errors
  const hadChanges = jobsNew > 0 || jobsClosed > 0;

  // New company (created < 7 days ago): always poll daily
  const companyAgeDays =
    (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (companyAgeDays < NEW_COMPANY_DAYS) {
    return {
      nextPollAfter: new Date(now.getTime() + HOURS_24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    };
  }

  // Active: jobs changed in this poll -> daily
  if (hadChanges) {
    return {
      nextPollAfter: new Date(now.getTime() + HOURS_24),
      pollPriority: "daily",
      consecutiveErrors: 0,
    };
  }

  // No changes -- determine staleness based on time since last change.
  // We approximate "days since last change" by how long ago the company
  // was last polled with changes. Since we don't track that date directly,
  // we use the company age as a proxy for very-stable detection, and fall
  // through from the "had changes" check above for the stable case.
  //
  // If we reach here, no changes occurred in this poll. Check thresholds
  // based on company age (new companies already handled above).
  if (companyAgeDays >= VERY_STABLE_THRESHOLD_DAYS) {
    return {
      nextPollAfter: new Date(now.getTime() + HOURS_168),
      pollPriority: "weekly",
      consecutiveErrors: 0,
    };
  }

  if (companyAgeDays >= STABLE_THRESHOLD_DAYS) {
    return {
      nextPollAfter: new Date(now.getTime() + HOURS_72),
      pollPriority: "regular",
      consecutiveErrors: 0,
    };
  }

  // Fallback: daily
  return {
    nextPollAfter: new Date(now.getTime() + HOURS_24),
    pollPriority: "daily",
    consecutiveErrors: 0,
  };
}
