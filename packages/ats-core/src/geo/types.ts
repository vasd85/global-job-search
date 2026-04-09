/** The type of a resolved geographic entity. */
export type GeoEntityType =
  | "city"
  | "country"
  | "composite_region"
  | "timezone_group";

/** A resolved geographic entity with its place in the hierarchy. */
export interface ResolvedGeoEntity {
  type: GeoEntityType;
  /** Canonical lowercase name (e.g., "berlin", "germany", "eea"). */
  canonicalName: string;
  /** ISO 3166-1 alpha-2 country code, if applicable (e.g., "DE"). */
  countryCode: string | null;
  /** For cities: the country this city belongs to. Null for countries/regions. */
  parentCountryCode: string | null;
  /** For composite regions: the set of member country codes. */
  memberCountryCodes: string[] | null;
}

/** A parsed job location -- what we extract from job.locationRaw. */
export interface ParsedJobLocation {
  /** The original raw string from the ATS. */
  raw: string;
  /** Whether the job is explicitly marked as remote. */
  isRemote: boolean;
  /** Whether the job is described as "Anywhere" or has no geographic constraint. */
  isAnywhere: boolean;
  /** Resolved city, if detected. */
  city: { name: string; countryCode: string } | null;
  /** Resolved country code, if detected. */
  countryCode: string | null;
  /** Resolved country name. */
  countryName: string | null;
  /** State/region within the country (e.g., "CA", "Bavaria"). */
  stateOrRegion: string | null;
  /** Confidence: did we fully resolve this, partially, or not at all? */
  confidence: "full" | "partial" | "unresolved";
}

/**
 * Resolved per-tier immigration requirements.
 *
 * All fields are optional — `undefined` means "no constraint in this tier".
 * Populated by `resolveTierGeo` from the chatbot's `immigrationFlags` input.
 */
export interface ResolvedImmigration {
  /** Tier requires the job to offer visa sponsorship. */
  needsVisaSponsorship?: boolean;
  /** Tier prefers jobs offering a relocation package. SCORE-ONLY, not a filter gate. */
  wantsRelocationPackage?: boolean;
  /** Tier requires the job to NOT restrict work authorization to locals/citizens. */
  needsUnrestrictedWorkAuth?: boolean;
}

/**
 * Per-job immigration signals, sourced from persisted `job.visa_sponsorship`,
 * `job.relocation_package`, `job.work_auth_restriction` columns (added in Chunk A).
 *
 * Pass this to the matcher when you have access to the persisted signals.
 * Omitting it (or passing `undefined`) is treated as all-unknown = lenient pass,
 * consistent with the cache warm-up semantics (see plan §8 L3→L2 promotion).
 */
export interface JobImmigrationSignals {
  visaSponsorship: "yes" | "no" | "unknown";
  relocationPackage: "yes" | "no" | "unknown";
  workAuthRestriction: "none" | "locals_only" | "region_only" | "unknown";
}

/** Factory for a fully-unknown signal object. Used as a safe default. */
export const UNKNOWN_JOB_SIGNALS: JobImmigrationSignals = Object.freeze({
  visaSponsorship: "unknown",
  relocationPackage: "unknown",
  workAuthRestriction: "unknown",
});

/** A resolved user location preference for a single tier. */
export interface ResolvedTierGeo {
  /** Tier rank from the user's preference (1 = most preferred). */
  rank: number;
  /** Work formats acceptable for this tier. Strictly remote|hybrid|onsite. */
  workFormats: string[];
  /** Set of ISO country codes that this tier's scope resolves to. */
  resolvedCountryCodes: Set<string>;
  /** Set of specific city canonical names (for city-scoped tiers). */
  resolvedCityNames: Set<string>;
  /** Whether this tier has scope type "any" (matches everything). */
  isAny: boolean;
  /** Excluded country codes (e.g., Cyprus excluded from EU). */
  excludedCountryCodes: Set<string>;
  /** Unresolved entries kept for substring fallback matching. */
  unresolvedEntries: string[];
  /** Optional per-tier immigration flags. `undefined` = no immigration constraint. */
  immigrationFlags?: ResolvedImmigration | undefined;
}

/** Result of matching a job against all resolved tiers. */
export interface LocationMatchResult {
  passes: boolean;
  matchedTier: number | null;
}

/** A country record in the static reference data. */
export interface CountryRecord {
  /** ISO 3166-1 alpha-2 (e.g., "DE"). */
  alpha2: string;
  /** ISO 3166-1 alpha-3 (e.g., "DEU"). */
  alpha3: string;
  /** Canonical English name, lowercase (e.g., "germany"). */
  name: string;
  /** Common aliases, all lowercase (e.g., ["deutschland"]). */
  aliases: string[];
  /** Primary IANA timezone (e.g., "Europe/Berlin"). */
  primaryTimezone: string;
}

/** A composite region record in the static reference data. */
export interface CompositeRegionRecord {
  /** Canonical name, lowercase (e.g., "eea", "dach", "latam"). */
  name: string;
  /** Common aliases (e.g., ["european economic area"]). */
  aliases: string[];
  /** Member country codes (ISO alpha-2). */
  memberCountryCodes: string[];
  /** Whether this is a formal grouping (official member list) or informal. */
  isFormal: boolean;
}

/** A timezone group record in the static reference data. */
export interface TimezoneGroupRecord {
  /** Canonical name (e.g., "us_timezone", "europe_timezone"). */
  name: string;
  /** Common aliases. */
  aliases: string[];
  /** UTC offset range: [minOffsetMinutes, maxOffsetMinutes]. */
  utcOffsetRange: [number, number];
  /** Explicit list of country codes in this timezone band. */
  memberCountryCodes: string[];
}

/** An entry in the city index built from GeoNames data. */
export interface CityIndexEntry {
  /** Canonical name, lowercase (e.g., "berlin"). */
  name: string;
  /** ASCII name for accent-insensitive matching. */
  asciiName: string;
  /** ISO 3166-1 alpha-2 country code. */
  countryCode: string;
  /** Population (for disambiguation). */
  population: number;
  /** IANA timezone. */
  timezone: string;
  /** Key alternate names, lowercase. */
  alternateNames: string[];
}
