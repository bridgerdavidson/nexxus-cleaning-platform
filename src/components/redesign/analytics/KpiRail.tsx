"use client";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { KPI_ICONS } from "./analytics-presenters";
import { cn } from "@/lib/utils";
import type { Kpi } from "./analytics-types";

// Clean stat cards: value-forward, trend arrow + delta as inline colored text,
// muted context line. No sparkline — the per-tile trend series is usually too
// sparse for a cleaning business to render as anything but a flat baseline
// (ui-ux-pro-max: <4 data points -> use a stat card). Trend lives in the hero.
export function KpiRail({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {kpis.map((k) => {
        const Icon = KPI_ICONS[k.iconKey];
        const prefix = k.iconKey === "revenue" || k.iconKey === "booked" || k.iconKey === "avg" ? "$" : "";
        return (
          <Card key={k.key} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground">{k.label}</p>
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-ink dark:bg-brand-950">
                <Icon className="size-4" />
              </span>
            </div>
            <p className="mt-4 text-[28px] font-extrabold leading-none tracking-tight tnum">
              {k.rawValue == null ? "-" : <AnimatedNumber value={k.rawValue} prefix={prefix} suffix={k.unit} />}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold leading-none">
              {k.delta ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5",
                    k.delta.tone === "good"
                      ? "text-positive-700 dark:text-positive"
                      : k.delta.tone === "bad"
                        ? "text-critical-700 dark:text-destructive"
                        : "text-muted-foreground",
                  )}
                >
                  {k.delta.dir === "up" ? <ArrowUp className="size-3.5" /> : k.delta.dir === "down" ? <ArrowDown className="size-3.5" /> : null}
                  {k.delta.label}
                </span>
              ) : null}
              {k.context ? <span className="font-medium text-muted-foreground">{k.context}</span> : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
