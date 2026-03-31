import type { TimezoneGroupRecord } from "./types";

/**
 * ~6 timezone group definitions covering common user expressions.
 * UTC offset ranges are in minutes.
 *
 * Per architecture Section 3.2.3, timezone abbreviation disambiguation
 * favors the more common meaning in a global job search context
 * (US-centric for CST/EST/PST, Asia-centric for JST/IST).
 */
export const TIMEZONE_GROUPS: ReadonlyArray<TimezoneGroupRecord> = [
  {
    name: "us_timezone",
    aliases: [
      "americas timezone",
      "north america timezone",
      "us timezones",
      "est",
      "cst",
      "mst",
      "pst",
    ],
    utcOffsetRange: [-600, -240], // UTC-10 to UTC-4 in minutes
    memberCountryCodes: ["US", "CA", "MX"],
  },
  {
    name: "europe_timezone",
    aliases: [
      "european timezone",
      "eu timezone",
      "cet",
      "cest",
      "gmt",
      "wet",
      "eet",
    ],
    utcOffsetRange: [-60, 180], // UTC-1 to UTC+3 in minutes
    memberCountryCodes: [
      "GB", "DE", "FR", "ES", "IT", "NL", "BE", "AT", "CH", "SE",
      "NO", "DK", "FI", "PL", "CZ", "PT", "IE", "GR", "RO", "HU",
      "BG", "HR", "SK", "SI", "LT", "LV", "EE", "LU", "MT", "CY",
      "IS",
    ],
  },
  {
    name: "asia_timezone",
    aliases: [
      "asian timezone",
      "india timezone",
      "ist",
      "jst",
      "kst",
      "cst asia",
    ],
    utcOffsetRange: [300, 540], // UTC+5 to UTC+9 in minutes
    memberCountryCodes: [
      "IN", "CN", "JP", "KR", "SG", "MY", "TH", "VN", "PH", "ID",
      "BD", "PK", "LK", "MM", "KH", "LA", "NP",
    ],
  },
  {
    name: "pacific_timezone",
    aliases: [
      "oceania timezone",
      "australia timezone",
      "aest",
      "nzst",
    ],
    utcOffsetRange: [480, 780], // UTC+8 to UTC+13 in minutes
    memberCountryCodes: ["AU", "NZ", "SG", "HK", "TW", "FJ", "PG"],
  },
  {
    name: "middle_east_timezone",
    aliases: [
      "gulf timezone",
      "ast",
    ],
    utcOffsetRange: [120, 240], // UTC+2 to UTC+4 in minutes
    memberCountryCodes: [
      "AE", "SA", "IL", "TR", "EG", "JO", "LB", "IQ", "KW", "BH",
      "QA", "OM",
    ],
  },
  {
    name: "latin_america_timezone",
    aliases: [
      "south america timezone",
      "latam timezone",
    ],
    utcOffsetRange: [-300, -180], // UTC-5 to UTC-3 in minutes
    memberCountryCodes: [
      "BR", "AR", "CL", "CO", "PE", "EC", "VE", "BO", "PY", "UY",
      "CR", "PA",
    ],
  },
];

/**
 * Reverse index: lowercase name/alias -> TimezoneGroupRecord.
 * Built from TIMEZONE_GROUPS at module load time.
 */
const TIMEZONE_REVERSE_INDEX: ReadonlyMap<
  string,
  TimezoneGroupRecord
> = (() => {
  const idx = new Map<string, TimezoneGroupRecord>();

  for (const group of TIMEZONE_GROUPS) {
    idx.set(group.name, group);
    for (const alias of group.aliases) {
      idx.set(alias, group);
    }
  }

  return idx;
})();

/**
 * Lookup a string as a timezone group. Returns the record or null.
 * Input is lowercased and trimmed before lookup.
 */
export function lookupTimezoneGroup(
  input: string,
): TimezoneGroupRecord | null {
  const normalized = input.toLowerCase().trim();
  return TIMEZONE_REVERSE_INDEX.get(normalized) ?? null;
}
