"use client";
import { MotionConfig, motion } from "motion/react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { AnalyticsRangeControl } from "./AnalyticsRangeControl";
import { KpiRail } from "./KpiRail";
import { RevenueComposedChart } from "./charts/RevenueComposedChart";
import { RunRateSparkline } from "./charts/RunRateSparkline";
import { RecurringDonut } from "./charts/RecurringDonut";
import { DemandHeatmap } from "./charts/DemandHeatmap";
import { ServiceMixBars } from "./charts/ServiceMixBars";
import { Leaderboard } from "./charts/Leaderboard";
import type { AnalyticsSummary, DemandCell, Kpi, LeaderRow, RangePreset, ServiceMixRow, TimeseriesPoint } from "./analytics-types";
import type { ReactNode } from "react";

export type OperatorAnalyticsViewProps = {
  preset: RangePreset;
  onPresetChange: (p: RangePreset) => void;
  kpis: Kpi[];
  summary: AnalyticsSummary | null;
  series: TimeseriesPoint[];
  runRateSpark: number[];
  serviceMix: ServiceMixRow[];
  leaderboard: LeaderRow[];
  demand: DemandCell[];
  insightsSlot: ReactNode;
  animate: boolean;
  onExport?: () => void;
};

const SECTION_MOTION = {
  initial: { opacity: 0, y: 10 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
} as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.section className="space-y-4" {...SECTION_MOTION}>
      <h2 className="flex items-center gap-3 text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground after:h-px after:flex-1 after:bg-border after:content-['']">{title}</h2>
      {children}
    </motion.section>
  );
}
function Panel({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return <Card className="p-4"><div className="mb-3"><div className="text-sm font-bold">{title}</div>{desc ? <div className="text-xs text-muted-foreground">{desc}</div> : null}</div>{children}</Card>;
}

export function OperatorAnalyticsView(p: OperatorAnalyticsViewProps) {
  return (
    <MotionConfig reducedMotion="user">
    <div className="max-w-[1700px] space-y-7">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">Compared to the previous period</p>
        </div>
        <div className="flex items-center gap-3">
          <AnalyticsRangeControl preset={p.preset} onChange={p.onPresetChange} />
          {p.onExport ? <Button variant="outline" onClick={p.onExport}><Download className="size-4" /> Export</Button> : null}
        </div>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <KpiRail kpis={p.kpis} />
      </motion.div>

      <Section title="Are we on pace?">
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Panel title="Realized vs booked revenue" desc="Cash collected vs scheduled but not yet landed">
            <RevenueComposedChart data={p.series} animate={p.animate} />
          </Panel>
          <Panel title="Insights">{p.insightsSlot}</Panel>
        </div>
      </Section>

      <Section title="What's driving revenue?">
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Run-rate & forecast" desc="Are we on pace to target?"><RunRateSparkline runRateCents={p.summary?.runRateCents ?? null} series={p.runRateSpark} animate={p.animate} /></Panel>
          <Panel title="Recurring vs one-off" desc="Predictable backbone"><RecurringDonut recurringCents={p.summary?.recurringCents ?? null} oneoffCents={p.summary?.oneoffCents ?? null} animate={p.animate} /></Panel>
          <Panel title="Revenue by service" desc="Which lines pay"><ServiceMixBars rows={p.serviceMix} /></Panel>
        </div>
      </Section>

      <Section title="Who's doing the work?">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Cleaner leaderboard" desc="Top performers this period"><Leaderboard rows={p.leaderboard} /></Panel>
          <Panel title="Demand by day & hour" desc="Busiest windows for staffing"><DemandHeatmap cells={p.demand} /></Panel>
        </div>
      </Section>
    </div>
    </MotionConfig>
  );
}
