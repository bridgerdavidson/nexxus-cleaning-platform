import { CalendarDays, Activity, Clock, DollarSign } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatUsdCompact, type OverviewKpis } from "./overview-types";

/** Three operational tiles, always shown, plus an optional 4th Revenue (this
 *  month) tile when the viewer can see payments. When Revenue isn't visible
 *  (manager without can_view_payments) it is DROPPED, not replaced by a
 *  substitute tile, and the grid reflows to 3 columns at the lg breakpoint so
 *  the strip still lays out cleanly. */
export function KpiStrip({ kpis, loading }: { kpis: OverviewKpis; loading?: boolean }) {
  const showRevenue = kpis.canViewPayments && kpis.revenueThisMonth != null;
  const gridClass = cn("grid grid-cols-2 gap-4 md:grid-cols-3", showRevenue ? "lg:grid-cols-4" : "lg:grid-cols-3");

  if (loading) {
    return (
      <div className={gridClass}>
        {Array.from({ length: showRevenue ? 4 : 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-card" />
        ))}
      </div>
    );
  }

  return (
    <>
      <h2 className="sr-only">Key metrics</h2>
      <div className={gridClass}>
        <StatTile label="Today's jobs" value={String(kpis.todayJobs)} icon={<CalendarDays />} />
        <StatTile label="In progress" value={String(kpis.inProgress)} icon={<Activity />} />
        <StatTile label="Awaiting approval" value={String(kpis.awaitingApproval)} icon={<Clock />} />
        {showRevenue ? (
          <StatTile label="Revenue this month" value={formatUsdCompact(kpis.revenueThisMonth as number)} icon={<DollarSign />} />
        ) : null}
      </div>
    </>
  );
}
