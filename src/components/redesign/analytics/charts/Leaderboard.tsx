"use client";
import type { LeaderRow } from "../analytics-types";
import { cn } from "@/lib/utils";

const MEDAL = ["bg-amber-400 text-amber-950", "bg-slate-300 text-slate-700", "bg-orange-300 text-orange-900"];

export function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  if (!rows.length) return <div className="grid h-24 place-items-center text-sm text-muted-foreground">No completed jobs this period</div>;
  const max = Math.max(1, ...rows.map((r) => r.revenueCents ?? 0));
  return (
    <div className="divide-y divide-border">
      {rows.slice(0, 6).map((r, i) => (
        <div key={r.cleanerId} className="grid grid-cols-[24px_1fr_auto] items-center gap-3 py-2.5">
          <span className={cn("grid size-6 place-items-center rounded-md text-xs font-extrabold", MEDAL[i] ?? "bg-muted text-muted-foreground")}>{i + 1}</span>
          <div>
            <div className="text-[13px] font-bold">{r.name}</div>
            <div className="text-[11.5px] text-muted-foreground">{r.jobs} jobs{r.avgRating != null ? ` · ${r.avgRating.toFixed(1)}★` : ""}</div>
            <div className="mt-1.5 h-[5px] w-32 overflow-hidden rounded bg-muted"><span className="block h-full rounded bg-[var(--chart-1)]" style={{ width: `${((r.revenueCents ?? 0) / max) * 100}%` }} /></div>
          </div>
          <span className="text-sm font-extrabold tnum">{r.revenueCents == null ? "-" : `$${Math.round(r.revenueCents / 100).toLocaleString()}`}</span>
        </div>
      ))}
    </div>
  );
}
