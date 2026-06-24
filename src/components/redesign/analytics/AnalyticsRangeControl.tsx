"use client";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { RangePreset } from "./analytics-types";

const OPTS: { value: RangePreset; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "12m", label: "12M" },
];

export function AnalyticsRangeControl({ preset, onChange }: { preset: RangePreset; onChange: (p: RangePreset) => void }) {
  return (
    <div className="inline-flex rounded-pill border border-border bg-card p-1 shadow-soft-sm">
      {OPTS.map((o) => {
        const active = o.value === preset;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative rounded-pill px-3.5 py-1.5 text-sm font-semibold",
              active ? "text-white" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active ? (
              <motion.span
                layoutId="range-pill"
                className="absolute inset-0 rounded-pill bg-brand-600"
                style={{ zIndex: -1 }}
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            ) : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
