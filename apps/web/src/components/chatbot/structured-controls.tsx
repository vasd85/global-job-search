"use client";

import { useState } from "react";
import type { StructuredControlConfig } from "@/lib/chatbot/schemas";
import { STEPS } from "@/lib/chatbot/steps";

interface StructuredControlsProps {
  config: StructuredControlConfig;
  currentStepSlug: string;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

/**
 * Step-specific structured controls for the chatbot.
 * Renders multi-select chips, single-select, range inputs, or slider groups
 * based on the step's structured config.
 * Serializes selections as JSON and sends via the chat interface's send function.
 */
export function StructuredControls({
  config,
  currentStepSlug,
  onSubmit,
  disabled = false,
}: StructuredControlsProps) {
  const step = STEPS.find((s) => s.slug === currentStepSlug);
  const fields = step?.fields ?? [];

  switch (config.type) {
    case "multi_select":
      return (
        <MultiSelectControl
          options={config.options ?? []}
          fields={fields}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    case "single_select":
      return (
        <SingleSelectControl
          options={config.options ?? []}
          fields={fields}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    case "range":
      return (
        <RangeControl
          fields={fields}
          onSubmit={onSubmit}
          disabled={disabled}
        />
      );
    case "slider":
      return <SliderGroupControl onSubmit={onSubmit} disabled={disabled} />;
    default:
      return null;
  }
}

// ─── Multi-Select Chips ─────────────────────────────────────────────────────

interface MultiSelectControlProps {
  options: { value: string; label: string }[];
  fields: string[];
  onSubmit: (value: string) => void;
  disabled: boolean;
}

function MultiSelectControl({
  options,
  fields,
  onSubmit,
  disabled,
}: MultiSelectControlProps) {
  const [selected, setSelected] = useState<string[]>([]);

  const toggleOption = (value: string) => {
    setSelected((prev) =>
      prev.includes(value)
        ? prev.filter((v) => v !== value)
        : [...prev, value],
    );
  };

  const handleSubmit = () => {
    if (selected.length === 0) return;
    const fieldName = fields[0] ?? "value";
    onSubmit(JSON.stringify({ [fieldName]: selected }));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => toggleOption(option.value)}
            disabled={disabled}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              selected.includes(option.value)
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-700"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || selected.length === 0}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Continue
      </button>
    </div>
  );
}

// ─── Single-Select ──────────────────────────────────────────────────────────

interface SingleSelectControlProps {
  options: { value: string; label: string }[];
  fields: string[];
  onSubmit: (value: string) => void;
  disabled: boolean;
}

function SingleSelectControl({
  options,
  fields,
  onSubmit,
  disabled,
}: SingleSelectControlProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!selected) return;
    const fieldName = fields[0] ?? "value";
    onSubmit(JSON.stringify({ [fieldName]: selected }));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setSelected(option.value)}
            disabled={disabled}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              selected === option.value
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-700"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || !selected}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Continue
      </button>
    </div>
  );
}

// ─── Range (Salary) ─────────────────────────────────────────────────────────

interface RangeControlProps {
  fields: string[];
  onSubmit: (value: string) => void;
  disabled: boolean;
}

const CURRENCY_OPTIONS = ["USD", "EUR", "GBP", "CHF", "CAD", "AUD", "ILS"];

function RangeControl({ onSubmit, disabled }: RangeControlProps) {
  const [minSalary, setMinSalary] = useState("");
  const [targetSalary, setTargetSalary] = useState("");
  const [currency, setCurrency] = useState("USD");

  const handleSubmit = () => {
    const result: Record<string, unknown> = {};

    const min = Number(minSalary);
    const target = Number(targetSalary);

    if (minSalary && !isNaN(min) && min > 0) {
      result.minSalary = min;
    }
    if (targetSalary && !isNaN(target) && target > 0) {
      result.targetSalary = target;
    }
    result.salaryCurrency = currency;

    onSubmit(JSON.stringify(result));
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="min-salary"
            className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >
            Minimum Salary
          </label>
          <input
            id="min-salary"
            type="number"
            placeholder="e.g. 80000"
            value={minSalary}
            onChange={(e) => setMinSalary(e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
          />
        </div>
        <div>
          <label
            htmlFor="target-salary"
            className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400"
          >
            Target Salary
          </label>
          <input
            id="target-salary"
            type="number"
            placeholder="e.g. 120000"
            value={targetSalary}
            onChange={(e) => setTargetSalary(e.target.value)}
            disabled={disabled}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
          />
        </div>
      </div>
      <div>
        <label
          htmlFor="salary-currency"
          className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400"
        >
          Currency
        </label>
        <select
          id="salary-currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          disabled={disabled}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition-colors focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:border-zinc-400 dark:focus:ring-zinc-400"
        >
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Continue
      </button>
    </div>
  );
}

// ─── Slider Group (Dimension Weights) ───────────────────────────────────────

interface SliderGroupControlProps {
  onSubmit: (value: string) => void;
  disabled: boolean;
}

const WEIGHT_DIMENSIONS = [
  { field: "weightRole", label: "Role Fit" },
  { field: "weightSkills", label: "Skills Match" },
  { field: "weightLocation", label: "Location" },
  { field: "weightCompensation", label: "Compensation" },
  { field: "weightDomain", label: "Domain/Industry" },
] as const;

const DEFAULT_WEIGHT = 0.2;

function SliderGroupControl({ onSubmit, disabled }: SliderGroupControlProps) {
  const [weights, setWeights] = useState<Record<string, number>>(
    Object.fromEntries(
      WEIGHT_DIMENSIONS.map((d) => [d.field, DEFAULT_WEIGHT]),
    ),
  );

  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);

  const handleWeightChange = (field: string, value: number) => {
    setWeights((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    // Normalize weights to sum to 1.0
    const normalized: Record<string, number> = {};
    const currentTotal = Object.values(weights).reduce(
      (sum, w) => sum + w,
      0,
    );
    for (const [key, value] of Object.entries(weights)) {
      normalized[key] =
        currentTotal > 0
          ? Math.round((value / currentTotal) * 100) / 100
          : DEFAULT_WEIGHT;
    }
    onSubmit(JSON.stringify(normalized));
  };

  return (
    <div className="space-y-4">
      {WEIGHT_DIMENSIONS.map((dim) => (
        <div key={dim.field} className="space-y-1">
          <div className="flex items-center justify-between">
            <label
              htmlFor={dim.field}
              className="text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              {dim.label}
            </label>
            <span className="text-xs font-mono text-zinc-500 dark:text-zinc-400">
              {(weights[dim.field] ?? DEFAULT_WEIGHT).toFixed(2)}
            </span>
          </div>
          <input
            id={dim.field}
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={weights[dim.field] ?? DEFAULT_WEIGHT}
            onChange={(e) =>
              handleWeightChange(dim.field, parseFloat(e.target.value))
            }
            disabled={disabled}
            className="w-full accent-zinc-900 dark:accent-zinc-100"
          />
        </div>
      ))}
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          Total:{" "}
          <span
            className={`font-mono font-medium ${
              Math.abs(total - 1.0) < 0.05
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {total.toFixed(2)}
          </span>
        </span>
        <span className="italic">Weights will be normalized to 1.0</span>
      </div>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        Continue
      </button>
    </div>
  );
}
