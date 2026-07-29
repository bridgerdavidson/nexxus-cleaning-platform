"use client";

import Link from "next/link";
import { ChevronRight, ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CleanerSubHeader } from "./CleanerSubHeader";
import type { CatalogRowVM } from "./profile-types";

export function CleanerServicesCatalogView({
  rows,
  loading,
  error,
  onRetry,
}: {
  rows: CatalogRowVM[];
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
}) {
  if (error) {
    return <ErrorState title="Couldn't load services" onRetry={onRetry} />;
  }
  return (
    <div className="space-y-4 pt-1">
      <CleanerSubHeader backHref="/cleaner/profile" backLabel="Profile" title="Services" />

      {loading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-[68px] w-full rounded-card" />
          <Skeleton className="h-[68px] w-full rounded-card" />
          <Skeleton className="h-[68px] w-full rounded-card" />
        </div>
      ) : rows.length === 0 ? (
        <div className="pt-10">
          <EmptyState
            icon={<ClipboardList />}
            title="No services yet"
            description="When your office adds services, they'll show up here."
          />
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/cleaner/profile/services/${r.id}`}
              className="flex items-center gap-3 rounded-card border border-border bg-card p-3.5 shadow-soft-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-ink">
                <ClipboardList className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold text-foreground">{r.name}</div>
                <div className="text-xs text-muted-foreground">
                  {r.durationLabel} &middot; {r.serviceTypeLabel}
                </div>
              </div>
              <div className="text-[15px] font-extrabold tabular-nums text-foreground">{r.priceLabel}</div>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
