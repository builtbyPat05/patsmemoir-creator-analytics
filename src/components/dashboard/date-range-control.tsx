"use client";

import { performanceRangeOptions, type PerformanceRange } from "@/lib/dashboard-data";

type DateRangeControlProps = {
  value: PerformanceRange;
  onChange: (range: PerformanceRange) => void;
};

export function DateRangeControl({ value, onChange }: DateRangeControlProps) {
  return (
    <div className="range-control" role="group" aria-label="Select dashboard time range">
      {performanceRangeOptions.map((option) => (
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
