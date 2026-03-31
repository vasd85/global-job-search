/**
 * US state abbreviation -> full name (lowercase).
 * 50 states + DC + territories (PR, GU, VI, AS, MP).
 */
export const US_STATES: ReadonlyMap<string, string> = new Map([
  // States
  ["AL", "alabama"],
  ["AK", "alaska"],
  ["AZ", "arizona"],
  ["AR", "arkansas"],
  ["CA", "california"],
  ["CO", "colorado"],
  ["CT", "connecticut"],
  ["DE", "delaware"],
  ["FL", "florida"],
  ["GA", "georgia"],
  ["HI", "hawaii"],
  ["ID", "idaho"],
  ["IL", "illinois"],
  ["IN", "indiana"],
  ["IA", "iowa"],
  ["KS", "kansas"],
  ["KY", "kentucky"],
  ["LA", "louisiana"],
  ["ME", "maine"],
  ["MD", "maryland"],
  ["MA", "massachusetts"],
  ["MI", "michigan"],
  ["MN", "minnesota"],
  ["MS", "mississippi"],
  ["MO", "missouri"],
  ["MT", "montana"],
  ["NE", "nebraska"],
  ["NV", "nevada"],
  ["NH", "new hampshire"],
  ["NJ", "new jersey"],
  ["NM", "new mexico"],
  ["NY", "new york"],
  ["NC", "north carolina"],
  ["ND", "north dakota"],
  ["OH", "ohio"],
  ["OK", "oklahoma"],
  ["OR", "oregon"],
  ["PA", "pennsylvania"],
  ["RI", "rhode island"],
  ["SC", "south carolina"],
  ["SD", "south dakota"],
  ["TN", "tennessee"],
  ["TX", "texas"],
  ["UT", "utah"],
  ["VT", "vermont"],
  ["VA", "virginia"],
  ["WA", "washington"],
  ["WV", "west virginia"],
  ["WI", "wisconsin"],
  ["WY", "wyoming"],

  // District of Columbia
  ["DC", "district of columbia"],

  // Territories
  ["PR", "puerto rico"],
  ["GU", "guam"],
  ["VI", "us virgin islands"],
  ["AS", "american samoa"],
  ["MP", "northern mariana islands"],
]);

/**
 * Canadian province/territory abbreviation -> full name (lowercase).
 * 10 provinces + 3 territories.
 */
export const CA_PROVINCES: ReadonlyMap<string, string> = new Map([
  // Provinces
  ["AB", "alberta"],
  ["BC", "british columbia"],
  ["MB", "manitoba"],
  ["NB", "new brunswick"],
  ["NL", "newfoundland and labrador"],
  ["NS", "nova scotia"],
  ["ON", "ontario"],
  ["PE", "prince edward island"],
  ["QC", "quebec"],
  ["SK", "saskatchewan"],

  // Territories
  ["NT", "northwest territories"],
  ["NU", "nunavut"],
  ["YT", "yukon"],
]);

/** Check if a 2-letter code is a US state abbreviation (case-insensitive). */
export function isUsState(code: string): boolean {
  return US_STATES.has(code.toUpperCase());
}

/** Check if a 2-letter code is a Canadian province abbreviation (case-insensitive). */
export function isCanadianProvince(code: string): boolean {
  return CA_PROVINCES.has(code.toUpperCase());
}
