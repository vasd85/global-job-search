import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth-session";
import { db } from "@/lib/db";
import { userProfiles } from "@/lib/db/schema";
import { ChatInterface } from "@/components/chatbot/chat-interface";

export default async function OnboardingPage() {
  const session = await requireSession();

  // Check if user has already completed preferences
  const existing = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.userId, session.user.id))
    .limit(1);

  const hasCompletedPreferences = existing.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {hasCompletedPreferences
              ? "Edit Preferences"
              : "Set Up Your Job Preferences"}
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {hasCompletedPreferences
              ? "Review and update your job and company preferences."
              : "Tell us what you are looking for and we will match jobs to your preferences."}
          </p>
        </div>
      </header>

      {/* Chat area */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        <ChatInterface editMode={hasCompletedPreferences} />
      </main>
    </div>
  );
}
