"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Mobile list filter layout: full-width search on its own row, then a wrapping
 * row of compact auto-width controls (sort / status / toggles). At sm+ it
 * collapses to a single inline row. Layout only, no business logic.
 *
 * Pass the search input (with its icon wrapper) as `search`; pass the compact
 * controls as `children`. The search slot already applies full-width on mobile
 * and `sm:max-w-xl sm:flex-1`, so the search node should NOT carry its own
 * width/flex classes.
 */
export function ListFilterBar({
  search,
  children,
  className,
}: {
  search: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3", className)}>
      <div className="w-full sm:max-w-xl sm:flex-1">{search}</div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">{children}</div>
      ) : null}
    </div>
  );
}
