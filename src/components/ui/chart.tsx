"use client";
import * as React from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

// Minimal themed wrapper. Series colors are referenced in chart components as
// `var(--chart-N)`. Height is fixed by the caller; width is responsive.
export function ChartFrame({ height = 300, className, children }: { height?: number; className?: string; children: React.ReactElement }) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export const CHART_AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 11 };
export const CHART_GRID = { stroke: "hsl(var(--border))" };
