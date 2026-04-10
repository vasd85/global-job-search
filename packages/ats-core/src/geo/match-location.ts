import type {
  ParsedJobLocation,
  ResolvedTierGeo,
  ResolvedImmigration,
  JobImmigrationSignals,
  LocationMatchResult,
} from "./types";
import { UNKNOWN_JOB_SIGNALS } from "./types";
import { parseJobLocation, escapeRegexChars } from "./parse-job-location";
import { locationCache } from "./location-cache";

/**
 * Canonicalize a raw workplace type string to one of the three supported
 * enum values, or `null` for anything unrecognized.
 *
 * - Case-insensitive
 * - Handles the Lever "on-site" hyphenated form and the "on_site" underscore form
 * - Trims whitespace
 *
 * Keep this in sync with the migration `0009_separate_match_signals.sql`
 * UPDATE statement — see plan §4 and §6.
 */
export function normalizeWorkplaceType(
  value: string | null,
): "remote" | "hybrid" | "onsite" | null {
  if (value === null) return null;
  const v = value.trim().toLowerCase();
  if (v === "remote") return "remote";
  if (v === "hybrid") return "hybrid";
  if (v === "onsite" || v === "on-site" || v === "on_site") return "onsite";
  return null;
}

/**
 * Check whether a job's work format matches a tier's acceptable formats.
 *
 * CONTRACT: `jobWorkplaceType` is assumed to already be normalized to
 * `'remote' | 'hybrid' | 'onsite' | null`. If you're unsure, wrap the
 * value with `normalizeWorkplaceType()` first. The DB migration + the
 * ingestion normalizer guarantee this for all rows.
 *
 * - `null` jobWorkplaceType → pass (any format acceptable)
 * - empty tierWorkFormats   → pass (tier has no format constraint)
 * - otherwise: strict `includes` check
 *
 * Tier formats are `{'remote','hybrid','onsite'}` only as of Chunk B.
 * `'relocation'` is no longer a work format — it moved to `immigrationFlags`.
 */
export function workFormatMatch(
  jobWorkplaceType: string | null,
  tierWorkFormats: string[],
): boolean {
  if (jobWorkplaceType === null) return true;
  if (tierWorkFormats.length === 0) return true;
  return tierWorkFormats.includes(jobWorkplaceType);
}

/**
 * Check whether persisted job signals satisfy a tier's immigration requirements.
 *
 * Lenient on `'unknown'` — confirmed per user decision Q1. Unknown signals
 * pass the filter so that L3 LLM extraction can learn the concrete value
 * on first encounter and L2 can apply it for subsequent users. See plan
 * §8 "L3 → L2 promotion hypothesis".
 *
 * - `tierFlags === undefined` → pass (no constraint).
 * - `jobSignals === undefined` → treated as all-unknown (`UNKNOWN_JOB_SIGNALS`)
 *   → lenient pass on every flag.
 * - `needsVisaSponsorship: true` + `visaSponsorship === 'no'` → fail.
 * - `needsUnrestrictedWorkAuth: true` + `workAuthRestriction ∈
 *   {'citizens_only','residents_only','region_only'}` → fail.
 * - `wantsRelocationPackage` is SCORE-ONLY and intentionally NOT gated here.
 */
export function immigrationMatch(
  jobSignals: JobImmigrationSignals | undefined,
  tierFlags: ResolvedImmigration | undefined,
): boolean {
  if (tierFlags === undefined) return true;
  const signals = jobSignals ?? UNKNOWN_JOB_SIGNALS;

  if (
    tierFlags.needsVisaSponsorship === true &&
    signals.visaSponsorship === "no"
  ) {
    return false;
  }

  if (
    tierFlags.needsUnrestrictedWorkAuth === true &&
    (signals.workAuthRestriction === "citizens_only" ||
      signals.workAuthRestriction === "residents_only" ||
      signals.workAuthRestriction === "region_only")
  ) {
    return false;
  }

  // wantsRelocationPackage is score-only — no gate here.
  return true;
}

/**
 * Check if a parsed job location geographically matches a resolved tier.
 * (Architecture Section 5.3)
 */
