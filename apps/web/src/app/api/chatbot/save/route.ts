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
import type {
  LocationPreferenceTier,
  LocationPreferences,
  RemotePreference,
} from "@/lib/chatbot/schemas";

// ─── Location Tier Derivation Helpers ───────────────────────────────────────

/** Derive a flat RemotePreference enum from location preference tiers. */
function deriveRemotePreference(
  tiers: LocationPreferenceTier[],
): RemotePreference {
  const allFormats = new Set(tiers.flatMap((t) => t.workFormats));
  if (allFormats.size === 1 && allFormats.has("remote")) return "remote_only";
  if (allFormats.has("remote") && allFormats.has("onsite")) return "any";
  if (allFormats.has("remote") && allFormats.has("hybrid")) return "hybrid_ok";
  if (allFormats.has("onsite") || allFormats.has("relocation"))
    return "onsite_ok";
  return "any";
}

/** Derive a flat list of preferred locations from location preference tiers. */
function derivePreferredLocations(tiers: LocationPreferenceTier[]): string[] {
  const locations = new Set<string>();
  for (const tier of tiers) {
    for (const loc of tier.scope.include) {
      locations.add(loc);
    }
  }
  return Array.from(locations);
}

/**
 * Convert legacy flat location data to the tier model.
 * Used for in-progress conversations that have old-shape drafts.
 */
function legacyToTiers(
  locations: string[],
  remotePref: string,
): LocationPreferences {
  const workFormats: LocationPreferenceTier["workFormats"] =
    remotePref === "remote_only"
      ? ["remote"]
      : remotePref === "hybrid_ok"
        ? ["remote", "hybrid"]
        : remotePref === "onsite_ok"
          ? ["onsite", "relocation"]
          : ["remote", "hybrid", "onsite", "relocation"];
  return {
    tiers: [
      {
        rank: 1,
        workFormats,
        scope: {
          type: locations.length > 0 ? "countries" : "any",
          include: locations,
        },
      },
    ],
  };
}

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

    // Resolve location preferences: use new tiers or convert legacy flat data
    const locationPrefs: LocationPreferences | null =
      draft.locationPreferences ??
      (draft.preferredLocations
        ? legacyToTiers(
            draft.preferredLocations,
            draft.remotePreference ?? "any",
          )
        : null);

    // Derive flat columns from tiers for backward compatibility
    const derivedLocations = locationPrefs
      ? derivePreferredLocations(locationPrefs.tiers)
      : (draft.preferredLocations ?? []);
    const derivedRemotePref = locationPrefs
      ? deriveRemotePreference(locationPrefs.tiers)
      : (draft.remotePreference ?? "any");

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
          locationPreferences: locationPrefs,
          preferredLocations: derivedLocations,
          remotePreference: derivedRemotePref,
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
            locationPreferences: locationPrefs,
            preferredLocations: derivedLocations,
            remotePreference: derivedRemotePref,
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
