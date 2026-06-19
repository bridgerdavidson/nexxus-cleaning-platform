import { CalendarDays, Activity, Clock, DollarSign, UserPlus } from "lucide-react";
import { StatTile } from "@/components/ui/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUsdCompact, type OverviewKpis } from "./overview-types";

/** Four compact KPI tiles. The 4th is Revenue (this month) when payments are
 *  visible, else falls back to Unassigned count (manager without can_view_payments). */
export function KpiStrip({ kpis, loading }: { kpis: OverviewKpis; loading?: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] w-full rounded-card" />
        ))}
      </div>
    );
  }

  const showRevenue = kpis.canViewPayments && kpis.revenueThisMonth != null;

  return (
    <>
      <h2 className="sr-only">Key metrics</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      <StatTile label="Today's jobs" value={String(kpis.todayJobs)} icon={<CalendarDays />} />
      <StatTile label="In progress" value={String(kpis.inProgress)} icon={<Activity />} />
      <StatTile label="Awaiting approval" value={String(kpis.awaitingApproval)} icon={<Clock />} />
      {showRevenue ? (
        <StatTile label="Revenue this month" value={formatUsdCompact(kpis.revenueThisMonth as number)} icon={<DollarSign />} />
      ) : (
        <StatTile label="Unassigned" value={String(kpis.unassignedCount)} icon={<UserPlus />} />
      )}
      </div>
    </>
  );
}
