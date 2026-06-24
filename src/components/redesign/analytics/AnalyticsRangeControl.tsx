"use client";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { RangePreset } from "./analytics-types";

export function AnalyticsRangeControl({ preset, onChange }: { preset: RangePreset; onChange: (p: RangePreset) => void }) {
  return (
    <SegmentedControl
      value={preset}
      onChange={onChange}
      options={[{ value: "7d", label: "7D" }, { value: "30d", label: "30D" }, { value: "90d", label: "90D" }, { value: "12m", label: "12M" }]}
    />
  );
}
