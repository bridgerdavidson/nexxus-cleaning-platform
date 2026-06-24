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
    <div role="tablist" className="relative inline-flex rounded-pill border border-border bg-card p-1 shadow-soft-sm">
      {OPTS.map((o) => {
        const active = o.value === preset;
        return (
          <button
            key={o.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className="relative rounded-pill px-3.5 py-1.5 text-sm font-semibold transition-colors"
          >
            {/* The sliding pill. No negative z-index (the button has no stacking
                context, so z-index:-1 would hide it behind the card background);
                instead the label sits above the pill via z-10. */}
            {active ? (
              <motion.span
                layoutId="range-pill"
                className="absolute inset-0 rounded-pill bg-brand-600"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            ) : null}
            <span className={cn("relative z-10", active ? "text-white" : "text-muted-foreground hover:text-foreground")}>
              {o.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
