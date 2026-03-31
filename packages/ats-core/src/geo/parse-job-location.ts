import type { ParsedJobLocation } from "./types";
import { lookupCountry, COUNTRIES } from "./country-data";
import { lookupRegion } from "./composite-regions";
import { isUsState, isCanadianProvince } from "./us-states";
import { lookupCity, lookupCityInCountry } from "./city-index";

/**
 * Regex for detecting "remote" as a word (not inside compound words).
 * Matches "Remote", "remote", but not "remoteonly" or "preremote".
 */
const REMOTE_RE = /\bremote\b/i;

/**
 * Regex for "Remote, <scope>" patterns.
 * Captures the scope after a separator (comma, dash, slash, or parens).
 * Examples: "Remote, US", "Remote - Europe", "Remote (APAC)"
 */
const REMOTE_SCOPE_RE = /^remote\s*[-,/(]\s*(.+?)\)?\s*$/i;

/** Regex for detecting "anywhere" as a signal. */
const ANYWHERE_RE = /\banywhere\b/i;

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Create a base ParsedJobLocation with all fields initialized.
 */
function baseParsed(raw: string): ParsedJobLocation {
  return {
    raw,
    isRemote: false,
    isAnywhere: false,
    city: null,
    countryCode: null,
    countryName: null,
    stateOrRegion: null,
    confidence: "unresolved",
  };
}

/**
 * Get the canonical name for a country code from the COUNTRIES map.
 */
function countryNameForCode(code: string): string | null {
  const record = COUNTRIES.get(code);
  return record ? record.name : null;
}

/**
 * Try to resolve a single location part as a country code.
 * Returns the alpha-2 code or null.
 */
function tryCountry(part: string): string | null {
  return lookupCountry(part);
}

/**
 * Resolve a single location segment (already comma-split) into a ParsedJobLocation.
 * Implements the right-to-left resolution algorithm from architecture Section 4.2.
 */
function resolveSingleLocation(
  raw: string,
  isRemote: boolean,
): ParsedJobLocation {
  const result = baseParsed(raw);
  result.isRemote = isRemote;

  const normalized = raw.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    result.isAnywhere = true;
    result.confidence = "full";
    return result;
  }

  // Split on comma
  const parts = normalized
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (parts.length === 0) {
    result.isAnywhere = true;
    result.confidence = "full";
    return result;
  }

  // Right-to-left resolution
  const rightmost = parts[parts.length - 1];

  // 5a. Try country lookup on the rightmost part
  const countryCode = tryCountry(rightmost);
  if (countryCode) {
    // 5b. Disambiguate US state / country code collisions (GA, DE, IN, ME, AL, PA).
    // A 2-letter code can match both a country AND a US state (or Canadian province).
    // Check BOTH interpretations:
    //   - Does the city exist in the matched country? -> prefer country interpretation
    //   - Does the city only exist in the US/CA? -> prefer state/province interpretation
    //   - City exists in neither (or both) -> prefer country interpretation
    const upperRight = rightmost.toUpperCase();
    if (parts.length >= 2 && upperRight.length === 2) {
      const cityPart = parts[parts.length - 2];
      const cityExistsInCountry = lookupCityInCountry(cityPart, countryCode);

      if (isUsState(upperRight)) {
        const cityExistsInUS = lookupCityInCountry(cityPart, "US");
        if (cityExistsInCountry) {
          // City exists in the matched country -- prefer country (Berlin, DE -> Germany)
          return resolveAsCountryMatch(result, parts, countryCode);
        }
        if (cityExistsInUS) {
          // City only exists in the US -- prefer US state (Columbus, OH -> Ohio)
          // Fall through to the US state resolution below (step 5c)
        } else {
          // City exists in neither -- prefer country interpretation
          return resolveAsCountryMatch(result, parts, countryCode);
        }
      } else if (isCanadianProvince(upperRight)) {
        const cityExistsInCA = lookupCityInCountry(cityPart, "CA");
        if (cityExistsInCountry) {
          // City exists in the matched country -- prefer country
          return resolveAsCountryMatch(result, parts, countryCode);
        }
        if (cityExistsInCA) {
          // City only exists in Canada -- prefer province
          // Fall through to the Canadian province resolution below (step 5c)
        } else {
          // City exists in neither -- prefer country interpretation
          return resolveAsCountryMatch(result, parts, countryCode);
        }
      } else {
        // Code is not a US state or Canadian province -- no ambiguity
        return resolveAsCountryMatch(result, parts, countryCode);
      }
    } else {
      // No ambiguity possible (single part or code length != 2)
      return resolveAsCountryMatch(result, parts, countryCode);
    }
  }

  // 5c. Check if rightmost is a US state abbreviation (2 uppercase letters)
  const upperRight = rightmost.toUpperCase();
  if (upperRight.length === 2 && isUsState(upperRight)) {
    result.countryCode = "US";
    result.countryName = countryNameForCode("US");
    result.stateOrRegion = upperRight;

    if (parts.length >= 2) {
      result.city = resolveCityPart(parts[0], "US");
    }
    result.confidence = result.city ? "full" : "partial";
    return result;
  }

  // 5c. Check if rightmost is a Canadian province abbreviation
  if (upperRight.length === 2 && isCanadianProvince(upperRight)) {
    result.countryCode = "CA";
    result.countryName = countryNameForCode("CA");
    result.stateOrRegion = upperRight;

    if (parts.length >= 2) {
      result.city = resolveCityPart(parts[0], "CA");
    }
    result.confidence = result.city ? "full" : "partial";
    return result;
  }

  // 5d. Single part that is not a country: try city index
  if (parts.length === 1) {
    const cityEntry = lookupCity(parts[0]);
    if (cityEntry) {
      result.city = { name: cityEntry.name, countryCode: cityEntry.countryCode };
      result.countryCode = cityEntry.countryCode;
      result.countryName = countryNameForCode(cityEntry.countryCode);
      result.confidence = "full";
      return result;
    }
  }

  // For multi-part without country resolution, try the leftmost as city
  // and check if any intermediate part resolves
  if (parts.length >= 2) {
    // Try second-to-last as state/province, then check if first is a city
    const cityEntry = lookupCity(parts[0]);
    if (cityEntry) {
      result.city = { name: cityEntry.name, countryCode: cityEntry.countryCode };
      result.countryCode = cityEntry.countryCode;
      result.countryName = countryNameForCode(cityEntry.countryCode);
      result.stateOrRegion = parts.length > 2 ? parts[1] : null;
      result.confidence = "partial";
      return result;
    }
  }

  // Nothing resolved
  result.confidence = "unresolved";
  return result;
}

