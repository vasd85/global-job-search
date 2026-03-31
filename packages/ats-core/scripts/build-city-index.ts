/**
 * Build script: download and process GeoNames cities15000.txt into city-index.generated.json.
 *
 * Usage:
 *   pnpm --filter @gjs/ats-core build:city-index
 *   npx tsx packages/ats-core/scripts/build-city-index.ts
 *
 * The script auto-downloads cities15000.zip from GeoNames, extracts it,
 * parses the tab-delimited data, and outputs a compact JSON file.
 */

import { createWriteStream, existsSync, unlinkSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const OUTPUT_PATH = join(PACKAGE_ROOT, "src", "geo", "city-index.generated.json");
const GEONAMES_URL = "https://download.geonames.org/export/dump/cities15000.zip";
const ZIP_PATH = join(PACKAGE_ROOT, "scripts", "cities15000.zip");
const TXT_PATH = join(PACKAGE_ROOT, "scripts", "cities15000.txt");

interface CityEntry {
  name: string;
  asciiName: string;
  countryCode: string;
  population: number;
  timezone: string;
  alternateNames: string[];
}

/**
 * GeoNames columns (tab-delimited, 0-indexed):
 * 0: geonameid, 1: name, 2: asciiname, 3: alternatenames,
 * 4: latitude, 5: longitude, 6: feature_class, 7: feature_code,
 * 8: country_code, 9: cc2, 10: admin1_code, 11-13: admin2-4,
 * 14: population, 15: elevation, 16: dem, 17: timezone, 18: modification_date
 */
const COL = {
  NAME: 1,
  ASCII_NAME: 2,
  ALTERNATE_NAMES: 3,
  COUNTRY_CODE: 8,
  POPULATION: 14,
  TIMEZONE: 17,
} as const;

async function downloadFile(url: string, dest: string): Promise<void> {
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error("Response body is null");
  }

  const fileStream = createWriteStream(dest);
  const reader = res.body.getReader();

  const writable = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      fileStream.write(chunk, callback);
    },
  });

  // Pipe the ReadableStream into the file
  async function pump(): Promise<void> {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await new Promise<void>((ok, fail) => {
        writable.write(value, (err) => (err ? fail(err) : ok()));
      });
    }
  }

  await pump();
  fileStream.end();
  await new Promise<void>((ok, fail) => {
    fileStream.on("finish", ok);
    fileStream.on("error", fail);
  });

  console.log(`Downloaded to ${dest}`);
}

async function unzipFile(zipPath: string, outPath: string): Promise<void> {
  console.log("Extracting zip...");

  // cities15000.zip is a standard zip file, not gzip.
  // Use the built-in decompress-raw approach via child process unzip,
  // or use the zip structure. Node's zlib only handles gzip/deflate.
  // For portability, shell out to unzip.
  const { execSync } = await import("node:child_process");
  execSync(`unzip -o "${zipPath}" -d "${dirname(outPath)}"`, {
    stdio: "pipe",
  });

  if (!existsSync(outPath)) {
    throw new Error(`Expected ${outPath} after extraction, but it does not exist`);
  }
  console.log(`Extracted to ${outPath}`);
}

/**
 * Check if a string is primarily Latin script (including accented Latin chars).
 * Filters out CJK, Cyrillic, Arabic, Devanagari, etc. which are not useful
 * for matching ATS location strings (almost always Latin script).
 */
function isLatinScript(s: string): boolean {
  // Allow Basic Latin, Latin Extended, and common punctuation/spaces.
  // Reject if more than 30% of characters are non-Latin.
  let nonLatin = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    // Basic Latin (0-7F), Latin-1 Supplement (80-FF), Latin Extended (100-24F),
    // Latin Extended Additional (1E00-1EFF), common punctuation, spaces
    const isLatin =
      cp <= 0x024f ||
      (cp >= 0x1e00 && cp <= 0x1eff) ||
      cp === 0x20 || // space
      (cp >= 0x2000 && cp <= 0x206f); // general punctuation
    if (!isLatin) nonLatin++;
  }
  return nonLatin / s.length < 0.3;
}

