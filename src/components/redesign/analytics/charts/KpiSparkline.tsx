"use client";
import { Area, AreaChart } from "recharts";

export function KpiSparkline({ values, color = "var(--chart-1)" }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  const id = `sk${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div className="h-[30px] w-[92px]">
      <AreaChart width={92} height={30} data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.22" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <Area dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false} />
      </AreaChart>
    </div>
  );
}
