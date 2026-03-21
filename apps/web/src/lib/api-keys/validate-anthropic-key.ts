export interface ValidationResult {
  valid: boolean;
  status: "active" | "invalid" | "billing_warning" | "forbidden" | "rate_limited";
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Validate an Anthropic API key by calling GET /v1/models.
 * Never logs the API key.
 */
export async function validateAnthropicKey(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(10_000),
    });

    switch (response.status) {
      case 200:
        return { valid: true, status: "active" };
      case 401: {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        const msg = body?.error?.message ?? "Invalid API key";
        return { valid: false, status: "invalid", errorCode: "401", errorMessage: msg };
      }
      case 402:
        return { valid: true, status: "billing_warning", errorCode: "402", errorMessage: "Billing issue on this API key" };
      case 403: {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        const msg = body?.error?.message ?? "Permission denied";
        return { valid: false, status: "forbidden", errorCode: "403", errorMessage: msg };
      }
      case 429:
        return { valid: true, status: "rate_limited", errorCode: "429" };
      default:
        return { valid: false, status: "invalid", errorCode: String(response.status) };
    }
  } catch (error) {
    return {
      valid: false,
      status: "invalid",
      errorMessage: error instanceof Error ? error.message : "Network error",
    };
  }
}
