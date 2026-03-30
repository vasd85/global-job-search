import type {
  LocationPreferenceTier,
  LocationPreferences,
  RemotePreference,
} from "@/lib/chatbot/schemas";

/** Derive a flat RemotePreference enum from location preference tiers. */
export function deriveRemotePreference(
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
export function derivePreferredLocations(
  tiers: LocationPreferenceTier[],
): string[] {
  const locations = new Set<string>();
  for (const tier of tiers) {
    for (const loc of tier.scope.include ?? []) {
      locations.add(loc);
    }
  }
  return Array.from(locations);
}

/**
 * Convert legacy flat location data to the tier model.
 * Used for in-progress conversations that have old-shape drafts.
 */
export function legacyToTiers(
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
