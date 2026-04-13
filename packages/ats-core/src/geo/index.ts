// Types
export type {
  GeoEntityType,
  ResolvedGeoEntity,
  ParsedJobLocation,
  ResolvedTierGeo,
  ResolvedImmigration,
  JobImmigrationSignals,
  LocationMatchResult,
  CityIndexEntry,
  CountryRecord,
  CompositeRegionRecord,
  TimezoneGroupRecord,
} from "./types";
export { UNKNOWN_JOB_SIGNALS } from "./types";

// Reference data lookups
export { lookupCountry, COUNTRIES, COUNTRY_REVERSE_INDEX } from "./country-data";
export { lookupRegion, COMPOSITE_REGIONS, REGION_REVERSE_INDEX } from "./composite-regions";
export { lookupTimezoneGroup, TIMEZONE_GROUPS } from "./timezone-groups";
export { isUsState, isCanadianProvince, US_STATES, CA_PROVINCES } from "./us-states";
export { lookupCity, lookupCityInCountry } from "./city-index";

// Core logic
export { parseJobLocation } from "./parse-job-location";
export { resolveTierGeo, resolveAllTiers } from "./resolve-user-location";
export type { LocationPreferenceTierInput } from "./resolve-user-location";
export {
  matchJobToTiers,
  workFormatMatch,
  immigrationMatch,
  normalizeWorkplaceType,
  geoMatch,
  tierMatch,
  wordBoundaryMatch,
} from "./match-location";

// Cache
export { LocationCache, locationCache } from "./location-cache";
