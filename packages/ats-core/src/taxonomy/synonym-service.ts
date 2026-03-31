/** Shape of a loaded synonym group row (DB-agnostic). */
export interface SynonymGroup {
  canonical: string;
  synonyms: string[];
  umbrellaKey: string | null;
}

/**
 * Build a reverse lookup from lowercased synonym to its SynonymGroup.
 *
 * When a synonym appears in multiple groups (should not happen in
 * well-formed data), the first group wins -- consistent with the DB
 * UNIQUE constraint on (dimension, canonical).
 */
function buildReverseLookup(
  groups: SynonymGroup[],
): Map<string, SynonymGroup> {
  const map = new Map<string, SynonymGroup>();
  for (const group of groups) {
    for (const synonym of group.synonyms) {
      const key = synonym.toLowerCase();
      if (!map.has(key)) {
        map.set(key, group);
      }
    }
  }
  return map;
}

/**
 * Build an index from umbrella key to all groups sharing that key.
 */
function buildUmbrellaIndex(
  groups: SynonymGroup[],
): Map<string, SynonymGroup[]> {
  const map = new Map<string, SynonymGroup[]>();
  for (const group of groups) {
    if (group.umbrellaKey === null) continue;
    const key = group.umbrellaKey.toLowerCase();
    const list = map.get(key);
    if (list) {
      list.push(group);
    } else {
      map.set(key, [group]);
    }
  }
  return map;
}

/**
 * Given loaded synonym groups for a dimension, expand user terms to include
 * all synonyms from matching groups plus umbrella-linked groups.
 *
 * - Case insensitive (all inputs lowercased before lookup)
 * - Unknown terms pass through unchanged
 * - Output is deduplicated
 * - Empty input returns empty output
 */
export function expandTerms(
  groups: SynonymGroup[],
  terms: string[],
): string[] {
  if (terms.length === 0) return [];

  const reverseLookup = buildReverseLookup(groups);
  const umbrellaIndex = buildUmbrellaIndex(groups);
  const seen = new Set<string>();
  const result: string[] = [];

  const addTerm = (term: string): void => {
    const lower = term.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    result.push(lower);
  };

  for (const term of terms) {
    const key = term.toLowerCase();
    const group = reverseLookup.get(key);

    if (!group) {
      // Unknown term -- pass through unchanged (lowercased)
      addTerm(key);
      continue;
    }

    // Add all synonyms from the matched group
    for (const synonym of group.synonyms) {
      addTerm(synonym);
    }

    // If the group has an umbrella key, collect synonyms from all
    // groups sharing that umbrella key
    if (group.umbrellaKey !== null) {
      const umbrellaGroups =
        umbrellaIndex.get(group.umbrellaKey.toLowerCase()) ?? [];
      for (const umbrellaGroup of umbrellaGroups) {
        for (const synonym of umbrellaGroup.synonyms) {
          addTerm(synonym);
        }
      }
    }
  }

  return result;
}

/**
 * Given loaded synonym groups, return the canonical form of a term.
 * Returns the term itself (lowercased) if not found in any group.
 */
export function canonicalize(
  groups: SynonymGroup[],
  term: string,
): string {
  const reverseLookup = buildReverseLookup(groups);
  const key = term.toLowerCase();
  const group = reverseLookup.get(key);
  return group ? group.canonical : key;
}
