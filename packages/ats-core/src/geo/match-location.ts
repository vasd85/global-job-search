import type {
  ParsedJobLocation,
  ResolvedTierGeo,
  LocationMatchResult,
} from "./types";
import { parseJobLocation, escapeRegexChars } from "./parse-job-location";
import { locationCache } from "./location-cache";

/**
 * Check if a job's work format matches a tier's acceptable formats.
 * (Architecture Section 5.2)
 *
 * - null jobType -> pass (assume any format)
 * - "relocation" in tierFormats is treated the same as "onsite"
 */
export function workFormatMatch(
  jobWorkplaceType: string | null,
  tierWorkFormats: string[],
): boolean {
  // If job has no workplaceType, assume it could be any format
  if (jobWorkplaceType === null) return true;

  // Empty tier formats means no format constraint -> pass
  if (tierWorkFormats.length === 0) return true;

  const jobType = jobWorkplaceType.toLowerCase();

  for (const format of tierWorkFormats) {
    const f = format.toLowerCase();

    if (jobType === "remote" && f === "remote") return true;
    if (jobType === "hybrid" && f === "hybrid") return true;
    if (jobType === "onsite" && (f === "onsite" || f === "relocation"))
      return true;
  }

  return false;
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
 * Check if a job matches a single tier (work format AND geo).
 * (Architecture Section 5.1)
 *
 * For multi-location strings (parseJobLocation returns array),
 * the job passes if ANY parsed location matches the tier's geo scope.
 */
export function tierMatch(
  locationRaw: string | null,
  workplaceType: string | null,
  resolved: ResolvedTierGeo,
): boolean {
  // Work format must match
  if (!workFormatMatch(workplaceType, resolved.workFormats)) return false;

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
 */
export function matchJobToTiers(
  locationRaw: string | null,
  workplaceType: string | null,
  resolvedTiers: ResolvedTierGeo[],
): LocationMatchResult {
  // No tiers configured -> no location filter, everything passes
  if (resolvedTiers.length === 0) {
    return { passes: true, matchedTier: null };
  }

  // Null/empty locationRaw -> passes (backward compat)
  if (locationRaw === null || locationRaw.trim().length === 0) {
    return { passes: true, matchedTier: null };
  }

  // Try each tier sorted by rank (already sorted by resolveAllTiers)
  for (const tier of resolvedTiers) {
    if (tierMatch(locationRaw, workplaceType, tier)) {
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
