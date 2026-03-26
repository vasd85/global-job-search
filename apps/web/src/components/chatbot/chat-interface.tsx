"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type {
  PreferencesDraft,
  StructuredControlConfig,
} from "@/lib/chatbot/schemas";
import { MessageBubble } from "./message-bubble";
import { StructuredControls } from "./structured-controls";
import { SummaryReview } from "./summary-review";

// ─── Types ──────────────────────────────────────────────────────────────────

interface TranscriptMessage {
  role: string;
  content: string;
  createdAt: string;
}

interface ConversationStateSummary {
  currentStepIndex: number;
  currentStep: string;
  status: string;
  completedSteps: string[];
  draft: PreferencesDraft;
}

interface ChatResponse {
  assistantMessage: string;
  state: ConversationStateSummary;
  structuredControls: StructuredControlConfig | null;
  transcript: TranscriptMessage[];
}

interface StateResponse {
  state: ConversationStateSummary;
  transcript: TranscriptMessage[];
  structuredControls: StructuredControlConfig | null;
  initialMessage?: string;
  isNew: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Steps that can be skipped via the Skip button. */
const SKIPPABLE_STEPS = new Set([
  "growth_skills",
  "avoid_skills",
  "deal_breakers",
  "salary",
  "company_stages",
  "work_format",
  "hq_geographies",
  "product_types",
  "exclusions",
  "dimension_weights",
]);

/**
 * Steps that need free-text input (not purely structured).
 * Used to determine whether to show the text input.
 */
const FREE_TEXT_STEPS = new Set([
  "target_roles",
  "core_skills",
  "growth_skills",
  "avoid_skills",
  "deal_breakers",
  "location",
  "industries",
  "hq_geographies",
  "product_types",
  "exclusions",
]);

// ─── Component ──────────────────────────────────────────────────────────────

interface ChatInterfaceProps {
  /** If true, show in edit mode (returning user with completed preferences). */
  editMode?: boolean;
}

export function ChatInterface({ editMode = false }: ChatInterfaceProps) {
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [conversationState, setConversationState] =
    useState<ConversationStateSummary | null>(null);
  const [structuredControls, setStructuredControls] =
    useState<StructuredControlConfig | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to newest message
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [transcript, scrollToBottom]);

  // Fetch initial state on mount
  useEffect(() => {
    const fetchState = async () => {
      try {
        const res = await fetch("/api/chatbot/state");
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          setError(data.error ?? "Failed to load conversation state");
          return;
        }

        const data = (await res.json()) as StateResponse;
        setConversationState(data.state);
        setStructuredControls(data.structuredControls);

        if (data.isNew && data.initialMessage) {
          // New conversation -- show the initial greeting message locally
          setTranscript([
            {
              role: "assistant",
              content: data.initialMessage,
              createdAt: new Date().toISOString(),
            },
          ]);
        } else {
          setTranscript(data.transcript);
        }
      } catch {
        setError("Failed to connect. Please refresh the page.");
      } finally {
        setInitializing(false);
      }
    };

    void fetchState();
  }, []);

  /** Send a message to the chatbot API. */
  const sendMessage = async (message: string, displayText?: string) => {
    if (!message.trim() && message !== "__SKIP__") return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chatbot/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, displayText }),
      });

      const data = (await res.json()) as ChatResponse & { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Failed to process message");
        return;
      }

      setConversationState(data.state);
      setTranscript(data.transcript);
      setStructuredControls(data.structuredControls);
      setInputValue("");
    } catch {
      setError("Network error -- please try again");
    } finally {
      setLoading(false);
    }
  };

  /** Handle text form submission. */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendMessage(inputValue);
  };

  /** Handle keyboard shortcuts in textarea: Enter to submit, Shift+Enter for newline. */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim() && !loading) {
        void sendMessage(inputValue);
      }
    }
  };

  /** Handle skip button. */
  const handleSkip = async () => {
    await sendMessage("__SKIP__");
  };

  /** Handle structured control submission. */
  const handleStructuredSubmit = async (value: string, displayText: string) => {
    await sendMessage(value, displayText);
  };

  /** Handle edit from summary review -- send a goToStep message. */
  const handleEdit = async (stepSlug: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/chatbot/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `__EDIT__:${stepSlug}` }),
      });

      const data = (await res.json()) as ChatResponse & { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Failed to navigate to step");
        return;
      }

      setConversationState(data.state);
      setTranscript(data.transcript);
      setStructuredControls(data.structuredControls);
    } catch {
      setError("Network error -- please try again");
    } finally {
      setLoading(false);
    }
  };

  /** Handle save from summary review. */
  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch("/api/chatbot/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        missingSteps?: string[];
      };

      if (!res.ok) {
        const msg = data.missingSteps
          ? `Missing required steps: ${data.missingSteps.join(", ")}`
          : (data.error ?? "Failed to save preferences");
        setSaveError(msg);
        return;
      }

      setSaved(true);
    } catch {
      setSaveError("Network error -- please try again");
    } finally {
      setSaving(false);
    }
  };

  // Loading state
  if (initializing) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-zinc-400 border-t-transparent" />
      </div>
    );
  }

  // Saved state
  if (saved) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950">
        <h3 className="text-lg font-semibold text-emerald-800 dark:text-emerald-200">
          Preferences Saved
        </h3>
        <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
          Your job and company preferences have been saved. The system will
          use these to match and score jobs for you.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700"
        >
          Go to Job Search
        </Link>
      </div>
    );
  }

  const currentStep = conversationState?.currentStep ?? "";
  const isReview =
    conversationState?.status === "review" || editMode;
  const isSkippable = SKIPPABLE_STEPS.has(currentStep);
  const showTextInput = FREE_TEXT_STEPS.has(currentStep) && !isReview;

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {transcript.map((msg, i) => (
          <MessageBubble key={i} role={msg.role} content={msg.content} />
        ))}

        {/* Loading indicator */}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:0ms]" />
                <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:150ms]" />
                <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Controls area */}
      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        {/* Review mode */}
        {isReview && conversationState && (
          <SummaryReview
            draft={conversationState.draft}
            onEdit={handleEdit}
            onSave={handleSave}
            saving={saving}
            error={saveError}
          />
        )}

        {/* Structured controls for non-review steps */}
        {!isReview && structuredControls && (
          <div className="mb-3">
            <StructuredControls
              config={structuredControls}
              currentStepSlug={currentStep}
              onSubmit={handleStructuredSubmit}
              disabled={loading}
            />
          </div>
        )}

        {/* Text input for free-text / hybrid steps */}
        {showTextInput && !isReview && (
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              placeholder="Type your answer... (Shift+Enter for new line)"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                // Auto-resize: reset to auto then set to scrollHeight, clamped to 15 lines
                const el = e.target;
                el.style.height = "auto";
                const lineHeight = parseInt(getComputedStyle(el).lineHeight || "20", 10);
                const maxHeight = lineHeight * 15;
                el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
                // Scroll messages so the input stays visible
                scrollToBottom();
              }}
              onKeyDown={handleKeyDown}
              disabled={loading}
              rows={2}
              className="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
            />
            <button
              type="submit"
              disabled={loading || !inputValue.trim()}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Send
            </button>
          </form>
        )}

        {/* Skip button for skippable steps */}
        {!isReview && isSkippable && (
          <button
            type="button"
            onClick={handleSkip}
            disabled={loading}
            className="mt-2 text-sm text-zinc-500 underline transition-colors hover:text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Skip this step
          </button>
        )}
      </div>
    </div>
  );
}