/**
 * Fill in a ParsedJobLocation when the rightmost part resolved as a country code.
 * Shared by the country-match path in resolveSingleLocation.
 */
function resolveAsCountryMatch(
  result: ParsedJobLocation,
  parts: string[],
  countryCode: string,
): ParsedJobLocation {
  result.countryCode = countryCode;
  result.countryName = countryNameForCode(countryCode);

  if (parts.length === 3) {
    // [city, state/region, country]
    result.city = resolveCityPart(parts[0], countryCode);
    result.stateOrRegion = parts[1];
    // Dedup: if stateOrRegion matches city name (e.g., "Berlin, Berlin, Germany")
    if (result.stateOrRegion.toLowerCase() === parts[0].toLowerCase()) {
      result.stateOrRegion = null;
    }
    result.confidence = result.city ? "full" : "partial";
  } else if (parts.length === 2) {
    // [city, country]
    result.city = resolveCityPart(parts[0], countryCode);
    result.confidence = result.city ? "full" : "partial";
  } else {
    // 1 part = just a country
    result.confidence = "full";
  }

  return result;
}

/**
 * Try to resolve a city name against the city index, optionally scoped by country.
 * Returns a structured city object or null.
 */
function resolveCityPart(
  cityName: string,
  countryCode: string,
): { name: string; countryCode: string } | null {
  const entry = lookupCityInCountry(cityName, countryCode);
  if (entry) {
    return { name: entry.name, countryCode: entry.countryCode };
  }
  return null;
}

/**
 * Detect if a string is a compound multi-location pattern like
 * "Berlin, DE, London, UK" -- a repeating [City, Code] pattern.
 *
 * Heuristic: if there are an even number of parts (4, 6, ...) and every
 * other part (starting from index 1) resolves as a country code, treat
 * each pair as a separate location.
 */
function splitCompoundLocations(parts: string[]): string[][] | null {
  if (parts.length < 4 || parts.length % 2 !== 0) return null;

  // Check that every odd-indexed part resolves as a country
  for (let i = 1; i < parts.length; i += 2) {
    if (!tryCountry(parts[i])) return null;
  }

  // Split into pairs
  const pairs: string[][] = [];
  for (let i = 0; i < parts.length; i += 2) {
    pairs.push([parts[i], parts[i + 1]]);
  }
  return pairs;
}

