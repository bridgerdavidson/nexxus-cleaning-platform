"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useManagerPermissions } from "@/hooks/useManagerPermissions";
import { EmptyState } from "@/components/ui/empty-state";
import { InsightsPanel } from "./InsightsPanel";
import { OperatorAnalyticsView } from "./OperatorAnalyticsView";
import { buildKpis, buildCsvRows } from "./deriveAnalytics";
import { deriveInsights } from "./deriveInsights";
import {
  useAnalyticsRange,
  useAnalyticsSummary,
  useAnalyticsRevenueSeries,
  useAnalyticsServiceMix,
  useAnalyticsLeaderboard,
  useAnalyticsDemand,
  useAnalyticsCancellations,
} from "@/hooks/useAnalytics";

/**
 * Permission gate for the Operator Analytics screen. Analytics data (revenue,
 * cancellation rates, cleaner leaderboard) is an APP-LEVEL grant, not RLS,
 * so we must not mount the data component (and its hooks) until we know the
 * viewer is allowed. useManagerPermissions returns ALL_FALSE for admins, so
 * check role first.
 */
export function OperatorAnalytics() {
  const { currentOrgRole } = useAuth();
  const { permissions, loading: permsLoading } = useManagerPermissions();

  const privileged = currentOrgRole === "owner" || currentOrgRole === "admin";
  const canView = privileged || !!permissions?.can_view_analytics;
  const canMoney = privileged || !!permissions?.can_view_payments;

  if (!privileged && permsLoading) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!canView) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <EmptyState
          icon={<ShieldAlert />}
          title="You do not have access to analytics"
          description="Ask an owner or admin to grant you the analytics permission."
        />
      </div>
    );
  }
  return <OperatorAnalyticsData canMoney={canMoney} />;
}

function OperatorAnalyticsData({ canMoney }: { canMoney: boolean }) {
  const { range, setPreset } = useAnalyticsRange();
  const { summary } = useAnalyticsSummary(range);
  const { series } = useAnalyticsRevenueSeries(range);
  const { rows: serviceMix } = useAnalyticsServiceMix(range);
  const { rows: leaderboard } = useAnalyticsLeaderboard(range);
  const { cells: demand } = useAnalyticsDemand(range);
  const { data: cancellations } = useAnalyticsCancellations(range);

  // animate ONCE on first mount; realtime refetch must not redraw.
  const [animate, setAnimate] = useState(true);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    const t = setTimeout(() => setAnimate(false), 1200);
    return () => clearTimeout(t);
  }, []);

  const kpis = useMemo(
    () => (summary ? buildKpis(summary, series, canMoney) : []),
    [summary, series, canMoney],
  );
  const insights = useMemo(
    () =>
      summary && cancellations
        ? deriveInsights({ summary, serviceMix, leaderboard, cancellations })
        : [],
    [summary, serviceMix, leaderboard, cancellations],
  );
  const runRateSpark = useMemo(
    () => series.map((p) => (p.collectedCents ?? 0) / 100),
    [series],
  );

  const onExport = () => {
    const rows = buildCsvRows(series);
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${range.rangeKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <OperatorAnalyticsView
      preset={range.preset}
      onPresetChange={setPreset}
      kpis={kpis}
      summary={summary}
      series={series}
      runRateSpark={runRateSpark}
      serviceMix={serviceMix}
      leaderboard={leaderboard}
      demand={demand}
      insightsSlot={<InsightsPanel insights={insights} />}
      animate={animate}
      onExport={canMoney ? onExport : undefined}
    />
  );
}
