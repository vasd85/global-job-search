# Architecture: Location Matching (P6.1)

Status: **Draft v1** | Date: 2026-03-31

---

## 1. Executive Summary

The current Level 2 search filter uses naive substring matching for location filtering, producing systematic false positives ("US" matches "Campus", "EU" matches "Reuters") and false negatives ("UK" does not match "United Kingdom", "Germany" does not match "Berlin, DE"). The system cannot resolve geographic hierarchy, composite regions (EEA, DACH, Latam), timezone-based preferences, or city abbreviations.

This document proposes a **type-aware geographic matching system** built on static reference data derived from GeoNames and ISO 3166. User preferences and job locations are both resolved to structured geo-entities with hierarchy awareness, enabling correct matching: a country preference matches any city within that country, a region preference matches any country within that region, and a city preference matches only that city. The system is local-first (no external API calls at search time), deterministic, and designed to integrate with the existing tier-based location preference model from the chatbot.

---

## 2. Research Findings

### 2.1 GeoNames Data

[GeoNames](https://www.geonames.org/export/) provides free, CC-licensed geographic databases. The key files:

| File | Records | Description |
|------|---------|-------------|
| `cities15000.txt` | ~25,000 | All cities with population > 15,000 |
| `cities5000.txt` | ~50,000 | All cities with population > 5,000 |
| `cities1000.txt` | ~140,000 | All cities with population > 1,000 |
| `countryInfo.txt` | ~252 | Country metadata with ISO codes |

**Column structure** (tab-delimited, UTF-8):

```
geonameid | name | asciiname | alternatenames | latitude | longitude |
feature_class | feature_code | country_code | cc2 | admin1_code |
admin2_code | admin3_code | admin4_code | population | elevation |
dem | timezone | modification_date
```

Key fields for this system:
- `name` / `asciiname` -- city name
- `alternatenames` -- comma-separated alternative names (abbreviations, local names)
- `country_code` -- ISO 3166-1 alpha-2 (links to country reference)
- `timezone` -- IANA timezone identifier (e.g., "Europe/Berlin")
- `population` -- useful for disambiguation (larger city wins)

The `alternatenames` field is embedded in each row, so for most use cases the separate `alternateNames.zip` (500MB+) is unnecessary. The embedded field lacks language tags but contains the name variants needed for matching.

**Size consideration**: `cities5000.txt` is approximately 5MB uncompressed. Parsed into a JSON lookup structure, this is roughly 2--3MB in memory. `cities15000.txt` is roughly half that. For a global job search platform, `cities5000.txt` provides the best coverage/size tradeoff: it covers virtually all cities that appear in ATS job locations.

### 2.2 ISO 3166 Country Codes

ISO 3166-1 defines alpha-2 (US, DE, GB), alpha-3 (USA, DEU, GBR), and numeric country codes. For this system, alpha-2 is the canonical key because it matches GeoNames `country_code` and is the most widely used in ATS location strings.

**npm packages evaluated**:

| Package | Weekly downloads | Notes |
|---------|-----------------|-------|
| `i18n-iso-countries` | ~600K | Alpha-2/3/numeric, multilingual names, lookup by name |
| `countries-list` | ~150K | ISO codes + continents + currencies + phone codes |
| `iso-3166` | ~20K | All 3 parts of ISO 3166, scraped from Wikipedia |

**Recommendation**: Do not add a dependency. The country reference data needed (~250 entries mapping alpha-2 code to name + common aliases) is small enough to ship as a static TypeScript file, avoiding dependency churn and enabling project-specific customizations (e.g., adding "Holland" as an alias for "Netherlands").

### 2.3 Timezone Mappings

IANA timezone identifiers (e.g., `America/New_York`, `Europe/Berlin`) map to specific geographic regions. Each GeoNames city record includes its IANA timezone.

**npm packages evaluated**:

| Package | Notes |
|---------|-------|
| `countries-and-timezones` | Minimalistic, maps country <-> timezone |
| `@vvo/tzdb` | Auto-updated from GeoNames/IANA, grouped by major cities |
| `city-timezones` | City -> timezone lookup with population data |

**Recommendation**: Since GeoNames city data already includes timezone identifiers, and the `countryInfo.txt` file maps countries to primary timezones, no additional package is needed. The system can derive timezone-to-country mappings from the same GeoNames data used for city resolution.

For user-facing timezone preferences like "Europe timezone" or "US timezone", the system needs a small curated mapping of colloquial timezone labels to UTC offset ranges, which is best maintained as static code.

### 2.4 Job Platform Location Handling

Research into how major platforms handle location data:

- **Greenhouse**: Stores location as a freeform `name` string (e.g., "San Francisco, CA"). The API returns `location: { name: string }`. No structured city/country/state fields.
- **Lever**: Stores location in `categories.location` as a freeform string (e.g., "San Francisco, CA", "Remote, US").
- **Ashby**: Primary `location` string plus `secondaryLocations` array. Supports patterns like "Remote, US", "Berlin, DE".
- **SmartRecruiters**: Structured `location: { city, region, country }` object -- the only vendor with pre-parsed fields.
- **LinkedIn**: Requires valid location for all job posts. Mismatched formatting between Greenhouse and LinkedIn causes LinkedIn to default to "United States of America".

**Key insight**: Most ATS vendors return freeform location strings. The dominant patterns observed in real data from our extractors:
- `"City, State/Province, Country"` (e.g., "San Francisco, CA, United States")
- `"City, Country"` (e.g., "Berlin, Germany")
- `"City, Country Code"` (e.g., "Berlin, DE", "London, UK")
- `"Remote"` / `"Remote, Country"` / `"Remote - Region"` (e.g., "Remote, US", "Remote - Europe")
- `"Country"` alone (e.g., "United States", "Germany")
- `"City, State"` without country (e.g., "Austin, TX")
- Multi-location: `"New York or London"`, `"Berlin, DE, London, UK"` (comma-separated compound)

### 2.5 PostGIS vs Application-Level Matching

| Criterion | PostGIS | Application-Level |
|-----------|---------|-------------------|
| Setup complexity | High (extension install, managed DB support) | Low (static data in code) |
| Render Postgres support | Not guaranteed on Basic tier | N/A |
| Query types needed | Containment ("is Berlin in Germany?") | Same, via lookup maps |
| Radius/proximity queries | Excellent | Not needed for this use case |
| Performance at scale | Superior for spatial joins | Adequate -- matching is O(tiers * locations) per job |
| Operational cost | Extension management, spatial indexes | Zero |

**Decision: Application-level matching.** This system needs hierarchy-based containment ("is this city in this country?"), not geometric spatial queries. The containment relationship is captured in the GeoNames `country_code` field on each city record. PostGIS would be overengineered for this use case and adds infrastructure complexity on Render's managed Postgres.

### 2.6 Offline Geocoding Libraries

Several npm packages bundle GeoNames data for offline lookups:

| Package | Size | Approach |
|---------|------|----------|
| `offline-geocoder` | ~12MB SQLite | Reverse geocode (lat/lng to city) |
| `offline-geocode-city` | ~217KB | S2 cell-based reverse geocode |
| `local-reverse-geocoder` | Caches GeoNames | Full GeoNames cache in memory |

**Decision: Do not use these.** They solve reverse geocoding (coordinates to name), not forward matching (name to canonical entity). The system needs a purpose-built forward index optimized for substring matching against ATS location strings. Building this from raw GeoNames data gives full control over the index structure.

---

## 3. Data Model

### 3.1 Core Types: Structured Location Representation

The fundamental shift: locations are no longer strings -- they are typed geo-entities with hierarchy.

```typescript
/** The type of a resolved geographic entity. */
type GeoEntityType = "city" | "country" | "composite_region" | "timezone_group";

/** A resolved geographic entity with its place in the hierarchy. */
interface ResolvedGeoEntity {
  type: GeoEntityType;
  /** Canonical lowercase name (e.g., "berlin", "germany", "eea") */
  canonicalName: string;
  /** ISO 3166-1 alpha-2 country code, if applicable (e.g., "DE") */
  countryCode: string | null;
  /** For cities: the country this city belongs to. Null for countries/regions. */
  parentCountryCode: string | null;
  /** For composite regions: the set of member country codes. */
  memberCountryCodes: string[] | null;
}

/** A parsed job location -- what we extract from job.locationRaw. */
interface ParsedJobLocation {
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

/** A resolved user location preference for a single tier. */
interface ResolvedTierGeo {
  /** Tier rank from the user's preference (1 = most preferred). */
  rank: number;
  /** Work formats acceptable for this tier. */
  workFormats: TierWorkFormat[];
  /** Set of ISO country codes that this tier's scope resolves to. */
  resolvedCountryCodes: Set<string>;
  /** Set of specific city canonical names (for city-scoped tiers). */
  resolvedCityNames: Set<string>;
  /** Whether this tier has scope type "any" (matches everything). */
  isAny: boolean;
  /** Excluded country codes (e.g., Cyprus excluded from EU). */
  excludedCountryCodes: Set<string>;
}
```

### 3.2 Reference Data Tables (Static TypeScript)

Following decision D14 (static code for geographic reference data), all reference data lives in TypeScript files inside the new `packages/ats-core/src/geo/` module. No database tables.

#### 3.2.1 Country Reference

```typescript
interface CountryRecord {
  /** ISO 3166-1 alpha-2 (e.g., "DE") */
  alpha2: string;
  /** ISO 3166-1 alpha-3 (e.g., "DEU") */
  alpha3: string;
  /** Canonical English name, lowercase (e.g., "germany") */
  name: string;
  /** Common aliases, all lowercase (e.g., ["deutschland", "federal republic of germany"]) */
  aliases: string[];
  /** Primary IANA timezone (e.g., "Europe/Berlin") */
  primaryTimezone: string;
}
```

Approximately 250 entries. Aliases include:
- Short forms: "uk" -> GB, "usa" / "us" -> US, "uae" -> AE
- Historical/colloquial: "holland" -> NL, "czech republic" -> CZ
- Constituent countries where relevant: "england", "scotland", "wales" -> GB

#### 3.2.2 Composite Region Reference

```typescript
interface CompositeRegionRecord {
  /** Canonical name, lowercase (e.g., "eea", "dach", "latam") */
  name: string;
  /** Common aliases (e.g., ["european economic area"]) */
  aliases: string[];
  /** Member country codes (ISO alpha-2) */
  memberCountryCodes: string[];
  /** Whether this is a formal grouping (official member list) or informal */
  isFormal: boolean;
}
```

Curated list of ~25 composite regions:

| Region | Type | Countries (alpha-2) |
|--------|------|---------------------|
| **EU** | Formal | AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IE, IT, LV, LT, LU, MT, NL, PL, PT, RO, SK, SI, ES, SE |
| **EEA** | Formal | EU + IS, LI, NO |
| **DACH** | Informal | DE, AT, CH |
| **Nordics** | Informal | DK, FI, IS, NO, SE |
| **Benelux** | Informal | BE, NL, LU |
| **Baltics** | Informal | EE, LV, LT |
| **Latam** / **Latin America** | Informal | AR, BO, BR, CL, CO, CR, CU, DO, EC, SV, GT, HN, MX, NI, PA, PY, PE, PR, UY, VE |
| **APAC** / **Asia-Pacific** | Informal | AU, BD, CN, HK, IN, ID, JP, KR, MY, NZ, PH, SG, TW, TH, VN |
| **MENA** | Informal | AE, BH, DZ, EG, IQ, IL, JO, KW, LB, LY, MA, OM, PS, QA, SA, TN, YE |
| **EMEA** | Informal | EU + MENA + Sub-Saharan Africa selection |
| **AMER** / **Americas** | Informal | US, CA, MX + Latam |
| **ANZ** | Informal | AU, NZ |
| **SEA** / **Southeast Asia** | Informal | BN, KH, ID, LA, MY, MM, PH, SG, TH, TL, VN |
| **GCC** | Formal | AE, BH, KW, OM, QA, SA |
| **CEE** / **Central Eastern Europe** | Informal | CZ, HU, PL, SK, RO, BG, HR, SI |
| **Western Europe** | Informal | AT, BE, CH, DE, FR, IE, LU, NL, GB |
| **Eastern Europe** | Informal | BY, CZ, HU, MD, PL, RO, RU, SK, UA |
| **UK & Ireland** | Informal | GB, IE |
| **Schengen** | Formal | AT, BE, CZ, DK, EE, FI, FR, DE, GR, HU, IS, IT, LV, LI, LT, LU, MT, NL, NO, PL, PT, SK, SI, ES, SE, CH |
| **Europe** | Informal | All European countries (broad) |
| **Asia** | Informal | All Asian countries (broad) |
| **Africa** | Informal | All African countries |
| **North America** | Informal | US, CA, MX |
| **South America** | Informal | AR, BO, BR, CL, CO, EC, GY, PY, PE, SR, UY, VE |
| **Middle East** | Informal | AE, BH, CY, EG, IL, IQ, IR, JO, KW, LB, OM, PS, QA, SA, SY, TR, YE |
| **Oceania** | Informal | AU, NZ, FJ, PG, WS, TO, VU |

For **formal groupings** (EU, EEA, Schengen, GCC), member lists are based on official membership as of 2025. Updates are infrequent and can be handled via normal code releases.

For **informal groupings** (Latam, Nordics, DACH, APAC), a canonical interpretation is fixed and documented. The interpretation is deliberately broad rather than narrow -- it is better to include a borderline country and let the user exclude it than to silently omit it.

#### 3.2.3 Timezone Group Reference

```typescript
interface TimezoneGroupRecord {
  /** Canonical name (e.g., "us_timezone", "europe_timezone") */
  name: string;
  /** Common aliases */
  aliases: string[];
  /** UTC offset range: [minOffsetMinutes, maxOffsetMinutes] */
  utcOffsetRange: [number, number];
  /** Explicit list of country codes in this timezone band */
  memberCountryCodes: string[];
}
```

Approximately 6-8 groups covering the common user expressions:

| Group | Aliases | UTC Range | Key Countries |
|-------|---------|-----------|---------------|
| US timezone | "americas timezone", "north america timezone" | UTC-10 to UTC-4 | US, CA, MX |
| Europe timezone | "european timezone", "CET", "CEST" | UTC-1 to UTC+3 | GB, DE, FR, ES, IT, NL, etc. |
| Asia timezone | "asian timezone" | UTC+5 to UTC+9 | IN, CN, JP, KR, SG, etc. |
| Pacific timezone | "oceania timezone", "AEST" | UTC+8 to UTC+13 | AU, NZ, SG, HK |
| Middle East timezone | "gulf timezone" | UTC+2 to UTC+4 | AE, SA, IL, TR |
| Latin America timezone | "south america timezone" | UTC-5 to UTC-3 | BR, AR, CL, CO, MX |

**Timezone abbreviation disambiguation**: Abbreviations like "CST" are ambiguous (Central Standard Time in US vs. China Standard Time). The system resolves these in favor of the more common meaning in a global job search context (US-centric for "CST", "EST", "PST"; Asia-centric for "JST", "IST"). If the chatbot detects ambiguity, it should ask for clarification.

#### 3.2.4 City Index (Derived from GeoNames)

At build time, `cities15000.txt` (starting choice) is parsed into a compact lookup structure:

```typescript
interface CityIndexEntry {
  /** Canonical name, lowercase (e.g., "berlin") */
  name: string;
  /** ASCII name for accent-insensitive matching */
  asciiName: string;
  /** ISO 3166-1 alpha-2 country code */
  countryCode: string;
  /** Population (for disambiguation) */
  population: number;
  /** IANA timezone */
  timezone: string;
  /** Key alternate names, lowercase */
  alternateNames: string[];
}
```

The raw GeoNames file is processed during a build step into a JSON artifact committed to the repository. The build step:
1. Parses the tab-delimited file
2. Filters to feature classes P (populated places)
3. Extracts relevant fields
4. Splits `alternatenames` and filters to useful variants
5. Outputs a JSON file sorted by population descending (for disambiguation)

**US state abbreviation handling**: For US jobs, location strings frequently use state abbreviations ("CA", "NY", "TX") without country. A small supplementary map of US state abbreviations to full names is included. Same for Canadian provinces ("ON", "BC", "AB").

### 3.3 Job Location Normalization Cache

Decision D13 specifies geographic normalization at search time, not ingestion time. However, parsing the same `locationRaw` string repeatedly across searches is wasteful.

**Strategy: Parse-on-first-access with in-memory LRU cache.**

The `ParsedJobLocation` result for a given `locationRaw` string is deterministic. An in-memory LRU cache keyed by `locationRaw` avoids re-parsing across requests within the same process lifetime.

```
Cache key:   lowercase(locationRaw)
Cache value: ParsedJobLocation
Cache size:  10,000 entries
Eviction:    LRU
```

This respects D13 (no schema changes) while avoiding repeated parsing cost.

**Future option**: If the job table grows large, add optional `location_country_code` and `location_city` columns populated lazily during polling. Explicitly deferred -- the in-memory cache is sufficient for the expected volume.

### 3.4 Schema Impact

**No schema changes required.** The system operates on existing fields:
- Reads `job.locationRaw` and `job.workplaceType`
- Reads `user_profiles.locationPreferences` (JSONB tiers)
- Reads `user_profiles.remotePreference` and `user_profiles.preferredLocations`

All new logic is in application code. All reference data is static TypeScript in `packages/ats-core/src/geo/`.

---

## 4. Location Resolution Pipeline

### 4.1 Resolving User Input (Preference Tiers to Resolved Geo)

User location preferences arrive as `LocationPreferenceTier[]` from the chatbot. Each tier has a `scope` with `type` (countries | regions | timezones | cities | any) and `include`/`exclude` lists.

**Resolution algorithm for each tier:**

```
Input:  LocationPreferenceTier
Output: ResolvedTierGeo

1. If scope.type === "any":
   -> ResolvedTierGeo { isAny: true, resolvedCountryCodes: empty, resolvedCityNames: empty }

2. If scope.type === "countries":
   For each entry in scope.include:
     a. Lookup in country reference by name, alpha-2, alpha-3, or alias
     b. If found: add country's alpha-2 to resolvedCountryCodes
     c. If not found: check composite regions (e.g., user typed "EU" as a country)
        If composite region found: add all member country codes
     d. If still not found: keep as unresolved string for fallback substring match

3. If scope.type === "regions":
   For each entry in scope.include:
     a. Lookup in composite region reference by name or alias
     b. If found: add all member country codes to resolvedCountryCodes
     c. If not found: attempt country lookup (user may have typed a country name)
     d. If still not found: keep as unresolved for fallback

4. If scope.type === "timezones":
   For each entry in scope.include:
     a. Lookup in timezone group reference by name or alias
     b. If found: add all member country codes to resolvedCountryCodes
     c. If not found: attempt IANA timezone ID lookup -> derive country
     d. If still not found: keep as unresolved for fallback

5. If scope.type === "cities":
   For each entry in scope.include:
     a. Lookup in city index by name, asciiName, or alternateName
     b. If found: add city name to resolvedCityNames, add city's countryCode
        to resolvedCountryCodes
     c. If multiple cities match (e.g., "Portland"): prefer by population
     d. If not found: keep as unresolved for fallback

6. Apply exclusions:
   For each entry in scope.exclude:
     Resolve using same logic as include, add to excludedCountryCodes

7. Subtract excludedCountryCodes from resolvedCountryCodes
```

**Important**: Unresolved entries are not silently dropped. They are kept as raw strings for a final substring fallback match. This preserves behavior for edge cases where reference data does not cover the user's input.

### 4.2 Resolving Job locationRaw (ATS String to ParsedJobLocation)

```
Input:  locationRaw: string (e.g., "San Francisco, CA, United States")
Output: ParsedJobLocation

1. Normalize: lowercase, trim whitespace, collapse multiple spaces

2. Detect remote/anywhere signals:
   - Check for "remote" (word boundary) -> isRemote = true
   - Check for "anywhere" -> isAnywhere = true
   - If the entire string is "remote" or "anywhere": return early
     { isRemote: true/false, isAnywhere: true/false, city: null, countryCode: null,
       confidence: "full" }

3. Handle "Remote, <scope>" pattern:
   - Regex: /^remote\s*[-,/]\s*(.+)$/i
   - Extract the scope part (e.g., "US" from "Remote, US")
   - Resolve scope part as country/region (go to step 5)
   - Keep isRemote = true

4. Split on comma separator:
   parts = locationRaw.split(",").map(trim).filter(nonEmpty)

   Common patterns:
   - 3 parts: [city, state, country] (e.g., "San Francisco, CA, United States")
   - 2 parts: [city, country] or [city, state] (e.g., "Berlin, Germany" or "Austin, TX")
   - 1 part:  [country] or [city] (e.g., "Germany" or "Singapore")

5. Resolve from right to left (most specific to least):
   a. Take the rightmost part -> attempt country lookup (name, alpha-2, alpha-3, alias)
   b. If country found:
      - countryCode = matched alpha-2
      - If 3 parts: city = parts[0], stateOrRegion = parts[1]
      - If 2 parts: city = parts[0]
      - Validate city against city index for that country (optional, for confidence)
   c. If rightmost part is not a country:
      - Check if it is a US state abbreviation (2 uppercase letters)
        If yes: countryCode = "US", stateOrRegion = parts[last], city = parts[0]
      - Check if it is a Canadian province abbreviation
        If yes: countryCode = "CA", stateOrRegion = parts[last]
   d. If 1 part and not a country:
      - Check city index (e.g., "Singapore" is both a city and a country)
      - If city found: use city's countryCode

6. Set confidence:
   - "full": country resolved, and (city validated against index or no city component)
   - "partial": country resolved but city not validated, or only state resolved
   - "unresolved": nothing matched

7. Return ParsedJobLocation
```

### 4.3 Handling Special Cases

| Pattern | Example | Resolution |
|---------|---------|------------|
| Pure "Remote" | `"Remote"` | isRemote=true, no geo constraint, passes all geo filters |
| "Anywhere" | `"Anywhere"` | isAnywhere=true, passes all geo filters |
| "Remote, Country" | `"Remote, US"` | isRemote=true, countryCode=US |
| "Remote - Region" | `"Remote - Europe"` | isRemote=true, resolve "Europe" as composite region |
| "Remote, City" | `"Remote, Berlin"` | isRemote=true, city=Berlin, countryCode=DE |
| Null/empty | `null`, `""` | Treated as "Anywhere" -- passes all geo filters (existing behavior) |
| Country code only | `"DE"` | countryCode=DE |
| City+state (US) | `"Austin, TX"` | city=Austin, stateOrRegion=TX, countryCode=US |
| Multiple locations | `"New York or London"` | Split on " or ", parse each part |
| Multi-location compound | `"Berlin, DE, London, UK"` | Detect repeated [City, Code] pattern |
| City, Region, Country | `"Berlin, Berlin, Germany"` | 3-part with region dedup |
| Country code only | `"US"`, `"DE"` | 1-part, alpha-2 lookup |
| Anywhere | `"Anywhere"` | isAnywhere flag, passes all filters |
| With extras | `"Campus Location, Austin, TX"` | Right-to-left resolution handles "Campus" correctly |

### 4.4 Caching Strategy

```
Layer 1: In-memory LRU cache for ParsedJobLocation (keyed by lowercase locationRaw)
         - Capacity: 10,000 entries
         - Scope: per-process (resets on deploy/restart)
         - Hit rate: expected >90% (many jobs share locations)

Layer 2: Reference data loaded once at module initialization
         - Country map, composite regions, timezone groups: always in memory
         - City index: loaded lazily on first location resolution call
         - Total memory: ~2MB for city index + ~50KB for country/region/timezone data
```

No database caching layer. The in-memory approach is sufficient because the reference data is static and the number of distinct `locationRaw` values is bounded (~5,000 for 500K jobs).

---

## 5. Matching Algorithm

### 5.1 Core Principle: tierMatch = workFormatMatch AND geoMatch

Each location preference tier defines both acceptable work formats and a geographic scope. A job matches a tier only if **both** conditions are satisfied:

```
tierMatch(job, tier) = workFormatMatch(job, tier) AND geoMatch(job, tier)
```

A job passes the Level 2 location filter if it matches **at least one** tier. The highest-ranking (lowest `rank` number) matched tier is recorded as metadata for Level 3 scoring.

### 5.2 Work Format Matching

```
workFormatMatch(job, tier):
  tierFormats = tier.workFormats  // e.g., ["remote", "hybrid"]
  jobType = job.workplaceType    // "remote" | "hybrid" | "onsite" | null

  // If job has no workplaceType, assume it could be any format -> pass
  if jobType is null: return true

  // Direct mapping
  if jobType === "remote" and "remote" in tierFormats: return true
  if jobType === "hybrid" and "hybrid" in tierFormats: return true
  if jobType === "onsite" and ("onsite" in tierFormats or "relocation" in tierFormats):
    return true

  return false
```

**Note on "relocation"**: `TierWorkFormat` includes "relocation" which implies the user is willing to relocate for onsite work. For matching purposes, "relocation" is treated the same as "onsite" -- the distinction is semantic and relevant for Level 3 scoring, not Level 2 filtering.

### 5.3 Geographic Matching

```
geoMatch(job, tier):
  parsed = parseJobLocation(job.locationRaw)  // ParsedJobLocation (cached)
  resolved = tier.resolvedGeo                  // ResolvedTierGeo (precomputed)

  // Tier scope is "any" -> matches everything
  if resolved.isAny: return true

  // Job location is "Anywhere" or unset -> passes all geo filters
  if parsed.isAnywhere or (parsed.countryCode is null and parsed.city is null
      and parsed.confidence === "unresolved"):
    return true

  // Job is Remote with no geographic constraint -> passes all geo filters
  if parsed.isRemote and parsed.countryCode is null:
    return true

  // City-level matching (most specific)
  if resolved.resolvedCityNames.size > 0 and parsed.city is not null:
    if resolved.resolvedCityNames.has(parsed.city.name.toLowerCase()):
      if not resolved.excludedCountryCodes.has(parsed.city.countryCode):
        return true

  // Country-level matching (hierarchy-aware)
  if parsed.countryCode is not null:
    if resolved.resolvedCountryCodes.has(parsed.countryCode):
      if not resolved.excludedCountryCodes.has(parsed.countryCode):
        return true

  // Fallback: substring match for unresolved entries
  return substringFallback(job.locationRaw, tier.unresolvedEntries)
```

### 5.4 Directionality of Matching

A critical design point: **matching is not symmetric**.

- If user chose **country = UK**, then a job in **city = London** SHOULD match (London is in the UK).
- If user chose **city = London**, then a job in **city = Manchester** should NOT match.
- If user chose **region = EU**, then a job in **country = Germany** SHOULD match.
- If user chose **country = Germany**, then a job matching **region = EU** should NOT match (user specifically said Germany).

This is implemented by the hierarchy-aware resolution: when the user says "Germany", only country code DE is in `resolvedCountryCodes`. When the user says "EU", all EU member country codes are in `resolvedCountryCodes`. The job's parsed `countryCode` is checked against the resolved set -- the direction is always "is the job's location contained within the user's preference scope?"

**Hierarchy-aware matching examples:**

| User preference | Scope type | Job locationRaw | Match? | Why |
|-----------------|------------|-----------------|--------|-----|
| "Germany" | countries | "Berlin, DE" | YES | Berlin's countryCode=DE, DE is in resolvedCountryCodes |
| "Berlin" | cities | "Munich, DE" | NO | Munich is not in resolvedCityNames |
| "EEA" | regions | "Oslo, Norway" | YES | NO (Norway alpha-2) is in EEA's memberCountryCodes |
| "EU" excluding "Cyprus" | regions | "Nicosia, CY" | NO | CY is in excludedCountryCodes |
| "Europe timezone" | timezones | "London, UK" | YES | GB is in Europe timezone memberCountryCodes |
| "UK" | countries | "London, United Kingdom" | YES | "United Kingdom" resolves to GB; "UK" also resolves to GB |
| "US" | countries | "Campus, Austin, TX" | YES | TX resolves to US. No false positive on "Campus" |

### 5.5 Full Matching Pipeline (Level 2)

```
matchLocation(job, locationPreferenceTiers):

  // 1. Derive remotePreference for backward compat
  remotePreference = deriveRemotePreference(tiers)

  // 2. If remotePreference is "any", skip location filter entirely (existing behavior)
  if remotePreference === "any": return { passes: true, matchedTier: null }

  // 3. Resolve all tiers to ResolvedTierGeo (cached per search request)
  resolvedTiers = tiers.map(tier => resolveTierGeo(tier))

  // 4. Parse job location (cached via LRU)
  parsed = parseJobLocation(job.locationRaw)

  // 5. Job with null/empty locationRaw passes (existing behavior)
  if job.locationRaw is null or job.locationRaw.trim() === "":
    return { passes: true, matchedTier: null }

  // 6. Try each tier in rank order
  for tier in resolvedTiers (sorted by rank):
    if tierMatch(job, tier):
      return { passes: true, matchedTier: tier.rank }

  // 7. No tier matched
  return { passes: false, matchedTier: null }
```

### 5.6 Fallback for Unresolved Locations

When neither the user preference nor the job location can be resolved to structured geo-entities, the system falls back to case-insensitive matching -- but with **word-boundary awareness** instead of simple `includes()`:

```typescript
function wordBoundaryMatch(haystack: string, needle: string): boolean {
  // For short needles (<=3 chars), require word boundary match
  if (needle.length <= 3) {
    const regex = new RegExp(`\\b${escapeRegex(needle)}\\b`, "i");
    return regex.test(haystack);
  }
  // For longer needles, substring match is safe
  return haystack.toLowerCase().includes(needle.toLowerCase());
}
```

This eliminates "US" matching "Campus" and "EU" matching "Reuters" while preserving legitimate matches.

---

## 6. Reference Data

### 6.1 Country Data (ISO 3166)

**Source**: ISO 3166-1 standard.
**Format**: Static TypeScript file exporting `Map<string, CountryRecord>` + reverse index.
**Maintenance**: Manual updates when a country changes (very rare).
**Size**: ~250 entries, ~15KB as TypeScript source.

### 6.2 City Data (GeoNames cities15000)

**Source**: [GeoNames cities15000.txt](https://download.geonames.org/export/dump/cities15000.zip), CC BY 4.0.
**Processing**: Build-time script (`scripts/build-city-index.ts`) produces `city-index.generated.json`.
**Update frequency**: Quarterly re-download is sufficient.
**Size**: ~25,000 records, ~1.5MB as JSON.
**Upgrade path**: Switch to `cities5000` (~50K records, ~3MB) if coverage gaps are found.

### 6.3 Composite Regions

**Source**: Curated manually from official membership lists + common business usage.
**Format**: Static TypeScript file, ~25 region definitions.
**Maintenance**: Update on formal membership changes or user feedback.

### 6.4 Timezone Mappings

**Source**: Derived from GeoNames `countryInfo.txt` and IANA timezone database.
**Format**: Static TypeScript file, ~8 timezone group definitions.
**Maintenance**: Stable by design; updates rare.

### 6.5 US State and Canadian Province Abbreviations

**Source**: USPS, Canada Post.
**Format**: `Map<string, string>`, ~60 entries.
**Maintenance**: Essentially never changes.

### 6.6 Keeping Reference Data Updated

| Data | Update trigger | Process |
|------|----------------|---------|
| Countries (ISO 3166) | Country name change | Manual edit to TypeScript file |
| Cities (GeoNames) | Quarterly or coverage gap | Run build script, review diff, commit |
| Composite regions | Membership change | Manual edit to TypeScript file |
| Timezone groups | IANA database update | Review, update if needed |
| US states / CA provinces | Never | N/A |

---

## 7. Integration Points

### 7.1 New Module: `packages/ats-core/src/geo/`

```
packages/ats-core/src/geo/
  index.ts                    -- Public API exports
  types.ts                    -- GeoEntity, ParsedJobLocation, ResolvedTierGeo types
  country-data.ts             -- Country reference (ISO 3166 map + reverse index)
  composite-regions.ts        -- Composite region definitions
  timezone-groups.ts          -- Timezone group definitions
  us-states.ts                -- US state + CA province abbreviation maps
  city-index.ts               -- City index loader (imports generated JSON)
  city-index.generated.json   -- Build artifact from GeoNames (committed)
  resolve-user-location.ts    -- User preference tier -> ResolvedTierGeo
  parse-job-location.ts       -- job.locationRaw -> ParsedJobLocation
  match-location.ts           -- Core matching: tierMatch, geoMatch, workFormatMatch
  location-cache.ts           -- LRU cache for ParsedJobLocation
```

This module lives in `packages/ats-core` because it is pure logic with no framework dependency and follows the existing pattern (`classifier/`, `normalizer/`, `discovery/` are all in ats-core). The future `apps/worker` will also need it for job scoring.

### 7.2 Changes to `apps/web/src/lib/search/filter-pipeline.ts`

Replace the current location filter block (lines 272--283) with a call to the new matching module:

**Current** (naive substring):
```typescript
if (
  remotePreference !== "any" &&
  preferredLocations.length > 0 &&
  row.locationRaw !== null
) {
  const locationLower = row.locationRaw.toLowerCase();
  const locationMatch = preferredLocations.some((loc) =>
    locationLower.includes(loc.toLowerCase()),
  );
  if (!locationMatch) continue;
}
```

**New** (structured matching):
```typescript
if (resolvedTiers.length > 0 && row.locationRaw !== null) {
  const locationResult = matchJobToTiers(
    row.locationRaw,
    row.workplaceType,
    resolvedTiers,
  );
  if (!locationResult.passes) continue;
  matchedTierRank = locationResult.matchedTier;
}
```

The `resolvedTiers` are precomputed once per search request from `profile.locationPreferences`.

**Input change**: `processInBatches` currently takes `preferredLocations: string[]`. It needs to take `resolvedTiers: ResolvedTierGeo[]` instead.

### 7.3 Changes to `apps/web/src/lib/search/types.ts`

Add `matchedLocationTier: number | null` to `SearchResultJob`.

### 7.4 Changes to Chatbot Schemas

No schema changes needed. The existing `LocationPreferenceTierSchema` and `LocationScopeSchema` already capture the structured data the new system consumes.

### 7.5 Changes to `apps/web/src/lib/chatbot/location-utils.ts`

No code changes needed. The search pipeline bypasses the flat `derivePreferredLocations()` by reading `profile.locationPreferences` tiers directly.

### 7.6 Migration Plan from Current Substring Matching

**Phase 1** (non-breaking): Add `geo/` module with all reference data and functions. Comprehensive tests. No integration.

**Phase 2** (swap): Replace the location filter in `filter-pipeline.ts`. The fallback substring matcher ensures no regression.

**Phase 3** (cleanup): Update test expectations for false-positive tests. Remove word-boundary fallback where structured matching has proven sufficient.

---

## 8. Tradeoffs and Decisions

### 8.1 Why Local-First Over External API Geocoding

| Factor | Local (GeoNames static data) | External API (Google/Nominatim) |
|--------|------------------------------|----------------------------------|
| Latency | <1ms per lookup | 50-300ms per API call |
| Cost | Free (CC license) | Free tier limits, then paid |
| Reliability | 100% (no network dependency) | Dependent on external service |
| Privacy | No job data leaves the system | Sends location strings to third party |
| Coverage | Cities > 15K population | Street-level precision |
| Accuracy | Sufficient for city/country | Over-precise for this use case |

External geocoding APIs solve a harder problem (street addresses to coordinates) than what this system needs (match "Berlin" to country "DE").

### 8.2 GeoNames Subset Size vs Coverage

**Decision: Start with cities15000.** Tech jobs are concentrated in larger cities. ATS location strings rarely mention cities under 15K population. Upgrading to cities5000 is a one-line change in the build script if gaps are found.

### 8.3 When to Use LLM Fallback vs Deterministic Matching

Level 2 filter is explicitly deterministic (no LLM). LLM is reserved for Level 3 scoring.

**Deterministic** handles: country/city/region resolution, composite region expansion, timezone mapping, remote/anywhere detection, abbreviation resolution.

**LLM** handles (Level 3 only): qualitative constraints, ambiguous multi-location strings, cultural/economic region interpretations, degree-of-fit scoring.

### 8.4 Performance Considerations

**Per-job**: <5us after cache warm-up (Set.has is O(1) per tier).

**Per-search request**: Resolve tiers ~100us + process candidates ~25ms for 5,000 candidates.

**Memory**: ~3-5MB total (city index + country/region data + LRU cache). Well within Render Starter tier's 512MB.

### 8.5 No Schema Changes

Per D13 and D14, this feature adds no database columns, no reference tables, and requires no migration. All new logic is application code. Rollback is: deploy previous version.

---

## 9. Implementation Phases

### Phase 1: Reference Data + Location Parser

**Goal**: Build `packages/ats-core/src/geo/` with all reference data and parsing logic.

**Deliverables**:
- `country-data.ts`: 250 country entries with aliases, reverse index
- `composite-regions.ts`: ~25 region definitions
- `timezone-groups.ts`: ~8 timezone group definitions
- `us-states.ts`: US state + Canadian province abbreviations
- Build script for GeoNames city index
- `city-index.generated.json`: processed GeoNames data (committed)
- `parse-job-location.ts`: locationRaw parser with all pattern handlers
- `resolve-user-location.ts`: tier scope resolver
- `types.ts`: all type definitions
- Comprehensive test suite

**Depends on**: nothing
**Effort**: Large

### Phase 2: Matching Algorithm + Filter Integration

**Goal**: Implement matching and integrate into the search pipeline.

**Deliverables**:
- `match-location.ts`: tierMatch, geoMatch, workFormatMatch functions
- `location-cache.ts`: LRU cache
- Updated `filter-pipeline.ts`: swap substring match for structured match
- Updated `types.ts` in search module: add `matchedLocationTier`
- Updated and new tests

**Depends on**: Phase 1
**Effort**: Medium

### Phase 3: Optimization + Cleanup

**Goal**: Performance tuning and production hardening.

**Deliverables**:
- Performance benchmarks
- Edge case handling for unusual ATS formats
- Documentation updates to `business-logic-job-search.md` Section 12

**Depends on**: Phase 2
**Effort**: Small

### Phase 4: Frontend Autocomplete (Out of Scope)

**Noted for future**: Typeahead/autocomplete for location input against the same reference data. Not part of P6.1.

---

## 10. Appendix: ATS Location String Patterns

Real examples from extractor test fixtures:

| Pattern | Examples | Strategy |
|---------|----------|----------|
| City, State, Country | "San Francisco, CA, United States" | 3-part, rightmost = country |
| City, Country | "Berlin, Germany", "London, UK" | 2-part, rightmost = country |
| City, Country Code | "Berlin, DE", "Paris, FR" | 2-part, rightmost = alpha-2 |
| City, State (US) | "Austin, TX", "New York, NY" | 2-part, rightmost = state abbreviation |
| Country only | "United States", "Germany" | 1-part country lookup |
| City only | "Singapore", "London" | 1-part city lookup, disambiguate by population |
| Remote | "Remote" | isRemote, no geo constraint |
| Remote + Country | "Remote, US", "Remote, UK" | isRemote + country resolution |
| Remote + Region | "Remote - Europe", "Remote (APAC)" | isRemote + composite region |
| Multi-location | "New York or London" | Split on " or " |
| Multi-location compound | "Berlin, DE, London, UK" | Detect repeated [City, Code] pattern |
| City, Region, Country | "Berlin, Berlin, Germany" | 3-part with region dedup |
| With extras | "Campus Location, Austin, TX" | Right-to-left resolution |

---

## 11. Sources

- [GeoNames Data Export](https://www.geonames.org/export/)
- [GeoNames Readme](https://github.com/colemanm/gazetteer/blob/master/docs/geonames_readme.md)
- [GeoNames Cities 5000 Dataset](https://documentation-resources.opendatasoft.com/explore/dataset/doc-geonames-cities-5000/information/)
- [GeoNames Place Hierarchy](https://www.geonames.org/export/place-hierarchy.html)
- [ISO 3166 Country Codes](https://www.iso.org/iso-3166-country-codes.html)
- [i18n-iso-countries (npm)](https://www.npmjs.com/package/i18n-iso-countries)
- [countries-list (npm)](https://www.npmjs.com/package/countries-list)
- [countries-and-timezones (npm)](https://www.npmjs.com/package/countries-and-timezones)
- [@vvo/tzdb (npm)](https://www.npmjs.com/package/@vvo/tzdb)
- [city-timezones (npm)](https://www.npmjs.com/package/city-timezones)
- [ISO 3166 Countries with Regional Codes (GitHub)](https://github.com/lukes/ISO-3166-Countries-with-Regional-Codes)
- [Greenhouse Remote Job Posts](https://support.greenhouse.io/hc/en-us/articles/360043197972)
- [LinkedIn Location Requirements](https://support.greenhouse.io/hc/en-us/articles/206285655)
- [PostGIS vs PostgreSQL](https://risingwave.com/blog/postgis-vs-postgresql-a-comprehensive-comparison/)
- [offline-geocoder (npm)](https://www.npmjs.com/package/offline-geocoder)
- [offline-geocode-city (GitHub)](https://github.com/kyr0/offline-geocode-city)
- [List of Country Groupings (Wikipedia)](https://en.wikipedia.org/wiki/List_of_country_groupings)
