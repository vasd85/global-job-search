interface MessageBubbleProps {
  role: "user" | "assistant" | string;
  content: string;
}

/**
 * Stateless display component for individual chat messages.
 * User messages: right-aligned with user styling.
 * Assistant messages: left-aligned with assistant styling.
 * Supports basic markdown-like formatting: paragraphs, lists, bold.
 */
export function MessageBubble({ role, content }: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <AssistantContent content={content} />
        )}
      </div>
    </div>
  );
}

/** Render assistant messages with basic markdown-like formatting. */
function AssistantContent({ content }: { content: string }) {
  const paragraphs = content.split(/\n\n+/);

  return (
    <div className="space-y-2">
      {paragraphs.map((paragraph, i) => {
        const trimmed = paragraph.trim();
        if (!trimmed) return null;

        // Check if this paragraph is a list (lines starting with - or *)
        const lines = trimmed.split("\n");
        const isList = lines.every(
          (line) =>
            line.trim().startsWith("- ") || line.trim().startsWith("* "),
        );

        if (isList) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-4">
              {lines.map((line, j) => (
                <li key={j}>
                  <InlineFormatting
                    text={line.trim().replace(/^[-*]\s+/, "")}
                  />
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={i} className="whitespace-pre-wrap">
            <InlineFormatting text={trimmed} />
          </p>
        );
      })}
    </div>
  );
}

/** Render inline bold formatting (**text** -> <strong>). */
function InlineFormatting({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold">
              {part.slice(2, -2)}
            </strong>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
