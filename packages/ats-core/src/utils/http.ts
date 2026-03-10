import type { Diagnostics, FetchContext } from "../types";

export interface FetchResult {
  ok: boolean;
  status: number | null;
  url: string;
  body: string | null;
  contentType: string | null;
  error: string | null;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export function addAttempt(diagnostics: Diagnostics, url: string): void {
  diagnostics.attempted_urls.push(url);
  diagnostics.attempts += 1;
}

function recordReachable(diagnostics: Diagnostics | undefined, url: string, status: number): void {
  if (!diagnostics) {
    return;
  }
  if (status >= 200 && status < 400) {
    diagnostics.last_reachable_url = url;
  }
}

function recordStatus(diagnostics: Diagnostics | undefined, status: number | null): void {
  if (!diagnostics || status === null) {
    return;
  }
  diagnostics.http_status = String(status);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export async function fetchText(url: string, context: FetchContext): Promise<FetchResult> {
  const retries = Math.max(0, context.maxRetries);
  const timeout = Math.max(1_000, context.timeoutMs);
  const diagnostics = context.diagnostics;
  const userAgent = context.userAgent ?? DEFAULT_USER_AGENT;
  const maxAttempts = context.maxAttempts && context.maxAttempts > 0 ? context.maxAttempts : null;

  let lastError: string | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (maxAttempts !== null && diagnostics && diagnostics.attempts >= maxAttempts) {
      return {
        ok: false,
        status: null,
        url,
        body: null,
        contentType: null,
        error: `attempt budget exceeded (${maxAttempts})`
      };
    }
    if (diagnostics) {
      addAttempt(diagnostics, url);
    }

    try {
      const response = await withTimeout(
        fetch(url, {
          redirect: "follow",
          headers: {
            "user-agent": userAgent,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
          }
        }),
        timeout
      );
      const text = await withTimeout(response.text(), timeout);
      const finalUrl = response.url || url;
      const contentType = response.headers.get("content-type");

      recordStatus(diagnostics, response.status);
      recordReachable(diagnostics, finalUrl, response.status);

      return {
        ok: response.ok,
        status: response.status,
        url: finalUrl,
        body: text,
        contentType,
        error: null
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = message;
      if (diagnostics && /timeout/i.test(message)) {
        diagnostics.errors.push(`Timeout while fetching ${url}: ${message}`);
      }
      if (attempt < retries) {
        await delay(1_000 * (attempt + 1));
      }
    }
  }

  return {
    ok: false,
    status: null,
    url,
    body: null,
    contentType: null,
    error: lastError ?? "unknown_fetch_error"
  };
}
