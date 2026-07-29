"use client";
import { INSIGHT_ICONS } from "./analytics-presenters";
import { cn } from "@/lib/utils";
import type { InsightVM } from "./analytics-types";

const TONE: Record<InsightVM["tone"], string> = {
  pos: "bg-positive-50 text-positive-700", warn: "bg-caution-50 text-caution-700",
  crit: "bg-critical-50 text-critical-700", brand: "bg-brand-50 text-brand-ink",
};

function renderBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) => seg.startsWith("**") ? <b key={i} className="font-bold text-foreground">{seg.slice(2, -2)}</b> : <span key={i}>{seg}</span>);
}

export function InsightsPanel({ insights }: { insights: InsightVM[] }) {
  if (!insights.length) return <p className="text-sm text-muted-foreground">Insights appear as data accrues this period.</p>;
  return (
    <div className="flex flex-col gap-3">
      {insights.map((it) => {
        const Icon = INSIGHT_ICONS[it.iconKey];
        return (
          <div key={it.id} className="flex gap-3 rounded-card border border-border bg-card p-3">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", TONE[it.tone])}><Icon className="size-4" /></span>
            <p className="text-[13px] leading-relaxed text-muted-foreground">{renderBold(it.text)}</p>
          </div>
        );
      })}
    </div>
  );
}
