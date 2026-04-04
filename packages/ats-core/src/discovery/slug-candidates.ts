const COMMON_SUFFIXES = [
  "inc",
  "inc.",
  "llc",
  "ltd",
  "ltd.",
  "corp",
  "corp.",
  "co",
  "co.",
  "gmbh",
  "ag",
  "s.a.",
  "plc",
];

const SKIP_WORDS = new Set(["the", "a"]);

const MIN_SLUG_LENGTH = 2;

/**
 * Strip common corporate suffixes from a company name.
 * Returns the name without trailing suffix tokens (case-insensitive).
 */
function stripSuffixes(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) {
    return name.trim();
  }
  const lastWord = words[words.length - 1];
  if (!lastWord) {
    return name.trim();
  }
  if (COMMON_SUFFIXES.includes(lastWord.toLowerCase())) {
    return words.slice(0, -1).join(" ").trim();
  }
  return name.trim();
}

/**
 * Extract the primary brand word from a company name.
 * Skips common articles ("the", "a") and returns the first meaningful word.
 */
function primaryBrandWord(name: string): string | null {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) {
    return null;
  }
  for (const word of words) {
    if (!SKIP_WORDS.has(word.toLowerCase())) {
      return word.toLowerCase();
    }
  }
  return null;
}

/**
 * Generate slug candidates from a company name for ATS API probing.
 *
 * Returns unique candidates ordered from most likely to least likely.
 * Each candidate is at least 2 characters long.
 */
export function generateSlugCandidates(companyName: string): string[] {
  const trimmed = companyName.trim();
  if (!trimmed) {
    return [];
  }

  const stripped = stripSuffixes(trimmed);
  const bases = stripped !== trimmed ? [stripped, trimmed] : [trimmed];

  const seen = new Set<string>();
  const results: string[] = [];

  function add(candidate: string): void {
    if (candidate.length >= MIN_SLUG_LENGTH && !seen.has(candidate)) {
      seen.add(candidate);
      results.push(candidate);
    }
  }

  for (const base of bases) {
    // 1. Lowercase, strip all non-alphanumeric
    add(base.toLowerCase().replace(/[^a-z0-9]/g, ""));

    // 2. Lowercase, spaces/punctuation to hyphens, collapse consecutive
    add(
      base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    );

    // 3. Lowercase, remove all spaces
    add(base.toLowerCase().replace(/\s+/g, ""));

    // 4. Lowercase, spaces to underscores
    add(
      base
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, ""),
    );

    // 5. Primary brand word only (first meaningful word if multi-word)
    const brand = primaryBrandWord(base);
    if (brand) {
      add(brand);
    }

    // 6. CamelCase, remove spaces
    const camel = base
      .split(/\s+/)
      .map((w) => {
        if (w.length === 0) return "";
        return w.charAt(0).toUpperCase() + w.slice(1);
      })
      .join("");
    add(camel);
  }

  return results;
}
