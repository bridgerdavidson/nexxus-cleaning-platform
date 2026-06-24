"use client";
import { Bar, ComposedChart, ReferenceLine, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ChartFrame, CHART_AXIS, CHART_GRID } from "@/components/ui/chart";
import type { TimeseriesPoint } from "../analytics-types";

export function RevenueComposedChart({ data, targetCents, animate }: { data: TimeseriesPoint[]; targetCents?: number; animate: boolean }) {
  if (!data.length) return <EmptyChart />;
  const rows = data.map((p) => ({ x: p.bucketStart.slice(5), collected: (p.collectedCents ?? 0) / 100, pending: Math.max(0, ((p.bookedCents ?? 0) - (p.collectedCents ?? 0)) / 100) }));
  return (
    <ChartFrame height={300}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} {...CHART_GRID} />
        <XAxis dataKey="x" tickLine={false} axisLine={false} {...CHART_AXIS} />
        <YAxis tickFormatter={(v) => `$${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} tickLine={false} axisLine={false} width={48} {...CHART_AXIS} />
        <Tooltip cursor={{ fill: "hsl(var(--muted)/0.4)" }} formatter={(v) => (v == null ? "" : `$${Number(v).toLocaleString()}`)} />
        <Bar dataKey="collected" stackId="r" fill="var(--chart-1)" radius={[0, 0, 0, 0]} isAnimationActive={animate} />
        <Bar dataKey="pending" stackId="r" fill="var(--chart-2)" radius={[4, 4, 0, 0]} isAnimationActive={animate} />
        {targetCents ? <ReferenceLine y={targetCents / 100} stroke="var(--chart-4)" strokeDasharray="5 5" /> : null}
      </ComposedChart>
    </ChartFrame>
  );
}
function EmptyChart() { return <div className="grid h-[300px] place-items-center text-sm text-muted-foreground">No data for this period</div>; }
