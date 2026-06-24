"use client";
import type { CancellationsData } from "../analytics-types";
import { routingDeclineReasonLabel } from "@/types";

export function Cancellations({ data }: { data: CancellationsData | null }) {
  if (!data) return <div className="grid h-24 place-items-center text-sm text-muted-foreground">No data</div>;
  const down = data.rate <= data.prevRate;
  const max = Math.max(1, ...data.byReason.map((r) => r.count));
  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2.5">
        <span className="text-2xl font-extrabold tnum text-critical-700 dark:text-destructive">{(data.rate * 100).toFixed(1)}%</span>
        <span className={down ? "text-xs font-semibold text-positive-700 dark:text-positive" : "text-xs font-semibold text-critical-700 dark:text-destructive"}>{down ? "down" : "up"} vs prev</span>
        <span className="ml-auto text-xs text-muted-foreground">{data.cancelled} of {data.total} jobs</span>
      </div>
      <div className="space-y-2.5">
        {data.byReason.map((r) => (
          <div key={r.reason}>
            <div className="mb-1 flex justify-between text-[12.5px]"><span className="font-semibold">{r.reason === "not_recorded" ? "Reason not recorded" : routingDeclineReasonLabel(r.reason)}</span><span className="text-muted-foreground tnum">{r.count}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--chart-4)]" style={{ width: `${(r.count / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
