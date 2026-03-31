import type { CompositeRegionRecord } from "./types";

/**
 * ~25 composite region definitions covering formal groupings (EU, EEA, Schengen, GCC)
 * and informal groupings (DACH, Nordics, Latam, APAC, etc.).
 *
 * Member lists for formal groupings are based on official membership as of 2025.
 * Informal groupings use a deliberately broad interpretation.
 */
export const COMPOSITE_REGIONS: ReadonlyArray<CompositeRegionRecord> = [
  {
    name: "eu",
    aliases: ["european union"],
    memberCountryCodes: [
      "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
      "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
      "PL", "PT", "RO", "SK", "SI", "ES", "SE",
    ],
    isFormal: true,
  },
  {
    name: "eea",
    aliases: ["european economic area"],
    memberCountryCodes: [
      // EU members
      "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
      "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
      "PL", "PT", "RO", "SK", "SI", "ES", "SE",
      // EEA-only members
      "IS", "LI", "NO",
    ],
    isFormal: true,
  },
  {
    name: "dach",
    aliases: [],
    memberCountryCodes: ["DE", "AT", "CH"],
    isFormal: false,
  },
  {
    name: "nordics",
    aliases: ["nordic countries", "scandinavia"],
    memberCountryCodes: ["DK", "FI", "IS", "NO", "SE"],
    isFormal: false,
  },
  {
    name: "benelux",
    aliases: [],
    memberCountryCodes: ["BE", "NL", "LU"],
    isFormal: false,
  },
  {
    name: "baltics",
    aliases: ["baltic states"],
    memberCountryCodes: ["EE", "LV", "LT"],
    isFormal: false,
  },
  {
    name: "latam",
    aliases: ["latin america"],
    memberCountryCodes: [
      "AR", "BO", "BR", "CL", "CO", "CR", "CU", "DO", "EC", "SV",
      "GT", "HN", "MX", "NI", "PA", "PY", "PE", "PR", "UY", "VE",
    ],
    isFormal: false,
  },
  {
    name: "apac",
    aliases: ["asia-pacific", "asia pacific"],
    memberCountryCodes: [
      "AU", "BD", "CN", "HK", "IN", "ID", "JP", "KR", "MY", "NZ",
      "PH", "SG", "TW", "TH", "VN",
    ],
    isFormal: false,
  },
  {
    name: "mena",
    aliases: ["middle east and north africa"],
    memberCountryCodes: [
      "AE", "BH", "DZ", "EG", "IQ", "IL", "JO", "KW", "LB", "LY",
      "MA", "OM", "PS", "QA", "SA", "TN", "YE",
    ],
    isFormal: false,
  },
  {
    name: "emea",
    aliases: ["europe, middle east and africa"],
    memberCountryCodes: [
      // EU
      "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
      "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
      "PL", "PT", "RO", "SK", "SI", "ES", "SE",
      // Non-EU Europe
      "AL", "BA", "BY", "CH", "GB", "GE", "IS", "LI", "MD", "ME",
      "MK", "NO", "RS", "RU", "TR", "UA",
      // MENA
      "AE", "BH", "DZ", "EG", "IQ", "IL", "JO", "KW", "LB", "LY",
      "MA", "OM", "PS", "QA", "SA", "TN", "YE",
      // Sub-Saharan Africa (selection)
      "GH", "KE", "NG", "ZA", "TZ", "UG", "ET", "RW", "SN", "CI",
    ],
    isFormal: false,
  },
  {
    name: "amer",
    aliases: ["americas"],
    memberCountryCodes: [
      "US", "CA", "MX",
      // Latam
      "AR", "BO", "BR", "CL", "CO", "CR", "CU", "DO", "EC", "SV",
      "GT", "HN", "NI", "PA", "PY", "PE", "PR", "UY", "VE",
    ],
    isFormal: false,
  },
  {
    name: "anz",
    aliases: ["australia and new zealand"],
    memberCountryCodes: ["AU", "NZ"],
    isFormal: false,
  },
  {
    name: "sea",
    aliases: ["southeast asia"],
    memberCountryCodes: [
      "BN", "KH", "ID", "LA", "MY", "MM", "PH", "SG", "TH", "TL", "VN",
    ],
    isFormal: false,
  },
  {
    name: "gcc",
    aliases: ["gulf cooperation council"],
    memberCountryCodes: ["AE", "BH", "KW", "OM", "QA", "SA"],
    isFormal: true,
  },
  {
    name: "cee",
    aliases: ["central eastern europe", "central and eastern europe"],
    memberCountryCodes: ["CZ", "HU", "PL", "SK", "RO", "BG", "HR", "SI"],
    isFormal: false,
  },
  {
    name: "western europe",
    aliases: [],
    memberCountryCodes: ["AT", "BE", "CH", "DE", "FR", "IE", "LU", "NL", "GB"],
    isFormal: false,
  },
  {
    name: "eastern europe",
    aliases: [],
    memberCountryCodes: ["BY", "CZ", "HU", "MD", "PL", "RO", "RU", "SK", "UA"],
    isFormal: false,
  },
  {
    name: "uk & ireland",
    aliases: ["uk and ireland", "britain and ireland"],
    memberCountryCodes: ["GB", "IE"],
    isFormal: false,
  },
  {
    name: "schengen",
    aliases: ["schengen area"],
    memberCountryCodes: [
      "AT", "BE", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
      "IS", "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL",
      "PT", "SK", "SI", "ES", "SE", "CH",
    ],
    isFormal: true,
  },
  {
    name: "europe",
    aliases: [],
    memberCountryCodes: [
      "AL", "AD", "AT", "BY", "BE", "BA", "BG", "HR", "CY", "CZ",
      "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT",
      "XK", "LV", "LI", "LT", "LU", "MT", "MD", "MC", "ME", "NL",
      "MK", "NO", "PL", "PT", "RO", "RU", "SM", "RS", "SK", "SI",
      "ES", "SE", "CH", "TR", "UA", "GB", "VA",
    ],
    isFormal: false,
  },
  {
    name: "asia",
    aliases: [],
    memberCountryCodes: [
      "AF", "AM", "AZ", "BH", "BD", "BN", "BT", "KH", "CN", "CY",
      "GE", "HK", "IN", "ID", "IQ", "IR", "IL", "JP", "JO", "KZ",
      "KW", "KG", "LA", "LB", "MO", "MY", "MV", "MN", "MM", "NP",
      "KP", "OM", "PK", "PS", "PH", "QA", "SA", "SG", "KR", "LK",
      "SY", "TW", "TJ", "TH", "TL", "TM", "AE", "UZ", "VN", "YE",
    ],
    isFormal: false,
  },
  {
    name: "africa",
    aliases: [],
    memberCountryCodes: [
      "DZ", "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD",
      "KM", "CG", "CD", "CI", "DJ", "EG", "GQ", "ER", "SZ", "ET",
      "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY", "MG",
      "MW", "ML", "MR", "MU", "MA", "MZ", "NA", "NE", "NG", "RW",
      "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG",
      "TN", "UG", "ZM", "ZW",
    ],
    isFormal: false,
  },
  {
    name: "north america",
    aliases: [],
    memberCountryCodes: ["US", "CA", "MX"],
    isFormal: false,
  },
  {
    name: "south america",
    aliases: [],
    memberCountryCodes: [
      "AR", "BO", "BR", "CL", "CO", "EC", "GY", "PY", "PE", "SR",
      "UY", "VE",
    ],
    isFormal: false,
  },
  {
    name: "middle east",
    aliases: [],
    memberCountryCodes: [
      "AE", "BH", "CY", "EG", "IL", "IQ", "IR", "JO", "KW", "LB",
      "OM", "PS", "QA", "SA", "SY", "TR", "YE",
    ],
    isFormal: false,
  },
  {
    name: "oceania",
    aliases: [],
    memberCountryCodes: ["AU", "NZ", "FJ", "PG", "WS", "TO", "VU"],
    isFormal: false,
  },
];

/**
 * Reverse index: lowercase name/alias -> CompositeRegionRecord.
 * Built from COMPOSITE_REGIONS at module load time.
 */
export const REGION_REVERSE_INDEX: ReadonlyMap<
  string,
  CompositeRegionRecord
> = (() => {
  const idx = new Map<string, CompositeRegionRecord>();

  for (const region of COMPOSITE_REGIONS) {
    idx.set(region.name, region);
    for (const alias of region.aliases) {
      idx.set(alias, region);
    }
  }

  return idx;
})();

/**
 * Lookup a string as a composite region. Returns the record or null.
 * Input is lowercased and trimmed before lookup.
 */
export function lookupRegion(input: string): CompositeRegionRecord | null {
  const normalized = input.toLowerCase().trim();
  return REGION_REVERSE_INDEX.get(normalized) ?? null;
}
