import type { Diagnostics } from "../types";
import { fetchText } from "../utils/http";

export async function fetchJson<T>(
  url: string,
  diagnostics: Diagnostics,
  timeoutMs: number,
  maxRetries: number,
  maxAttempts?: number
): Promise<{ data: T | null; error: string | null }> {
  const response = await fetchText(url, {
    timeoutMs,
    maxRetries,
    maxAttempts,
    diagnostics
  });
  if (!response.ok || !response.body) {
    const reason =
      response.error ??
      (response.status ? `non-200 response: ${response.status}` : "unknown fetch failure");
    return { data: null, error: reason };
  }
  try {
    return { data: JSON.parse(response.body) as T, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? `invalid json: ${error.message}` : "invalid json"
    };
  }
}
