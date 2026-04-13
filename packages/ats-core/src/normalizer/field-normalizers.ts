/**
 * Field normalizers for the ingestion layer.
 *
 * These helpers canonicalize raw ATS-provided strings into the same enum
 * shapes the database stores. The intent is to push normalization to the
 * earliest possible point (ingest time) so downstream code can rely on
 * canonical values without runtime case-folding or fuzzy matching.
 *
 * Workplace type normalization lives in `../geo/match-location.ts` —
 * import `normalizeWorkplaceType` from there. The two helpers below
 * cover the remaining text columns that need shape coercion at ingest:
 *
 *  - `normalizeEmploymentType` mirrors the §G `UPDATE` in migration
 *    `0009_separate_match_signals.sql`. Keep both in sync.
 *  - `normalizePostedDate` parses an extractor-provided date string
 *    (ISO, relative, or long-form) into a `Date` so the column type
 *    matches the schema's `timestamptz` shape.
 */

export type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "intern"
  | "temp";

/**
 * Canonicalize a raw employment-type string to the enum the schema stores.
 *
 * Mapping is intentionally conservative — anything that does not match a
 * known spelling becomes `null` rather than being silently bucketed.
 *
 * Keep in sync with the §G `UPDATE` in migration
 * `0009_separate_match_signals.sql`.
 */
export function normalizeEmploymentType(
  value: string | null,
): EmploymentType | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === "") return null;
  switch (v) {
    case "full-time":
    case "fulltime":
    case "full time":
    case "permanent":
      return "full_time";
    case "part-time":
    case "parttime":
    case "part time":
      return "part_time";
    case "contract":
    case "contractor":
      return "contract";
    case "intern":
    case "internship":
      return "intern";
    case "temporary":
    case "temp":
      return "temp";
    default:
      return null;
  }
}

const RELATIVE_DAYS_REGEX = /^(\d+)\s+days?\s+ago$/;
const RELATIVE_WEEKS_REGEX = /^(\d+)\s+weeks?\s+ago$/;

/**
 * Parse a raw date string from an extractor into a `Date`, falling back
 * to `null` for unparseable input.
 *
 * Recognized shapes:
 *  - ISO 8601: `"2026-01-15"`, `"2026-01-15T10:00:00Z"`.
 *  - Relative: `"today"`, `"yesterday"`, `"N days ago"`, `"N weeks ago"` —
 *    requires `pollTimestamp` to compute the offset; without it, relative
 *    inputs return `null`.
 *  - Long-form: `"January 15, 2025"` and similar — handled by `new Date(value)`
 *    as a best-effort fallback. Anything `Date` rejects is treated as `null`.
 *
 * The function never throws.
 */
export function normalizePostedDate(
  value: string | null,
  pollTimestamp?: Date,
): Date | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;

  // ISO 8601 — `YYYY-MM-DD` or full timestamp.
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
    return null;
  }

  // Relative dates — only resolvable when a poll timestamp is provided.
  if (pollTimestamp !== undefined) {
    const lower = trimmed.toLowerCase();
    if (lower === "today") {
      return startOfDay(pollTimestamp);
    }
    if (lower === "yesterday") {
      return offsetDays(startOfDay(pollTimestamp), -1);
    }
    const daysMatch = RELATIVE_DAYS_REGEX.exec(lower);
    if (daysMatch) {
      const days = Number.parseInt(daysMatch[1], 10);
      if (Number.isFinite(days)) {
        return offsetDays(startOfDay(pollTimestamp), -days);
      }
    }
    const weeksMatch = RELATIVE_WEEKS_REGEX.exec(lower);
    if (weeksMatch) {
      const weeks = Number.parseInt(weeksMatch[1], 10);
      if (Number.isFinite(weeks)) {
        return offsetDays(startOfDay(pollTimestamp), -weeks * 7);
      }
    }
  }

  // Long-form fallback (`"January 15, 2025"`) — best-effort.
  const fallback = new Date(trimmed);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback;
  }
  return null;
}

function startOfDay(date: Date): Date {
  const next = new Date(date.getTime());
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function offsetDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