/**
 * Filter alternate names to useful variants:
 * - Remove empty strings
 * - Remove names that are just numbers (postal codes, IATA, ICAO codes)
 * - Remove very long names (> 80 chars, likely descriptions)
 * - Remove non-Latin script names (CJK, Cyrillic, Arabic, etc.)
 * - Deduplicate and lowercase
 * - Limit to 5 alternate names per city to keep index size manageable
 */
function filterAlternateNames(raw: string, canonicalLower: string): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  seen.add(canonicalLower); // Skip duplicates of canonical name

  const result: string[] = [];
  const parts = raw.split(",");

  for (const part of parts) {
    if (result.length >= 5) break; // Limit alternate names per city

    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > 80) continue;
    if (trimmed.length <= 2) continue; // Skip IATA/short codes
    if (/^\d+$/.test(trimmed)) continue;
    if (!isLatinScript(trimmed)) continue;

    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    result.push(lower);
  }

  return result;
}

async function parseCities(txtPath: string): Promise<CityEntry[]> {
  console.log(`Parsing ${txtPath} ...`);
  const content = await readFile(txtPath, "utf-8");
  const lines = content.split("\n");
  const cities: CityEntry[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) continue;

    const cols = line.split("\t");
    if (cols.length < 18) continue;

    const name = (cols[COL.NAME] ?? "").trim();
    const asciiName = (cols[COL.ASCII_NAME] ?? "").trim();
    const alternateNamesRaw = cols[COL.ALTERNATE_NAMES] ?? "";
    const countryCode = (cols[COL.COUNTRY_CODE] ?? "").trim().toUpperCase();
    const population = parseInt(cols[COL.POPULATION] ?? "0", 10);
    const timezone = (cols[COL.TIMEZONE] ?? "").trim();

    if (!name || !countryCode) continue;

    const nameLower = name.toLowerCase();
    const asciiLower = asciiName.toLowerCase();

    const alternateNames = filterAlternateNames(alternateNamesRaw, nameLower);

    // Also add asciiName as alternate if different from name
    if (asciiLower !== nameLower && !alternateNames.includes(asciiLower)) {
      alternateNames.unshift(asciiLower);
    }

    cities.push({
      name: nameLower,
      asciiName: asciiLower,
      countryCode,
      population: isNaN(population) ? 0 : population,
      timezone,
      alternateNames,
    });
  }

  // Sort by population descending (largest cities first for disambiguation)
  cities.sort((a, b) => b.population - a.population);

  console.log(`Parsed ${cities.length} cities`);
  return cities;
}

function cleanup(): void {
  for (const path of [ZIP_PATH, TXT_PATH]) {
    if (existsSync(path)) {
      unlinkSync(path);
      console.log(`Cleaned up ${path}`);
    }
  }
}

async function main(): Promise<void> {
  console.log("Building city index from GeoNames cities15000...\n");

  try {
    // Step 1: Download
    if (!existsSync(ZIP_PATH)) {
      await downloadFile(GEONAMES_URL, ZIP_PATH);
    } else {
      console.log(`Using cached ${ZIP_PATH}`);
    }

    // Step 2: Extract
    if (!existsSync(TXT_PATH)) {
      await unzipFile(ZIP_PATH, TXT_PATH);
    } else {
      console.log(`Using cached ${TXT_PATH}`);
    }

    // Step 3: Parse and transform
    const cities = await parseCities(TXT_PATH);

    // Step 4: Write output
    console.log(`Writing ${OUTPUT_PATH} ...`);
    await writeFile(OUTPUT_PATH, JSON.stringify(cities), "utf-8");

    const sizeKb = Math.round(
      (await readFile(OUTPUT_PATH)).byteLength / 1024,
    );
    console.log(`\nDone! Output: ${OUTPUT_PATH} (${sizeKb} KB, ${cities.length} entries)`);
  } finally {
    // Step 5: Clean up downloaded files
    cleanup();
  }
}

main().catch((err: unknown) => {
  console.error("Build failed:", err);
  cleanup();
  process.exit(1);
});
