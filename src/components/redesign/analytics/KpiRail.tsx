"use client";
import { Card } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { KpiSparkline } from "./charts/KpiSparkline";
import { KPI_ICONS } from "./analytics-presenters";
import { cn } from "@/lib/utils";
import type { Kpi } from "./analytics-types";

export function KpiRail({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k) => {
        const Icon = KPI_ICONS[k.iconKey];
        const prefix = k.iconKey === "revenue" || k.iconKey === "booked" || k.iconKey === "avg" ? "$" : "";
        return (
          <Card key={k.key} className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground">{k.label}</p>
              <span className="grid size-7 place-items-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950"><Icon className="size-4" /></span>
            </div>
            <p className="mt-2 text-2xl font-extrabold tracking-tight tnum">
              {k.rawValue == null ? "-" : <AnimatedNumber value={k.rawValue} prefix={prefix} suffix={k.unit} />}
            </p>
            <div className="mt-2 flex items-center justify-between">
              {k.delta ? <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-bold", k.delta.tone === "good" ? "bg-positive-50 text-positive-700" : k.delta.tone === "bad" ? "bg-critical-50 text-critical-700" : "bg-muted text-muted-foreground")}>{k.delta.dir === "up" ? "▲" : k.delta.dir === "down" ? "▼" : ""} {k.delta.label}</span> : <span />}
              <KpiSparkline values={k.spark} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
