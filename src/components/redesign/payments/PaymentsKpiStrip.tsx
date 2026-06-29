"use client";

import { DollarSign, CalendarRange, Hourglass, Receipt, Banknote } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { paymentsKpiItems } from "./paymentsKpis";

const ICONS = [
  <DollarSign key="rev" />,
  <CalendarRange key="month" />,
  <Hourglass key="queued" />,
  <Receipt key="txn" />,
  <Banknote key="payout" />,
];

/** Five KPI tiles: Revenue / This month / Queued payouts / Transactions / Payouts. */
export function PaymentsKpiStrip(props: {
  totalRevenue: number;
  thisMonth: number;
  queuedPayouts: number;
  txnCount: number;
  payoutCount: number;
  loading?: boolean;
}) {
  if (props.loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-card" />
        ))}
      </div>
    );
  }
  const items = paymentsKpiItems(props);
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
      {items.map((it, i) => (
        <StatTile key={it.label} label={it.label} value={it.value} icon={ICONS[i]} />
      ))}
    </div>
  );
}
