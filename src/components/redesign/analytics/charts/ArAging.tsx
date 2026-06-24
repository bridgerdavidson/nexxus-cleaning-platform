"use client";
import type { AnalyticsSummary } from "../analytics-types";
import { bucketAging } from "../deriveAnalytics";

const TONE: Record<string, string> = { positive: "bg-[var(--chart-3)]", info: "bg-[var(--chart-2)]", caution: "bg-[var(--chart-4)]", critical: "bg-[var(--chart-5)]" };

export function ArAging({ summary }: { summary: AnalyticsSummary | null }) {
  const buckets = summary ? bucketAging(summary) : [];
  if (!buckets.length) return <div className="grid h-24 place-items-center text-sm text-muted-foreground">No outstanding balances</div>;
  const total = buckets.reduce((a, b) => a + b.dollars, 0);
  const max = Math.max(1, ...buckets.map((b) => b.dollars));
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2.5"><span className="text-2xl font-extrabold tnum">${total.toLocaleString()}</span><span className="text-xs font-semibold text-muted-foreground">owed</span></div>
      <div className="flex h-[150px] items-end gap-3.5 pt-2">
        {buckets.map((b) => (
          <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
            <span className="text-[12.5px] font-extrabold tnum">${(b.dollars / 1000).toFixed(1)}k</span>
            <div className={`w-full rounded-t-lg ${TONE[b.tone]}`} style={{ height: `${(b.dollars / max) * 100}%` }} />
            <span className="text-[11px] font-semibold text-muted-foreground">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
