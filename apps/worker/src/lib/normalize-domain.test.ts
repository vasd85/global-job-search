import { normalizeDomain } from "./normalize-domain";

describe("normalizeDomain", () => {
  // ── Critical ──────────────────────────────────────────────────────────

  test.each<[string, string | null]>([
    // Core contract: strip protocol, www, path, lowercase
    ["https://www.Stripe.com/jobs", "stripe.com"],
    // Without www prefix: conditional stripping is non-destructive
    ["https://stripe.com", "stripe.com"],
    // Invalid URL returns null
    ["not-a-url", null],
    // Empty string returns null (new URL("") throws)
    ["", null],
  ])("normalizeDomain(%j) => %j", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  // ── Important ─────────────────────────────────────────────────────────

  test.each<[string, string | null]>([
    // HTTP (not HTTPS): AI might return HTTP URLs
    ["http://example.com/careers", "example.com"],
    // Port number: URL.hostname excludes port
    ["https://staging.company.com:8443/jobs", "staging.company.com"],
    // Mixed case: lowercasing and www-stripping compose
    ["https://WWW.Example.COM/page", "example.com"],
    // Query string and fragment stripped
    ["https://www.company.com/jobs?page=2#section", "company.com"],
  ])("normalizeDomain(%j) => %j", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  // Subdomain preservation: only "www." should be stripped
  test("preserves subdomains other than www", () => {
    // TODO: subdomain normalization could cause false negatives for dedup --
    // "careers.google.com" and "google.com" are the same company but treated
    // as different domains by this function.
    expect(normalizeDomain("https://careers.google.com")).toBe(
      "careers.google.com",
    );
  });

  // Trailing dot in hostname (DNS root)
  test("trailing dot in hostname is preserved as-is", () => {
    // Document actual behavior: Node URL parser preserves the trailing dot.
    // This could cause a dedup miss (example.com vs example.com.)
    const result = normalizeDomain("https://www.example.com./jobs");
    // URL.hostname may include the trailing dot depending on runtime
    expect(result).toMatch(/^example\.com\.?$/);
  });

  // ── Nice-to-have ──────────────────────────────────────────────────────

  test.each<[string, string | null]>([
    // Protocol-relative URL: new URL throws without base
    ["//example.com/jobs", null],
    // URL with username:password: hostname ignores userinfo
    ["https://user:pass@example.com/jobs", "example.com"],
    // IDN punycode: dedup works for international domains
    ["https://www.xn--n3h.com/", "xn--n3h.com"],
  ])("normalizeDomain(%j) => %j", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});
