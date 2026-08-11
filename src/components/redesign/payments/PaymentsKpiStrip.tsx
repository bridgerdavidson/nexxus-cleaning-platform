"use client";

import { CalendarRange, DollarSign } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { paymentsKpiItems } from "./paymentsKpis";

const ICONS = [<CalendarRange key="month" />, <DollarSign key="total" />];

/** Two headline revenue KPI tiles. Width-capped so the pair reads as two
 *  comfortable cards on desktop instead of stretching across the page. */
export function PaymentsKpiStrip(props: {
  totalRevenueCents: number;
  thisMonthCents: number;
  loading?: boolean;
}) {
  if (props.loading) {
    return (
      <div className="grid max-w-xl grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-card" />
        ))}
      </div>
    );
  }
  const items = paymentsKpiItems(props);
  return (
    <div className="grid max-w-xl grid-cols-2 gap-4">
      {items.map((it, i) => (
        <StatTile key={it.label} label={it.label} value={it.value} icon={ICONS[i]} />
      ))}
    </div>
  );
}
