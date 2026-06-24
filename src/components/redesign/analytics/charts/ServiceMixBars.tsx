"use client";
import type { ServiceMixRow } from "../analytics-types";

export function ServiceMixBars({ rows }: { rows: ServiceMixRow[] }) {
  if (!rows.length) return <Empty />;
  const max = Math.max(1, ...rows.map((r) => r.revenueCents ?? 0));
  return (
    <div className="space-y-3">
      {rows.slice(0, 6).map((r) => (
        <div key={r.serviceTypeId}>
          <div className="mb-1 flex justify-between text-[12.5px]"><span className="font-semibold">{r.name}</span><span className="text-muted-foreground tnum">{r.revenueCents == null ? "-" : `$${(r.revenueCents / 100 / 1000).toFixed(1)}k`}</span></div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${((r.revenueCents ?? 0) / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}
function Empty() { return <div className="grid h-24 place-items-center text-sm text-muted-foreground">No services billed this period</div>; }
