"use client";

import { cn } from "@/lib/utils";
import type { ServiceRowVM } from "./services-types";

export function ServicesList({
  rows,
  selectedId,
  onSelect,
}: {
  rows: ServiceRowVM[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => {
        const selected = r.id === selectedId;
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "w-full rounded-field border border-transparent px-3 py-2.5 text-left transition-colors",
                "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && "border-border bg-primary/10",
                !r.isActive && "opacity-60",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-foreground">{r.name}</span>
                <span className="tnum shrink-0 text-sm font-medium text-muted-foreground">{r.priceLabel}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span>{r.serviceTypeLabel}</span>
                <span aria-hidden>·</span>
                <span>{r.durationLabel}</span>
                {!r.isActive && <span className="ml-auto rounded-pill bg-muted px-2 py-0.5">Inactive</span>}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
