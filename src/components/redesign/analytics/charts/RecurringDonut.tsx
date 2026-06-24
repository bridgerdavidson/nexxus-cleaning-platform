"use client";
import { Cell, Pie, PieChart } from "recharts";
import { ChartFrame } from "@/components/ui/chart";

export function RecurringDonut({ recurringCents, oneoffCents, animate }: { recurringCents: number | null; oneoffCents: number | null; animate: boolean }) {
  const r = recurringCents ?? 0, o = oneoffCents ?? 0;
  if (r + o === 0) return <div className="grid h-[160px] place-items-center text-sm text-muted-foreground">No revenue yet</div>;
  const share = Math.round((r / (r + o)) * 100);
  const data = [{ name: "Recurring", value: r }, { name: "One-off", value: o }];
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[150px] w-[150px]">
        <ChartFrame height={150}>
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={50} outerRadius={66} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={animate}>
              <Cell fill="var(--chart-1)" /><Cell fill="hsl(var(--muted))" />
            </Pie>
          </PieChart>
        </ChartFrame>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center"><div className="text-2xl font-extrabold tnum">{share}%</div><div className="text-[11px] text-muted-foreground">recurring</div></div>
        </div>
      </div>
      <div className="space-y-2 text-sm">
        <Legend color="var(--chart-1)" label="Recurring" value={`$${Math.round(r / 100).toLocaleString()}`} />
        <Legend color="hsl(var(--muted))" label="One-off" value={`$${Math.round(o / 100).toLocaleString()}`} />
      </div>
    </div>
  );
}
function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return <div className="flex items-center gap-2"><span className="size-3 rounded" style={{ background: color }} /><span className="text-muted-foreground">{label}</span><span className="ml-auto font-bold tnum">{value}</span></div>;
}
