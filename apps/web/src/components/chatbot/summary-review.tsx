"use client";

import { useState } from "react";
import type {
  PreferencesDraft,
  LocationPreferences,
  LocationPreferenceTier,
} from "@/lib/chatbot/schemas";

interface SummaryReviewProps {
  draft: PreferencesDraft;
  onEdit: (stepSlug: string) => void;
  onSave: () => void;
  saving?: boolean;
  error?: string | null;
}

/**
 * Review step component. Displays all collected preferences organized
 * by section with edit buttons per section.
 * "Save & Finish" button calls POST /api/chatbot/save.
 */
export function SummaryReview({
  draft,
  onEdit,
  onSave,
  saving = false,
  error = null,
}: SummaryReviewProps) {
  const [confirmSave, setConfirmSave] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Review Your Preferences
        </h3>

        {/* Job Preferences */}
        <PreferenceSection title="Job Preferences">
          <PreferenceField
            label="Target Roles"
            value={draft.targetTitles}
            stepSlug="target_roles"
            onEdit={onEdit}
          />
          <PreferenceField
            label="Seniority"
            value={draft.targetSeniority}
            stepSlug="target_seniority"
            onEdit={onEdit}
          />
          <PreferenceField
            label="Core Skills"
            value={draft.coreSkills}
            stepSlug="core_skills"
            onEdit={onEdit}
          />
          <PreferenceField
            label="Growth Skills"
            value={draft.growthSkills}
            stepSlug="growth_skills"
            onEdit={onEdit}
          />
          <PreferenceField
            label="Avoid Skills"
            value={draft.avoidSkills}
            stepSlug="avoid_skills"
            onEdit={onEdit}
          />
          <PreferenceField
            label="Deal Breakers"
            value={draft.dealBreakers}
            stepSlug="deal_breakers"
            onEdit={onEdit}
          />
        </PreferenceSection>

        {/* Salary & Location */}
        <PreferenceSection title="Salary & Location">
          <PreferenceField
            label="Salary Range"
            value={formatSalary(draft)}
            stepSlug="salary"
            onEdit={onEdit}
          />
          <LocationTiersDisplay
            locationPreferences={draft.locationPreferences}
            onEdit={onEdit}
          />
        </PreferenceSection>

        {/* Company Preferences */}
        <PreferenceSection title="Company Preferences">
          <PreferenceField
            label="Industries"
            value={draft.industries}
            stepSlug="industries"
            onEdit={onEdit}
          />
          <PreferenceField
            label="Company Sizes"
            value={draft.companySizes}
            stepSlug="company_sizes"
            onEdit={onEdit}
          />
          <PreferenceField
            label="Company Stages"
            value={draft.companyStages}
            stepSlug="company_stages"
            onEdit={onEdit}
          />
          <PreferenceField
            label="Work Format"
            value={formatEnum(draft.workFormat)}
            stepSlug="work_format"
            onEdit={onEdit}
          />
          <PreferenceField
            label="HQ Geographies"
            value={draft.hqGeographies}
            stepSlug="hq_geographies"
            onEdit={onEdit}
          />
          <PreferenceField
            label="Product Types"
            value={draft.productTypes}
            stepSlug="product_types"
            onEdit={onEdit}
          />
          <PreferenceField
            label="Exclusions"
            value={draft.exclusions}
            stepSlug="exclusions"
            onEdit={onEdit}
          />
        </PreferenceSection>

        {/* Dimension Weights */}
        <PreferenceSection title="Dimension Weights">
          <WeightDisplay
            weights={{
              "Role Fit": draft.weightRole,
              "Skills Match": draft.weightSkills,
              Location: draft.weightLocation,
              Compensation: draft.weightCompensation,
              "Domain/Industry": draft.weightDomain,
            }}
            stepSlug="dimension_weights"
            onEdit={onEdit}
          />
        </PreferenceSection>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        {!confirmSave ? (
          <button
            type="button"
            onClick={() => setConfirmSave(true)}
            disabled={saving}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
          >
            Save & Finish
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-600"
            >
              {saving ? "Saving..." : "Confirm Save"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmSave(false)}
              disabled={saving}
              className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PreferenceSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <h4 className="mb-2 border-b border-zinc-100 pb-1 text-sm font-semibold text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        {title}
      </h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function PreferenceField({
  label,
  value,
  stepSlug,
  onEdit,
}: {
  label: string;
  value: string | string[] | undefined | null;
  stepSlug: string;
  onEdit: (stepSlug: string) => void;
}) {
  const displayValue = formatValue(value);
  if (!displayValue) return null;

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
        <p className="text-sm text-zinc-900 dark:text-zinc-100">
          {displayValue}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onEdit(stepSlug)}
        className="mt-1 shrink-0 text-xs font-medium text-zinc-500 underline transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        Edit
      </button>
    </div>
  );
}

function LocationTiersDisplay({
  locationPreferences,
  onEdit,
}: {
  locationPreferences: LocationPreferences | undefined;
  onEdit: (stepSlug: string) => void;
}) {
  if (!locationPreferences || locationPreferences.tiers.length === 0) {
    return null;
  }

  // Group tiers by rank for display
  const grouped = new Map<number, LocationPreferenceTier[]>();
  for (const tier of locationPreferences.tiers) {
    const existing = grouped.get(tier.rank) ?? [];
    existing.push(tier);
    grouped.set(tier.rank, existing);
  }

  const ranks = Array.from(grouped.keys()).sort((a, b) => a - b);

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Location Preferences
        </span>
        <div className="mt-1 space-y-2">
          {ranks.map((rank) => {
            const tiers = grouped.get(rank) ?? [];
            const label =
              rank === 1 && ranks.length > 1
                ? "Most Preferred"
                : ranks.length === 1
                  ? ""
                  : "";
            return (
              <div key={rank}>
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  Tier {rank}
                  {label ? ` (${label})` : ""}:
                </span>
                <ul className="ml-3 list-disc">
                  {tiers.map((tier, i) => {
                    const immigrationLine = formatImmigrationFlags(tier);
                    return (
                      <li
                        key={i}
                        className="text-sm text-zinc-900 dark:text-zinc-100"
                      >
                        {formatTierLine(tier)}
                        {immigrationLine && (
                          <span className="ml-1 text-xs text-zinc-500 dark:text-zinc-400">
                            ({immigrationLine})
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onEdit("location")}
        className="mt-1 shrink-0 text-xs font-medium text-zinc-500 underline transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        Edit
      </button>
    </div>
  );
}

function formatTierLine(tier: LocationPreferenceTier): string {
  const formats = tier.workFormats
    .map((f) => f.charAt(0).toUpperCase() + f.slice(1))
    .join("/");

  const parts: string[] = [formats];

  if (tier.scope.include.length > 0) {
    const preposition =
      tier.scope.type === "cities" || tier.scope.type === "timezones"
        ? "in"
        : "to";
    parts.push(`${preposition} ${tier.scope.include.join(", ")}`);
  } else if (tier.scope.type === "any") {
    parts.push("anywhere");
  }

  if (tier.scope.exclude && tier.scope.exclude.length > 0) {
    parts.push(`(except ${tier.scope.exclude.join(", ")})`);
  }

  if (tier.qualitativeConstraint) {
    parts.push(`- "${tier.qualitativeConstraint}"`);
  }

  return parts.join(" ");
}

/**
 * Format the optional immigrationFlags object as a short inline hint.
 * Returns null when no flags are set so the caller can skip rendering.
 */
function formatImmigrationFlags(tier: LocationPreferenceTier): string | null {
  const flags = tier.immigrationFlags;
  if (!flags) return null;

  const labels: string[] = [];
  if (flags.needsVisaSponsorship) labels.push("needs visa sponsorship");
  if (flags.wantsRelocationPackage) labels.push("relocation preferred");
  if (flags.needsUnrestrictedWorkAuth) labels.push("open to international");

  if (labels.length === 0) return null;
  return labels.join(", ");
}

function WeightDisplay({
  weights,
  stepSlug,
  onEdit,
}: {
  weights: Record<string, number | undefined>;
  stepSlug: string;
  onEdit: (stepSlug: string) => void;
}) {
  return (
    <div className="space-y-1">
      {Object.entries(weights).map(([label, weight]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="w-32 text-xs text-zinc-500 dark:text-zinc-400">
            {label}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
            <div
              className="h-full rounded-full bg-zinc-600 dark:bg-zinc-300"
              style={{ width: `${(weight ?? 0) * 100}%` }}
            />
          </div>
          <span className="w-10 text-right font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {(weight ?? 0).toFixed(2)}
          </span>
        </div>
      ))}
      <div className="mt-1 text-right">
        <button
          type="button"
          onClick={() => onEdit(stepSlug)}
          className="text-xs font-medium text-zinc-500 underline transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

// ─── Formatting Helpers ─────────────────────────────────────────────────────

function formatValue(
  value: string | string[] | undefined | null,
): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return value.join(", ");
  }
  if (typeof value === "string" && value.length > 0) return value;
  return null;
}

function formatEnum(value: string | undefined | null): string | null {
  if (!value) return null;
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatSalary(draft: PreferencesDraft): string | null {
  const parts: string[] = [];
  const currency = draft.salaryCurrency ?? "USD";

  if (draft.minSalary) {
    parts.push(`Min: ${currency} ${draft.minSalary.toLocaleString()}`);
  }
  if (draft.targetSalary) {
    parts.push(`Target: ${currency} ${draft.targetSalary.toLocaleString()}`);
  }

  if (parts.length === 0) return null;
  return parts.join(" | ");
}
