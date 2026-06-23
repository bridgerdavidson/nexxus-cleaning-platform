"use client";

import { cn } from "@/lib/utils";
import type { PeopleSegment } from "./staff-types";

/** Segmented control switching the People screen between its two entity types
 *  (cleaners vs back-office staff). This is an entity-type split, not a fake
 *  time-lifecycle segment, which is why segmenting is appropriate here. */
export function PeopleSegmentTabs({
  value,
  onChange,
}: {
  value: PeopleSegment;
  onChange: (v: PeopleSegment) => void;
}) {
  const items: { id: PeopleSegment; label: string }[] = [
    { id: "cleaners", label: "Cleaners" },
    { id: "staff", label: "Staff" },
  ];
  return (
    <div
      className="inline-flex items-center gap-1 rounded-pill border border-border bg-muted/40 p-1"
      role="tablist"
      aria-label="People type"
    >
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.id)}
            className={cn(
              "rounded-pill px-4 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-card text-foreground shadow-soft-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
