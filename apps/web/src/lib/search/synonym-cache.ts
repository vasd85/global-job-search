import { db } from "@/lib/db";
import { synonymGroup } from "@/lib/db/schema";
import { expandTerms as expand, type SynonymGroup } from "@gjs/ats-core";

let cache: Map<string, SynonymGroup[]> | null = null;

/** Load all synonym groups from the DB, keyed by dimension. Cached in-memory. */
async function loadGroups(): Promise<Map<string, SynonymGroup[]>> {
  if (cache) return cache;

  const rows = await db.select().from(synonymGroup);
  cache = new Map<string, SynonymGroup[]>();

  for (const row of rows) {
    const dim = row.dimension;
    if (!cache.has(dim)) cache.set(dim, []);
    cache.get(dim)!.push({
      canonical: row.canonical,
      synonyms: row.synonyms,
      umbrellaKey: row.umbrellaKey,
    });
  }

  return cache;
}

/** Expand terms for a given dimension (e.g., "industry") via synonym DB. */
export async function expandTerms(
  dimension: string,
  terms: string[],
): Promise<string[]> {
  const groups = await loadGroups();
  return expand(groups.get(dimension) ?? [], terms);
}

/** Invalidate the in-memory cache (call after synonym_group updates). */
export function invalidateSynonymCache(): void {
  cache = null;
}
