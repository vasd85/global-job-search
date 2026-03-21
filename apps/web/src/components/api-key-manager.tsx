"use client";

import { useState, useEffect, useCallback } from "react";

interface ApiKeyMeta {
  id: string;
  provider: string;
  maskedHint: string | null;
  status: string;
  lastValidatedAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
}

export function ApiKeyManager() {
  const [apiKey, setApiKey] = useState<ApiKeyMeta | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const fetchKey = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/api-keys");
      const data = (await res.json()) as { apiKey: ApiKeyMeta | null };
      setApiKey(data.apiKey);
    } catch {
      setError("Failed to load API key status");
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void fetchKey();
  }, [fetchKey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "anthropic", apiKey: inputValue }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        apiKey?: ApiKeyMeta;
        validationStatus?: string;
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Failed to save API key");
        return;
      }

      setInputValue("");
      let msg = "API key saved successfully";
      if (data.validationStatus === "billing_warning") {
        msg += " (warning: billing issue detected on this key)";
      } else if (data.validationStatus === "rate_limited") {
        msg += " (key accepted — rate limited during validation, but should work)";
      }
      setSuccess(msg);
      await fetchKey();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!apiKey) return;

    setLoading(true);
    setError(null);
    setSuccess(null);
    setConfirmRevoke(false);

    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId: apiKey.id }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to revoke API key");
        return;
      }

      setSuccess("API key revoked");
      await fetchKey();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  const handleRevalidate = async () => {
    if (!apiKey) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/settings/api-keys/revalidate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId: apiKey.id }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        validation?: { valid: boolean; status: string };
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Failed to revalidate");
        return;
      }

      if (data.validation?.valid) {
        setSuccess("Key is valid");
      } else {
        const status = data.validation?.status ?? "unknown";
        setError(
          status === "invalid" || status === "forbidden"
            ? "Key is no longer valid. It may have been disabled or deleted — check your Anthropic console. You can add a new key below."
            : `Key validation failed: ${status}`,
        );
      }
      await fetchKey();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Anthropic API Key
      </h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Your API key is encrypted at rest and used for server-side LLM operations
        like job matching and scoring.
      </p>

      {/* Current key status */}
      {apiKey && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                Current key:{" "}
                <span className="font-mono text-zinc-600 dark:text-zinc-400">
                  {apiKey.maskedHint}
                </span>
              </p>
              <div className="mt-1 flex items-center gap-2">
                <StatusBadge status={apiKey.status} />
                {apiKey.lastValidatedAt && (
                  <span className="text-xs text-zinc-400">
                    Validated{" "}
                    {new Date(apiKey.lastValidatedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleRevalidate}
                disabled={loading}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Revalidate
              </button>
              {!confirmRevoke ? (
                <button
                  type="button"
                  onClick={() => setConfirmRevoke(true)}
                  disabled={loading}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                >
                  Revoke
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={loading}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  Confirm revoke
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add / replace form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <label
          htmlFor="api-key-input"
          className="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          {apiKey ? "Replace API Key" : "Add API Key"}
        </label>
        <div className="flex gap-2">
          <input
            id="api-key-input"
            type="password"
            placeholder="sk-ant-..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
          />
          <button
            type="submit"
            disabled={loading || !inputValue.trim()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {loading ? "Validating..." : apiKey ? "Replace" : "Save"}
          </button>
        </div>
      </form>

      {/* Messages */}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {success && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          {success}
        </p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
    invalid:
      "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
    revoked:
      "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  };

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] ?? styles.revoked}`}
    >
      {status}
    </span>
  );
}
