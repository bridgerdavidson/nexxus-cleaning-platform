"use client";

import { Check, PackageOpen } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CleanerSubHeader } from "./CleanerSubHeader";
import type { CatalogDetailVM } from "./profile-types";

export function CleanerServiceDetailView({
  detail,
  loading,
  checklistsLoading,
}: {
  detail: CatalogDetailVM | null;
  loading: boolean;
  checklistsLoading: boolean;
}) {
  return (
    <div className="space-y-4 pt-1">
      <CleanerSubHeader
        backHref="/cleaner/profile/services"
        backLabel="Services"
        title={detail?.name ?? "Service"}
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-48 rounded-pill" />
          <Skeleton className="h-28 w-full rounded-card" />
          <Skeleton className="h-28 w-full rounded-card" />
        </div>
      ) : !detail ? (
        <div className="pt-10">
          <EmptyState
            icon={<PackageOpen />}
            title="Service not found"
            description="This service may have been removed. Head back to the catalog."
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-sm font-semibold text-muted-foreground">
            <span className="tabular-nums text-foreground">{detail.priceRangeLabel}</span>
            <span aria-hidden>&middot;</span>
            <span>{detail.durationLabel}</span>
            <span aria-hidden>&middot;</span>
            <span>{detail.serviceTypeLabel}</span>
          </div>

          {detail.description && (
            <p className="px-0.5 text-sm leading-relaxed text-muted-foreground">{detail.description}</p>
          )}

          {checklistsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full rounded-card" />
              <Skeleton className="h-28 w-full rounded-card" />
            </div>
          ) : detail.tiers.length === 0 ? (
            <p className="px-0.5 pt-2 text-sm text-muted-foreground">
              No checklists have been added to this service yet.
            </p>
          ) : (
            <div className="space-y-3">
              {detail.tiers.map((tier) => {
                const included = tier.adderLabel === "Included";
                return (
                  <div key={tier.id} className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="text-[15px] font-extrabold text-foreground">{tier.name}</span>
                      <span
                        className={
                          "rounded-pill px-2.5 py-0.5 text-xs font-bold " +
                          (included
                            ? "bg-positive-50 text-positive-700"
                            : "bg-brand-50 text-brand-700")
                        }
                      >
                        {tier.adderLabel}
                      </span>
                    </div>
                    {tier.tasks.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No tasks listed.</p>
                    ) : (
                      <ul className="space-y-2">
                        {tier.tasks.map((task) => (
                          <li key={task.id} className="flex items-start gap-2.5 text-sm text-foreground/90">
                            <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                            <span>{task.task}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
