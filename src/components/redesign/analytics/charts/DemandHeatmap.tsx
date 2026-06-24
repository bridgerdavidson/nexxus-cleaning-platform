"use client";
import { normalizeHeatmap } from "../deriveAnalytics";
import type { DemandCell } from "../analytics-types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 7am..6pm

export function DemandHeatmap({ cells }: { cells: DemandCell[] }) {
  if (!cells.length) return <div className="grid h-24 place-items-center text-sm text-muted-foreground">No bookings this period</div>;
  const rows = normalizeHeatmap(cells); // 7 rows × 24 hours, 0..1
  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `34px repeat(${HOURS.length}, 1fr)` }}>
        <div />
        {HOURS.map((h) => <div key={h} className="pb-0.5 text-center text-[9.5px] font-semibold text-muted-foreground">{h > 12 ? h - 12 : h}</div>)}
        {rows.map((r) => (
          <FragmentRow key={r.dow} label={DAYS[r.dow]} hours={HOURS.map((h) => r.hours[h])} />
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground"><span>Quiet</span>{[0.1, 0.3, 0.5, 0.7, 0.9, 1].map((a) => <span key={a} className="h-2.5 w-3.5 rounded-sm" style={{ background: `rgb(1 80 252 / ${a})` }} />)}<span>Busy</span></div>
    </div>
  );
}
function FragmentRow({ label, hours }: { label: string; hours: number[] }) {
  return (
    <>
      <div className="flex items-center text-[10.5px] font-bold text-muted-foreground">{label}</div>
      {hours.map((v, i) => <div key={i} className="aspect-square rounded-[6px]" style={{ background: `rgb(1 80 252 / ${(0.06 + (v || 0) * 0.94).toFixed(2)})` }} />)}
    </>
  );
}
