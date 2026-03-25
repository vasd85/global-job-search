import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversationStates, conversationMessages } from "@/lib/db/schema";
import { STEPS } from "@/lib/chatbot/steps";
import { deserializeState } from "@/lib/chatbot/state";
import { initializeConversation } from "@/lib/chatbot/engine";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  try {
    const existing = await db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.userId, session.user.id))
      .limit(1);

    if (existing.length === 0 || !existing[0]) {
      // No conversation exists yet -- return initial state info
      const init = initializeConversation();
      const firstStep = STEPS[0];

      return NextResponse.json({
        state: {
          currentStepIndex: 0,
          currentStep: firstStep?.slug ?? "target_roles",
          status: "in_progress",
          completedSteps: [],
          draft: {},
        },
        transcript: [],
        structuredControls: init.structuredControls ?? null,
        initialMessage: init.assistantMessage,
        isNew: true,
      });
    }

    const row = existing[0];
    const state = deserializeState(row.state);
    const currentStep = STEPS[state.currentStepIndex];

    // Load transcript from conversation_messages
    const transcript = await db
      .select({
        role: conversationMessages.role,
        content: conversationMessages.content,
        createdAt: conversationMessages.createdAt,
      })
      .from(conversationMessages)
      .where(eq(conversationMessages.conversationStateId, row.id))
      .orderBy(conversationMessages.createdAt);

    // Determine structured controls for current step
    let structuredControls = null;
    if (
      currentStep &&
      currentStep.inputType !== "free_text" &&
      currentStep.structuredConfig
    ) {
      structuredControls = currentStep.structuredConfig;
    }

    return NextResponse.json({
      state: {
        currentStepIndex: state.currentStepIndex,
        currentStep: currentStep?.slug ?? "review",
        status: state.status,
        completedSteps: state.completedSteps,
        draft: state.draft,
      },
      transcript,
      structuredControls,
      isNew: false,
    });
  } catch (error) {
    console.error("Chatbot state error:", error);
    return NextResponse.json(
      { error: "Failed to load conversation state" },
      { status: 500 },
    );
  }
}