export function geoMatch(
  parsed: ParsedJobLocation,
  resolved: ResolvedTierGeo,
  locationRaw: string | null,
): boolean {
  // Tier scope is "any" -> matches everything
  if (resolved.isAny) return true;

  // Job location is "Anywhere" or unresolved with no geo data -> pass
  if (parsed.isAnywhere) return true;
  if (
    parsed.countryCode === null &&
    parsed.city === null &&
    parsed.confidence === "unresolved"
  ) {
    return true;
  }

  // Job is Remote with no geographic constraint -> passes all geo filters
  if (parsed.isRemote && parsed.countryCode === null) return true;

  // City-level matching (most specific)
  if (resolved.resolvedCityNames.size > 0 && parsed.city !== null) {
    const cityName = parsed.city.name.toLowerCase();
    if (resolved.resolvedCityNames.has(cityName)) {
      if (!resolved.excludedCountryCodes.has(parsed.city.countryCode)) {
        return true;
      }
    }
  }

  // City-scoped tier guard: when a tier has city names but NO country codes,
  // it is city-scoped and must not leak to country-level matching. A user who
  // selected city = Berlin should not match all jobs in Germany.
  const isCityScoped =
    resolved.resolvedCityNames.size > 0 &&
    resolved.resolvedCountryCodes.size === 0;
  if (isCityScoped) {
    // Skip country-level matching -- only city names and unresolved fallback apply
    if (resolved.unresolvedEntries.length > 0 && locationRaw) {
      const haystack = locationRaw.toLowerCase();
      for (const needle of resolved.unresolvedEntries) {
        if (wordBoundaryMatch(haystack, needle.toLowerCase())) {
          return true;
        }
      }
    }
    return false;
  }

  // Country-level matching (hierarchy-aware)
  if (parsed.countryCode !== null) {
    if (resolved.resolvedCountryCodes.has(parsed.countryCode)) {
      if (!resolved.excludedCountryCodes.has(parsed.countryCode)) {
        return true;
      }
    }
  }

  // Fallback: substring match for unresolved entries
  if (resolved.unresolvedEntries.length > 0 && locationRaw) {
    const haystack = locationRaw.toLowerCase();
    for (const needle of resolved.unresolvedEntries) {
      if (wordBoundaryMatch(haystack, needle.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a job matches a single tier (work format, immigration flags, AND geo).
 * (Architecture Section 5.1)
 *
 * For multi-location strings (parseJobLocation returns array),
 * the job passes if ANY parsed location matches the tier's geo scope.
 *
 * `jobSignals` is optional for backward compatibility with callers that
 * have not yet been wired to fetch the persisted immigration columns.
 * Callers that have access to persisted signal columns should pass them;
 * omission = all unknown = lenient pass (cache warm-up path, see plan §8).
 */
export function tierMatch(
  locationRaw: string | null,
  workplaceType: string | null,
  resolved: ResolvedTierGeo,
  jobSignals?: JobImmigrationSignals,
): boolean {
  // Work format must match (input assumed pre-normalized)
  if (!workFormatMatch(workplaceType, resolved.workFormats)) return false;

  // Immigration flags must match (undefined jobSignals = lenient unknown)
  if (!immigrationMatch(jobSignals, resolved.immigrationFlags)) return false;

  // Parse the location (with caching)
  const parsedLocations = getCachedParsed(locationRaw);

  // Geo must match for at least one parsed location
  for (const parsed of parsedLocations) {
    if (geoMatch(parsed, resolved, locationRaw)) return true;
  }

  return false;
}

/**
 * Match a job against all resolved tiers. Returns whether it passes
 * and which tier (rank) it matched.
 * (Architecture Section 5.5)
 *
 * This is the primary entry point called from filter-pipeline.ts.
 *
 * The `workplaceType` argument is normalized defensively via
 * `normalizeWorkplaceType()` before being handed to the inner matcher —
 * this is defense-in-depth on top of the migration + ingestion normalizer
 * guarantees, so callers that pass a raw DB value still work correctly.
 *
 * `jobSignals` is optional for backward compatibility. Callers that have
 * access to persisted signal columns should pass them; omission = all
 * unknown = lenient pass (cache warm-up path, see plan §8).
 */
export function matchJobToTiers(
  locationRaw: string | null,
  workplaceType: string | null,
  resolvedTiers: ResolvedTierGeo[],
  jobSignals?: JobImmigrationSignals,
): LocationMatchResult {
  // No tiers configured -> no location filter, everything passes
  if (resolvedTiers.length === 0) {
    return { passes: true, matchedTier: null };
  }

  // Null/empty locationRaw -> passes (backward compat)
  if (locationRaw === null || locationRaw.trim().length === 0) {
    return { passes: true, matchedTier: null };
  }

  // Defensive normalization: the DB + normalizer guarantee a canonical
  // value, but wrapping here keeps unit tests and legacy call sites safe.
  const normalizedWorkplaceType = normalizeWorkplaceType(workplaceType);

  // Try each tier sorted by rank (already sorted by resolveAllTiers)
  for (const tier of resolvedTiers) {
    if (tierMatch(locationRaw, normalizedWorkplaceType, tier, jobSignals)) {
      return { passes: true, matchedTier: tier.rank };
    }
  }

  // No tier matched
  return { passes: false, matchedTier: null };
}

/**
 * Word-boundary-aware substring matching for fallback.
 * (Architecture Section 5.6)
 *
 * Short needles (<=3 chars) use word boundary regex to avoid
 * false positives ("US" matching "Campus", "EU" matching "Reuters").
 * Longer needles use simple includes() which is safe.
 */
export function wordBoundaryMatch(
  haystack: string,
  needle: string,
): boolean {
  if (needle.length <= 3) {
    const regex = new RegExp(`\\b${escapeRegexChars(needle)}\\b`, "i");
    return regex.test(haystack);
  }
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Get parsed locations from cache, or parse and cache.
 */
function getCachedParsed(locationRaw: string | null): ParsedJobLocation[] {
  if (locationRaw === null || locationRaw.trim().length === 0) {
    return [
      {
        raw: locationRaw ?? "",
        isRemote: false,
        isAnywhere: true,
        city: null,
        countryCode: null,
        countryName: null,
        stateOrRegion: null,
        confidence: "full",
      },
    ];
  }

  const key = locationRaw.toLowerCase();
  const cached = locationCache.get(key);
  if (cached) return cached;

  const parsed = parseJobLocation(locationRaw);
  locationCache.set(key, parsed);
  return parsed;
}
