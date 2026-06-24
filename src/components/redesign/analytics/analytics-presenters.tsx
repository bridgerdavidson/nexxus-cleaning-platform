import { DollarSign, CalendarDays, CheckCircle2, Repeat, XCircle, TrendingUp, AlertTriangle, Users, type LucideIcon } from "lucide-react";
import type { Kpi, InsightVM } from "./analytics-types";

export function money2(cents: number | null): string {
  if (cents == null) return "-";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function pctLabel(frac: number): string { return `${(frac * 100).toFixed(1)}%`; }

export const KPI_ICONS: Record<Kpi["iconKey"], LucideIcon> = {
  revenue: DollarSign, booked: CalendarDays, jobs: CheckCircle2, recurring: Repeat, cancel: XCircle, avg: TrendingUp,
};
export const INSIGHT_ICONS: Record<InsightVM["iconKey"], LucideIcon> = {
  trend: TrendingUp, alert: AlertTriangle, repeat: Repeat, users: Users,
};
