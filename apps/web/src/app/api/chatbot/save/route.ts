import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  conversationStates,
  userProfiles,
  userCompanyPreferences,
} from "@/lib/db/schema";
import {
  deserializeState,
  serializeState,
  validateDraft,
  markCompleted,
} from "@/lib/chatbot/state";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  try {
    // Load conversation state
    const existing = await db
      .select()
      .from(conversationStates)
      .where(eq(conversationStates.userId, session.user.id))
      .limit(1);

    if (existing.length === 0 || !existing[0]) {
      return NextResponse.json(
        { error: "No conversation found. Please complete onboarding first." },
        { status: 404 },
      );
    }

    const state = deserializeState(existing[0].state);

    // Validate the draft has all required fields
    const validation = validateDraft(state.draft);
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: "Missing required preferences",
          missingSteps: validation.missingRequired,
        },
        { status: 400 },
      );
    }

    const draft = state.draft;
    const now = new Date();

    // Use a transaction to atomically upsert both tables and mark conversation complete
    await db.transaction(async (tx) => {
      // Upsert user_profiles with job preference fields
      await tx
        .insert(userProfiles)
        .values({
          userId: session.user.id,
          targetTitles: draft.targetTitles ?? [],
          targetSeniority: draft.targetSeniority ?? [],
          coreSkills: draft.coreSkills ?? [],
          growthSkills: draft.growthSkills ?? [],
          avoidSkills: draft.avoidSkills ?? [],
          dealBreakers: draft.dealBreakers ?? [],
          preferredLocations: draft.preferredLocations ?? [],
          remotePreference: draft.remotePreference ?? "any",
          minSalary: draft.minSalary ?? null,
          targetSalary: draft.targetSalary ?? null,
          salaryCurrency: draft.salaryCurrency ?? "USD",
          preferredIndustries: draft.industries ?? [],
          weightRole: draft.weightRole ?? 0.25,
          weightSkills: draft.weightSkills ?? 0.25,
          weightLocation: draft.weightLocation ?? 0.2,
          weightCompensation: draft.weightCompensation ?? 0.15,
          weightDomain: draft.weightDomain ?? 0.15,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: {
            targetTitles: draft.targetTitles ?? [],
            targetSeniority: draft.targetSeniority ?? [],
            coreSkills: draft.coreSkills ?? [],
            growthSkills: draft.growthSkills ?? [],
            avoidSkills: draft.avoidSkills ?? [],
            dealBreakers: draft.dealBreakers ?? [],
            preferredLocations: draft.preferredLocations ?? [],
            remotePreference: draft.remotePreference ?? "any",
            minSalary: draft.minSalary ?? null,
            targetSalary: draft.targetSalary ?? null,
            salaryCurrency: draft.salaryCurrency ?? "USD",
            preferredIndustries: draft.industries ?? [],
            weightRole: draft.weightRole ?? 0.25,
            weightSkills: draft.weightSkills ?? 0.25,
            weightLocation: draft.weightLocation ?? 0.2,
            weightCompensation: draft.weightCompensation ?? 0.15,
            weightDomain: draft.weightDomain ?? 0.15,
            updatedAt: now,
          },
        });

      // Upsert user_company_preferences with company preference fields
      await tx
        .insert(userCompanyPreferences)
        .values({
          userId: session.user.id,
          industries: draft.industries ?? [],
          companySizes: draft.companySizes ?? [],
          companyStages: draft.companyStages ?? [],
          workFormat: draft.workFormat ?? null,
          hqGeographies: draft.hqGeographies ?? [],
          productTypes: draft.productTypes ?? [],
          exclusions: draft.exclusions ?? [],
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userCompanyPreferences.userId,
          set: {
            industries: draft.industries ?? [],
            companySizes: draft.companySizes ?? [],
            companyStages: draft.companyStages ?? [],
            workFormat: draft.workFormat ?? null,
            hqGeographies: draft.hqGeographies ?? [],
            productTypes: draft.productTypes ?? [],
            exclusions: draft.exclusions ?? [],
            updatedAt: now,
          },
        });

      // Mark conversation state as completed
      const completedState = markCompleted(state);
      await tx
        .update(conversationStates)
        .set({
          state: serializeState(completedState),
          updatedAt: now,
        })
        .where(eq(conversationStates.userId, session.user.id));
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Chatbot save error:", error);
    return NextResponse.json(
      { error: "Failed to save preferences" },
      { status: 500 },
    );
  }
}
