/** Shape matching the role_families table columns used for classification. */
export interface RoleFamilyDef {
  slug: string;
  strongMatch: string[];
  moderateMatch: string[];
  departmentBoost: string[];
  departmentExclude: string[];
}

export interface ClassificationInput {
  title: string;
  departmentRaw: string | null;
}

export interface ClassificationResult {
  familySlug: string;
  score: number;
  matchType: "strong" | "moderate" | "department_only" | "none";
  matchedPattern: string | null;
}

/**
 * Seniority prefixes stripped from the beginning of job titles.
 * Ordered longest-first so "vice president of" is tried before "vp of", etc.
 */
const SENIORITY_PREFIXES = [
  "vice president of",
  "director of",
  "mid-level",
  "mid level",
  "principal",
  "associate",
  "head of",
  "vp of",
  "senior",
  "staff",
  "chief",
  "lead",
  "jr.",
  "sr.",
  "jr ",
  "sr ",
  "intern ",
  "junior",
];

/**
 * Normalize a job title for pattern matching:
 * - Lowercase
 * - Strip seniority prefixes iteratively from the start
 * - Collapse whitespace and trim
 */
export function normalizeTitle(title: string): string {
  let normalized = title.toLowerCase().trim();

  // Iteratively strip seniority prefixes from the beginning of the title.
  // Loop handles stacked prefixes like "Senior Staff Engineer".
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of SENIORITY_PREFIXES) {
      if (normalized.startsWith(prefix)) {
        normalized = normalized.slice(prefix.length).trimStart();
        changed = true;
        break; // restart from the longest prefix after each strip
      }
    }
  }

  // Collapse internal whitespace
  return normalized.replace(/\s+/g, " ").trim();
}

/**
 * Classify a single job against a single role family.
 *
 * Algorithm:
 * 1. Normalize title, check strong patterns (score 1.0), then moderate (0.7).
 * 2. Department exclude overrides everything to 0.
 * 3. Department boost adds 0.2 (only when base score > 0), capped at 1.0.
 */
export function classifyJob(
  family: RoleFamilyDef,
  input: ClassificationInput,
): ClassificationResult {
  const normalizedTitle = normalizeTitle(input.title);
  const departmentLower = input.departmentRaw?.toLowerCase() ?? null;

  // Check department exclude first -- absolute override
  if (departmentLower) {
    for (const pattern of family.departmentExclude) {
      if (departmentLower.includes(pattern)) {
        return {
          familySlug: family.slug,
          score: 0,
          matchType: "none",
          matchedPattern: null,
        };
      }
    }
  }

  // Strong match check
  let baseScore = 0;
  let matchType: ClassificationResult["matchType"] = "none";
  let matchedPattern: string | null = null;

  for (const pattern of family.strongMatch) {
    if (normalizedTitle.includes(pattern)) {
      baseScore = 1.0;
      matchType = "strong";
      matchedPattern = pattern;
      break; // early return on first strong match
    }
  }

  // Moderate match check (only if no strong match)
  if (baseScore === 0) {
    for (const pattern of family.moderateMatch) {
      if (normalizedTitle.includes(pattern)) {
        baseScore = 0.7;
        matchType = "moderate";
        matchedPattern = pattern;
        break;
      }
    }
  }

  // Department boost: only applies when there is a base score > 0
  if (baseScore > 0 && departmentLower) {
    for (const pattern of family.departmentBoost) {
      if (departmentLower.includes(pattern)) {
        baseScore = Math.min(baseScore + 0.2, 1.0);
        break;
      }
    }
  }

  return {
    familySlug: family.slug,
    score: baseScore,
    matchType,
    matchedPattern,
  };
}

const EMPTY_RESULT: ClassificationResult = {
  familySlug: "",
  score: 0,
  matchType: "none",
  matchedPattern: null,
};

/**
 * Classify a job against multiple role families (user's 1-3 selections).
 * Returns the highest-scoring result across all families.
 */
export function classifyJobMulti(
  families: RoleFamilyDef[],
  input: ClassificationInput,
): ClassificationResult {
  if (families.length === 0) {
    return { ...EMPTY_RESULT };
  }

  let best: ClassificationResult = { ...EMPTY_RESULT };

  for (const family of families) {
    const result = classifyJob(family, input);
    if (result.score > best.score) {
      best = result;
    }
  }

  return best;
}
