"use client";
import { useState } from "react";
import { OperatorShell } from "@/components/redesign/shell/OperatorShell";
import { OperatorAnalyticsView } from "@/components/redesign/analytics/OperatorAnalyticsView";
import { InsightsPanel } from "@/components/redesign/analytics/InsightsPanel";
import { buildKpis } from "@/components/redesign/analytics/deriveAnalytics";
import { deriveInsights } from "@/components/redesign/analytics/deriveInsights";
import type { AnalyticsSummary, CancellationsData, DemandCell, LeaderRow, RangePreset, ServiceMixRow, TimeseriesPoint } from "@/components/redesign/analytics/analytics-types";

const SUMMARY: AnalyticsSummary = { revenueCents: 4820000, revenuePrevCents: 4300000, bookedCents: 6100000, jobsCompleted: 132, jobsTotal: 140, cancelled: 6, cancelRate: 0.042, recurringCents: 2790000, oneoffCents: 2030000, runRateCents: 58100000, forecast30Cents: 5000000, arAging: { current: 182000, d1_7: 124000, d8_30: 76000, d30plus: 41000 } };
const SERIES: TimeseriesPoint[] = ["05-05","05-12","05-19","05-26","06-02","06-09","06-16"].map((d, i) => ({ bucketStart: `2026-${d}`, collectedCents: (420 + i * 60) * 1000, bookedCents: (520 + i * 75) * 1000, jobs: 14 + i }));
const MIX: ServiceMixRow[] = [{ serviceTypeId: "1", name: "Deep clean", revenueCents: 520000, jobs: 20, avgTicketCents: 26000 }, { serviceTypeId: "2", name: "Standard", revenueCents: 400000, jobs: 30, avgTicketCents: 13300 }, { serviceTypeId: "3", name: "Move-out", revenueCents: 310000, jobs: 8, avgTicketCents: 38750 }];
const LEADERS: LeaderRow[] = [{ cleanerId: "1", name: "Wanda P.", jobs: 28, revenueCents: 358400, avgRating: 4.9 }, { cleanerId: "2", name: "Marco D.", jobs: 22, revenueCents: 214000, avgRating: 4.8 }, { cleanerId: "3", name: "Lena R.", jobs: 19, revenueCents: 192000, avgRating: 5 }];
const DEMAND: DemandCell[] = Array.from({ length: 7 }, (_, d) => Array.from({ length: 12 }, (_, h) => ({ dow: d, hour: h + 7, jobs: Math.round(Math.max(0, Math.sin((h) / 3) * 6 + (d === 5 || d === 6 ? 3 : 0))) }))).flat();
const CANCEL: CancellationsData = { total: 432, cancelled: 18, rate: 0.042, prevRate: 0.05, byReason: [{ reason: "too_far", count: 7 }, { reason: "sick", count: 5 }, { reason: "expired", count: 3 }, { reason: "not_recorded", count: 3 }] };

export default function AnalyticsPreviewPage() {
  const [preset, setPreset] = useState<RangePreset>("30d");
  const kpis = buildKpis(SUMMARY, SERIES, true);
  const insights = deriveInsights({ summary: SUMMARY, serviceMix: MIX, leaderboard: LEADERS, cancellations: CANCEL });
  return (
    <OperatorShell active="analytics" onNewBooking={() => {}}>
      <OperatorAnalyticsView
        preset={preset} onPresetChange={setPreset} kpis={kpis} summary={SUMMARY} series={SERIES}
        runRateSpark={SERIES.map((p) => (p.collectedCents ?? 0) / 100)} serviceMix={MIX} leaderboard={LEADERS}
        demand={DEMAND} insightsSlot={<InsightsPanel insights={insights} />} animate onExport={() => {}}
      />
    </OperatorShell>
  );
}
