"use client";
import { Area, AreaChart } from "recharts";
import { ChartFrame } from "@/components/ui/chart";
import { AnimatedNumber } from "@/components/ui/animated-number";

export function RunRateSparkline({ runRateCents, series, animate }: { runRateCents: number | null; series: number[]; animate: boolean }) {
  const rows = series.map((v, i) => ({ i, v }));
  return (
    <div className="space-y-1">
      <div className="text-[32px] font-extrabold leading-none tracking-tight tnum"><AnimatedNumber value={runRateCents == null ? null : Math.round(runRateCents / 100)} prefix="$" /></div>
      <div className="text-xs font-semibold text-muted-foreground">Annualized run-rate, trailing 30 days</div>
      <ChartFrame height={70}>
        <AreaChart data={rows} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
          <defs><linearGradient id="rr" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.25" /><stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" /></linearGradient></defs>
          <Area dataKey="v" stroke="var(--chart-1)" strokeWidth={2.2} fill="url(#rr)" isAnimationActive={animate} />
        </AreaChart>
      </ChartFrame>
    </div>
  );
}
