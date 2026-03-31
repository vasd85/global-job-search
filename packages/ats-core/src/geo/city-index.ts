import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CityIndexEntry } from "./types";

// Lazy-loaded: null until first access
let cityEntries: CityIndexEntry[] | null = null;
let cityNameIndex: Map<string, CityIndexEntry[]> | null = null;

/**
 * Load the city data from the generated JSON file.
 * Uses readFileSync + import.meta.url for ESM compatibility.
 */
function loadCityData(): CityIndexEntry[] {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(
    join(__dirname, "city-index.generated.json"),
    "utf-8",
  );
  return JSON.parse(raw) as CityIndexEntry[];
}

/**
 * Build reverse index: lowercase name/asciiName/alternateName -> CityIndexEntry[].
 * Multiple cities can share the same name (e.g., "portland" in US and UK).
 * Entries within each name bucket are already sorted by population descending
 * (from the build script).
 */
function buildNameIndex(
  entries: CityIndexEntry[],
): Map<string, CityIndexEntry[]> {
  const idx = new Map<string, CityIndexEntry[]>();

  function addToIndex(key: string, entry: CityIndexEntry): void {
    const existing = idx.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      idx.set(key, [entry]);
    }
  }

  for (const entry of entries) {
    addToIndex(entry.name, entry);

    // Add asciiName if different from name
    if (entry.asciiName !== entry.name) {
      addToIndex(entry.asciiName, entry);
    }

    // Add alternate names
    for (const alt of entry.alternateNames) {
      addToIndex(alt, entry);
    }
  }

  return idx;
}

/** Load and index the city data. Called lazily on first lookup. */
function ensureLoaded(): void {
  if (cityEntries !== null) return;
  cityEntries = loadCityData();
  cityNameIndex = buildNameIndex(cityEntries);
}

/**
 * Lookup a city by name. Returns the best matching entry (highest population).
 * Optionally filter by country code for disambiguation.
 *
 * @param name - City name to search for (case-insensitive)
 * @param countryCode - Optional ISO alpha-2 country code to narrow results
 * @returns The matching city entry, or null if not found
 */
export function lookupCity(
  name: string,
  countryCode?: string,
): CityIndexEntry | null {
  ensureLoaded();

  const key = name.toLowerCase().trim();
  const matches = cityNameIndex?.get(key);
  if (!matches || matches.length === 0) return null;

  if (countryCode) {
    const upper = countryCode.toUpperCase();
    const filtered = matches.filter((m) => m.countryCode === upper);
    // Return country-filtered match if found, otherwise fall back to
    // the highest-population match across all countries
    if (filtered.length > 0) return filtered[0];
  }

  // Return highest population match (already sorted by build script)
  return matches[0];
}

/**
 * Lookup a city with a required country constraint.
 * Only returns a match if the city exists in the given country.
 *
 * @param name - City name to search for (case-insensitive)
 * @param countryCode - ISO alpha-2 country code (required)
 * @returns The matching city entry in that country, or null
 */
export function lookupCityInCountry(
  name: string,
  countryCode: string,
): CityIndexEntry | null {
  ensureLoaded();

  const key = name.toLowerCase().trim();
  const matches = cityNameIndex?.get(key);
  if (!matches || matches.length === 0) return null;

  const upper = countryCode.toUpperCase();
  const filtered = matches.filter((m) => m.countryCode === upper);
  return filtered.length > 0 ? filtered[0] : null;
}
