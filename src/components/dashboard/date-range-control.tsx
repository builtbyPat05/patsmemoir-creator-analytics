"use client";

import type { PerformanceRange } from "@/lib/dashboard-data";

export type SharedRange = Extract<PerformanceRange, "7d" | "30d"> | "all";

const options: { key: SharedRange; label: string }[] = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "all", label: "All time" },
];

type DateRangeControlProps = {
  value: SharedRange;
  onChange: (range: SharedRange) => void;
};

export function DateRangeControl({ value, onChange }: DateRangeControlProps) {
  return (
    <div className="range-control" role="group" aria-label="Select dashboard time range">
      {options.map((option) => (
        <button
          aria-pressed={value === option.key}
          className={value === option.key ? "range-button range-button-active" : "range-button"}
          key={option.key}
          onClick={() => onChange(option.key)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
