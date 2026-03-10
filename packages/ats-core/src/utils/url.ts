const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid"
]);

const HASH_JOB_ROUTE_REGEX = /^#\/?(jobs?|careers?|positions?|vacanc(y|ies)|openings?)/i;

export interface CanonicalizeUrlOptions {
  base?: string;
  keepHashRoute?: boolean;
}

export function canonicalizeHttpUrl(
  input: string,
  options: CanonicalizeUrlOptions = {}
): string | null {
  try {
    const parsed = options.base ? new URL(input, options.base) : new URL(input);
    if (!/^https?:$/.test(parsed.protocol)) {
      return null;
    }
    const hash = parsed.hash;
    const keepHashRoute = (options.keepHashRoute ?? true) &&
      typeof hash === "string" &&
      hash.length > 1 &&
      HASH_JOB_ROUTE_REGEX.test(hash);
    parsed.hash = keepHashRoute ? hash : "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function normalizeUrl(input: string, base?: string): string | null {
  return canonicalizeHttpUrl(input, { base, keepHashRoute: true });
}

export function sameRegistrableHost(a: string, b: string): boolean {
  try {
    const hostA = new URL(a).hostname.replace(/^www\./i, "").toLowerCase();
    const hostB = new URL(b).hostname.replace(/^www\./i, "").toLowerCase();
    return hostA === hostB || hostA.endsWith(`.${hostB}`) || hostB.endsWith(`.${hostA}`);
  } catch {
    return false;
  }
}
