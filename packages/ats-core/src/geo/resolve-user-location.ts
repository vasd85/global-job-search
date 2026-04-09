import type { ResolvedImmigration, ResolvedTierGeo } from "./types";
import { lookupCountry } from "./country-data";
import { lookupRegion } from "./composite-regions";
import { lookupTimezoneGroup } from "./timezone-groups";
import { lookupCity } from "./city-index";

/**
 * The input tier shape -- matches the Zod-inferred LocationPreferenceTier
 * from apps/web/src/lib/chatbot/schemas.ts. Defined here as a structural
 * type to avoid importing from apps/web (ats-core must not depend on apps/web).
 *
 * `immigrationFlags` is optional — added in Chunk B of the
 * separate-match-signals refactor. Chatbot schemas may or may not populate
 * it yet (Chunk C). Legacy callers that don't set it get
 * `immigrationFlags: undefined` on the output, which `immigrationMatch`
 * treats as "no constraint — always pass".
 */
export interface LocationPreferenceTierInput {
  rank: number;
  workFormats: string[];
  scope: {
    type: "countries" | "regions" | "timezones" | "cities" | "any";
    include: string[];
    exclude?: string[];
  };
  immigrationFlags?: ResolvedImmigration;
}

/**
 * Resolve a single location preference tier into structured geo data.
 *
 * Resolution per scope type (architecture Section 4.1):
 * - "any"       -> isAny=true, empty sets
 * - "countries"  -> lookupCountry each include; fallback to lookupRegion; unresolved
 * - "regions"    -> lookupRegion each; fallback to lookupCountry; unresolved
 * - "timezones"  -> lookupTimezoneGroup each; unresolved
 * - "cities"     -> lookupCity each; add city name + countryCode; unresolved
 *
 * Exclusions are processed identically, then subtracted from resolved codes.
 *
 * `tier.immigrationFlags` (optional) is passed through unchanged onto the
 * output `ResolvedTierGeo.immigrationFlags`. No runtime compat shim for
 * legacy `workFormats: ["relocation", ...]` data — per Q2 decision, the
 * DB is empty and the shim is removed.
 */
export function resolveTierGeo(tier: LocationPreferenceTierInput): ResolvedTierGeo {
  const resolved: ResolvedTierGeo = {
    rank: tier.rank,
    workFormats: tier.workFormats,
    resolvedCountryCodes: new Set<string>(),
    resolvedCityNames: new Set<string>(),
    isAny: false,
    excludedCountryCodes: new Set<string>(),
    unresolvedEntries: [],
    immigrationFlags: tier.immigrationFlags,
  };

  const { type, include, exclude } = tier.scope;

  // "any" scope matches everything
  if (type === "any") {
    resolved.isAny = true;
    return resolved;
  }

  // Resolve include entries
  for (const entry of include) {
    resolveEntry(entry, type, resolved, "include");
  }

  // Resolve exclude entries
  if (exclude) {
    for (const entry of exclude) {
      resolveEntry(entry, type, resolved, "exclude");
    }
  }

  // Subtract excluded from resolved
  for (const code of resolved.excludedCountryCodes) {
    resolved.resolvedCountryCodes.delete(code);
  }

  return resolved;
}

/**
 * Resolve a single user entry (from include or exclude list) based on scope type.
 */
function resolveEntry(
  entry: string,
  scopeType: "countries" | "regions" | "timezones" | "cities",
  resolved: ResolvedTierGeo,
  direction: "include" | "exclude",
): void {
  const target =
    direction === "include"
      ? resolved.resolvedCountryCodes
      : resolved.excludedCountryCodes;

  switch (scopeType) {
    case "countries":
      resolveAsCountry(entry, target, resolved);
      break;
    case "regions":
      resolveAsRegion(entry, target, resolved);
      break;
    case "timezones":
      resolveAsTimezone(entry, target, resolved);
      break;
    case "cities":
      resolveAsCity(entry, resolved, direction);
      break;
  }
}

/**
 * Resolve entry as a country. Fallback to composite region.
 */
function resolveAsCountry(
  entry: string,
  target: Set<string>,
  resolved: ResolvedTierGeo,
): void {
  // Try direct country lookup
  const code = lookupCountry(entry);
  if (code) {
    target.add(code);
    return;
  }

  // Fallback: user may have typed a region name as a country (e.g., "EU")
  const region = lookupRegion(entry);
  if (region) {
    for (const memberCode of region.memberCountryCodes) {
      target.add(memberCode);
    }
    return;
  }

  // Unresolved -- keep for substring fallback
  resolved.unresolvedEntries.push(entry);
}

/**
 * Resolve entry as a composite region. Fallback to country.
 */
function resolveAsRegion(
  entry: string,
  target: Set<string>,
  resolved: ResolvedTierGeo,
): void {
  // Try region lookup
  const region = lookupRegion(entry);
  if (region) {
    for (const memberCode of region.memberCountryCodes) {
      target.add(memberCode);
    }
    return;
  }

  // Fallback: user may have typed a country name as a region
  const code = lookupCountry(entry);
  if (code) {
    target.add(code);
    return;
  }

  // Unresolved
  resolved.unresolvedEntries.push(entry);
}

/**
 * Resolve entry as a timezone group.
 */
function resolveAsTimezone(
  entry: string,
  target: Set<string>,
  resolved: ResolvedTierGeo,
): void {
  const tzGroup = lookupTimezoneGroup(entry);
  if (tzGroup) {
    for (const memberCode of tzGroup.memberCountryCodes) {
      target.add(memberCode);
    }
    return;
  }

  // Unresolved
  resolved.unresolvedEntries.push(entry);
}

/**
 * Resolve entry as a city. Adds city name only (not the country code).
 * City-scoped tiers must NOT leak to country-wide matching -- a user who
 * selected city = Berlin should not match all jobs in Germany.
 */
function resolveAsCity(
  entry: string,
  resolved: ResolvedTierGeo,
  direction: "include" | "exclude",
): void {
  const cityEntry = lookupCity(entry);
  if (cityEntry) {
    if (direction === "include") {
      resolved.resolvedCityNames.add(cityEntry.name);
    } else {
      resolved.excludedCountryCodes.add(cityEntry.countryCode);
    }
    return;
  }

  // Unresolved
  resolved.unresolvedEntries.push(entry);
}

/**
 * Resolve all tiers from a user's location preferences.
 * Returns tiers sorted by rank (ascending -- rank 1 is most preferred).
 */
export function resolveAllTiers(
  tiers: LocationPreferenceTierInput[],
): ResolvedTierGeo[] {
  return tiers
    .map((tier) => resolveTierGeo(tier))
    .sort((a, b) => a.rank - b.rank);
}
