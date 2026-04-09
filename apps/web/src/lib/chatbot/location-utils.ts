import type {
  LocationPreferenceTier,
  RemotePreference,
} from "@/lib/chatbot/schemas";

/**
 * Derive a flat RemotePreference enum from location preference tiers.
 *
 * The flat enum is denormalized onto `user_profile.remote_preference` so the
 * L1 SQL pre-filter and the LLM scoring prompt can read it without parsing
 * the JSONB tier blob.
 *
 * Note: with `relocation` removed from `TierWorkFormat`, the only inputs are
 * subsets of {remote, hybrid, onsite}.
 */
export function deriveRemotePreference(
  tiers: LocationPreferenceTier[],
): RemotePreference {
  const allFormats = new Set(tiers.flatMap((t) => t.workFormats));
  if (allFormats.size === 0) return "any";
  if (allFormats.size === 1 && allFormats.has("remote")) return "remote_only";
  if (allFormats.has("onsite") && !allFormats.has("remote")) return "onsite_ok";
  if (allFormats.has("hybrid") && !allFormats.has("onsite")) return "hybrid_ok";
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
