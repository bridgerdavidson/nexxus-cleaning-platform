"use client";

import { Moon } from "lucide-react";
import { ThemeSegmented } from "@/components/ui/theme-segmented";

/**
 * Appearance row for the homeowner and cleaner settings homes. Card visuals
 * mirror ProfileRow, but with the theme control stacked below the label block
 * instead of a chevron (this row acts in place, it does not navigate).
 * Device-local, applies instantly: no save bar involvement.
 */
export function ThemePreferenceRow() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-3.5 shadow-soft-sm">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-ink dark:bg-brand-500/15">
          <Moon className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-foreground">Appearance</span>
          <span className="block text-[13px] text-muted-foreground">
            Choose light or dark, or follow your device. Saved on this device.
          </span>
        </span>
      </div>
      <ThemeSegmented />
    </div>
  );
}
