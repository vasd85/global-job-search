/**
 * Normalize a URL to its bare domain for deduplication.
 *
 * Strips protocol, leading "www.", trailing path/query/hash, and lowercases.
 * Returns null for invalid URLs.
 *
 * @example normalizeDomain("https://www.Stripe.com/jobs") => "stripe.com"
 */
export function normalizeDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }
    return hostname || null;
  } catch {
    return null;
  }
}