/**
 * Parse a raw ATS location string into structured ParsedJobLocation results.
 *
 * Returns an ARRAY to handle multi-location strings (e.g., "New York or London").
 * For single-location strings, the array has one element.
 *
 * Algorithm (per architecture Section 4.2-4.3):
 * 1. Normalize: lowercase, trim, collapse spaces
 * 2. Detect remote/anywhere signals
 * 3. Handle "Remote, <scope>" pattern
 * 4. Handle multi-location: split on " or " / " and " separators
 * 5. Handle compound patterns like "Berlin, DE, London, UK"
 * 6. For each location part, resolve right-to-left
 * 7. Set confidence level
 */
export function parseJobLocation(raw: string): ParsedJobLocation[] {
  // Handle null/empty as "Anywhere"
  if (!raw || raw.trim().length === 0) {
    const result = baseParsed(raw ?? "");
    result.isAnywhere = true;
    result.confidence = "full";
    return [result];
  }

  // 1. Normalize
  const normalized = raw.toLowerCase().replace(/\s+/g, " ").trim();

  // 2. Detect remote/anywhere signals
  const isRemote = REMOTE_RE.test(normalized);
  const isAnywhere = ANYWHERE_RE.test(normalized);

  // Pure "Remote" or "Anywhere"
  if (
    normalized === "remote" ||
    normalized === "anywhere" ||
    normalized === "remote - anywhere"
  ) {
    const result = baseParsed(raw);
    result.isRemote = isRemote;
    result.isAnywhere = isAnywhere || normalized === "remote";
    result.confidence = "full";
    return [result];
  }

  // 3. Handle "Remote, <scope>" pattern
  const remoteMatch = REMOTE_SCOPE_RE.exec(normalized);
  if (remoteMatch) {
    const scope = remoteMatch[1].trim();

    // Check if scope is a composite region
    const region = lookupRegion(scope);
    if (region) {
      // For remote + region, create a result with remote flag and the
      // first member country as a representative (the matching layer
      // will check against the full region)
      const result = baseParsed(raw);
      result.isRemote = true;
      result.countryCode = region.memberCountryCodes[0] ?? null;
      result.countryName = result.countryCode
        ? countryNameForCode(result.countryCode)
        : null;
      result.confidence = "partial";
      return [result];
    }

    // Check if scope is a country
    const country = tryCountry(scope);
    if (country) {
      const result = baseParsed(raw);
      result.isRemote = true;
      result.countryCode = country;
      result.countryName = countryNameForCode(country);
      result.confidence = "full";
      return [result];
    }

    // Check if scope is a city
    const city = lookupCity(scope);
    if (city) {
      const result = baseParsed(raw);
      result.isRemote = true;
      result.city = { name: city.name, countryCode: city.countryCode };
      result.countryCode = city.countryCode;
      result.countryName = countryNameForCode(city.countryCode);
      result.confidence = "full";
      return [result];
    }

    // Unresolved scope
    const result = baseParsed(raw);
    result.isRemote = true;
    result.confidence = "unresolved";
    return [result];
  }

  // 4. Handle multi-location: split on " or " / " and " separators
  // but only if these appear as standalone separators, not within commas
  const multiParts = normalized.split(/\s+(?:or|and)\s+/);
  if (multiParts.length > 1) {
    const results: ParsedJobLocation[] = [];
    for (const part of multiParts) {
      const resolved = resolveSingleLocation(part, isRemote);
      if (isAnywhere) resolved.isAnywhere = true;
      results.push(resolved);
    }
    return results;
  }

  // 5. Handle compound patterns like "Berlin, DE, London, UK"
  const commaParts = normalized
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const compoundPairs = splitCompoundLocations(commaParts);
  if (compoundPairs) {
    const results: ParsedJobLocation[] = [];
    for (const pair of compoundPairs) {
      const locationStr = pair.join(", ");
      const resolved = resolveSingleLocation(locationStr, isRemote);
      if (isAnywhere) resolved.isAnywhere = true;
      results.push(resolved);
    }
    return results;
  }

  // 6. Single location resolution
  const result = resolveSingleLocation(normalized, isRemote);
  if (isAnywhere) result.isAnywhere = true;

  // Strip "remote" from city name if it leaked through
  // (e.g., "Remote Berlin" parsed as city "remote berlin")
  if (result.isRemote && result.city && /^remote\s+/.test(result.city.name)) {
    const cleanName = result.city.name.replace(/^remote\s+/, "");
    const recheck = lookupCity(cleanName, result.countryCode ?? undefined);
    if (recheck) {
      result.city = { name: recheck.name, countryCode: recheck.countryCode };
    }
  }

  return [result];
}

/**
 * Escape a string for use in a word-boundary regex.
 * Exported for use by match-location.ts.
 */
export function escapeRegexChars(s: string): string {
  return escapeRegex(s);
}
