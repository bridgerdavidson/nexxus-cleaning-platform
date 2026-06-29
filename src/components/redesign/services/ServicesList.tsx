"use client";

import { ChevronRight, Sparkles } from "lucide-react";
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
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const selected = r.id === selectedId;
        return (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "flex w-full items-center gap-3 rounded-card border bg-card p-3.5 text-left shadow-soft-sm outline-none transition-colors",
                "hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-brand-600 ring-1 ring-brand-600/30" : "border-border",
                !r.isActive && "opacity-60",
              )}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-600">
                <Sparkles className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-bold text-foreground">{r.name}</span>
                  {!r.isActive && (
                    <span className="shrink-0 rounded-pill bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      Inactive
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {r.serviceTypeLabel} &middot; {r.durationLabel}
                </div>
              </div>
              <span className="tnum shrink-0 text-[15px] font-extrabold text-foreground">{r.priceLabel}</span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
