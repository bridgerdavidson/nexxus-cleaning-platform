"use client";
import NumberFlow from "@number-flow/react";

// Reduced-motion is handled by NumberFlow internally (respondsToReducedMotion).
export function AnimatedNumber({ value, prefix, suffix, className }: { value: number | null; prefix?: string; suffix?: string; className?: string }) {
  if (value == null) return <span className={className}>—</span>;
  return <NumberFlow value={value} prefix={prefix} suffix={suffix} className={className} />;
}
