import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { APICallError } from "ai";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversationStates, conversationMessages } from "@/lib/db/schema";
import { MessageInputSchema } from "@/lib/chatbot/schemas";
import { STEPS } from "@/lib/chatbot/steps";
import {
  deserializeState,
  serializeState,
  goToStep,
} from "@/lib/chatbot/state";
import {
  processMessage,
  initializeConversation,
  EngineError,
} from "@/lib/chatbot/engine";
import type { EngineMessage } from "@/lib/chatbot/engine";
import { getUserAnthropicKey } from "@/lib/api-keys/get-user-key";
import { createPreferenceLlm } from "@/lib/llm/preference-llm";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = MessageInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    // Load or create conversation state
    const existing = await db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.userId, session.user.id))
      .limit(1);

    let conversationStateId: string;
    let state;

    if (existing.length > 0 && existing[0]) {
      conversationStateId = existing[0].id;
      state = deserializeState(existing[0].state);
    } else {
      // Initialize new conversation
      const init = initializeConversation();
      state = init.state;

      const [inserted] = await db
        .insert(conversationStates)
        .values({
          userId: session.user.id,
          state: serializeState(state),
        })
        .returning({ id: conversationStates.id });

      if (!inserted) {
        return NextResponse.json(
          { error: "Failed to create conversation state" },
          { status: 500 },
        );
      }
      conversationStateId = inserted.id;

      // Save the initial assistant message
      await db.insert(conversationMessages).values({
        conversationStateId,
        role: "assistant",
        content: init.assistantMessage,
      });
    }

    // Check if conversation is already completed
    if (
      state.status === "completed" &&
      !parsed.data.message.startsWith("__EDIT__:")
    ) {
      return NextResponse.json(
        { error: "Conversation already completed. Use the review page to edit preferences." },
        { status: 400 },
      );
    }

    // Handle edit navigation: __EDIT__:<stepSlug>
    if (parsed.data.message.startsWith("__EDIT__:")) {
      const stepSlug = parsed.data.message.slice("__EDIT__:".length);
      const updatedState = goToStep(state, stepSlug);

      if (updatedState === state) {
        return NextResponse.json(
          { error: `Unknown step: ${stepSlug}` },
          { status: 400 },
        );
      }

      // Save updated state
      await db
        .update(conversationStates)
        .set({
          state: serializeState(updatedState),
          updatedAt: new Date(),
        })
        .where(eq(conversationStates.userId, session.user.id));

      // Add system message about editing
      const editStep = STEPS[updatedState.currentStepIndex];
      const editMessage = editStep
        ? `Editing: ${editStep.question}`
        : "Navigating to step for editing.";

      await db.insert(conversationMessages).values({
        conversationStateId,
        role: "assistant",
        content: editMessage,
      });

      // Load full transcript
      const transcript = await db
        .select({
          role: conversationMessages.role,
          content: conversationMessages.content,
          createdAt: conversationMessages.createdAt,
        })
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationStateId, conversationStateId))
        .orderBy(conversationMessages.createdAt);

      // Determine structured controls for the target step
      let editControls = null;
      if (
        editStep &&
        editStep.inputType !== "free_text" &&
        editStep.structuredConfig
      ) {
        editControls = editStep.structuredConfig;
      }

      return NextResponse.json({
        assistantMessage: editMessage,
        state: {
          currentStepIndex: updatedState.currentStepIndex,
          currentStep: editStep?.slug ?? "review",
          status: updatedState.status,
          completedSteps: updatedState.completedSteps,
          draft: updatedState.draft,
        },
        structuredControls: editControls,
        transcript,
      });
    }

    // Get user's decrypted API key (only needed for free-text/hybrid steps)
    const currentStep = STEPS[state.currentStepIndex];
    let apiKey: string | null = null;

    if (currentStep && currentStep.inputType !== "structured") {
      // Only fetch key when needed -- structured steps and skip don't need it
      const isSkipMessage = parsed.data.message === "__SKIP__";
      if (!isSkipMessage) {
        apiKey = await getUserAnthropicKey(session.user.id);
        if (!apiKey) {
          return NextResponse.json(
            {
              error:
                "Anthropic API key required for this step. Add one in Settings.",
            },
            { status: 422 },
          );
        }
      }
    }

    // Create LLM instance if we have a key
    const llm = apiKey ? createPreferenceLlm(apiKey) : null;

    // Process message through the engine
    const result = await processMessage(state, parsed.data.message, llm);

    // Save updated state to DB
    await db
      .update(conversationStates)
      .set({
        state: serializeState(result.updatedState),
        updatedAt: new Date(),
      })
      .where(eq(conversationStates.userId, session.user.id));

    // Save messages to conversation_messages table
    await persistMessages(conversationStateId, result.messages);

    // Load full transcript
    const transcript = await db
      .select({
        role: conversationMessages.role,
        content: conversationMessages.content,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationStateId, conversationStateId))
      .orderBy(conversationMessages.createdAt);

    const nextStep = STEPS[result.updatedState.currentStepIndex];

    return NextResponse.json({
      assistantMessage: result.assistantMessage,
      state: {
        currentStepIndex: result.updatedState.currentStepIndex,
        currentStep: nextStep?.slug ?? "review",
        status: result.updatedState.status,
        completedSteps: result.updatedState.completedSteps,
        draft: result.updatedState.draft,
      },
      structuredControls: result.structuredControls ?? null,
      transcript,
    });
  } catch (error) {
    if (error instanceof EngineError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof APICallError) {
      const status = error.statusCode ?? 502;
      return NextResponse.json(
        { error: error.message },
        { status: status >= 400 && status < 500 ? 422 : 502 },
      );
    }
    console.error("Chatbot message error:", error);
    return NextResponse.json(
      { error: "Failed to process message" },
      { status: 500 },
    );
  }
}

/** Persist engine messages to the conversation_messages table. */
async function persistMessages(
  conversationStateId: string,
  messages: EngineMessage[],
): Promise<void> {
  if (messages.length === 0) return;

  const values = messages.map((msg) => ({
    conversationStateId,
    role: msg.role,
    content: msg.content,
  }));

  await db.insert(conversationMessages).values(values);
}
