import type { ParsedJobLocation } from "./types";

/**
 * LRU cache for ParsedJobLocation results.
 * Keyed by lowercase locationRaw string.
 *
 * Implementation: Map-based LRU. On get(), delete + re-insert to move to end.
 * On set(), if at capacity, delete the first entry (oldest / least-recently-used).
 */
export class LocationCache {
  private cache: Map<string, ParsedJobLocation[]>;
  private readonly maxSize: number;

  constructor(maxSize: number = 10_000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: string): ParsedJobLocation[] | undefined {
    const value = this.cache.get(key);
    if (value === undefined) return undefined;

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  set(key: string, value: ParsedJobLocation[]): void {
    // If key already exists, delete first so re-insert moves to end
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict the least recently used entry (first key in Map)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * Module-level singleton cache instance.
 * Shared across all search requests in the same process.
 */
export const locationCache = new LocationCache();
