"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { money2 } from "./payments-presenters";

/**
 * Compact inline money totals (NOT a KPI tile row). Quiet labels + foreground
 * values, inline on desktop and stacked on mobile. "Queued payouts" = pending
 * payout money waiting on cleaner onboarding (it is not approvable).
 */
export function PaymentsMoneyGlance({
  totalRevenue,
  thisMonth,
  queuedPayouts,
  loading,
}: {
  totalRevenue: number;
  thisMonth: number;
  queuedPayouts: number;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-40 rounded-pill" />
        ))}
      </div>
    );
  }

  const items = [
    { label: "Revenue", value: money2(totalRevenue) },
    { label: "This month", value: money2(thisMonth) },
    { label: "Queued payouts", value: money2(queuedPayouts) },
  ];

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8 sm:gap-y-2">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline gap-2">
          <span className="text-sm text-muted-foreground">{it.label}</span>
          <span className="text-base font-semibold text-foreground">{it.value}</span>
        </div>
      ))}
    </div>
  );
}
