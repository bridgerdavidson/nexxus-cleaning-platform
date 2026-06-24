import type { AnalyticsSummary, DemandCell, Grain, Kpi, RangePreset, ResolvedRange, TimeseriesPoint } from "./analytics-types";

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }

const SPAN: Record<RangePreset, { days: number; grain: Grain }> = {
  "7d": { days: 7, grain: "day" },
  "30d": { days: 30, grain: "day" },
  "90d": { days: 90, grain: "week" },
  "12m": { days: 365, grain: "month" },
};

export function resolveRange(preset: RangePreset, today: Date): ResolvedRange {
  const { days, grain } = SPAN[preset];
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = addDays(end, -(days - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(days - 1));
  return { preset, start: iso(start), end: iso(end), prevStart: iso(prevStart), prevEnd: iso(prevEnd), grain, rangeKey: preset };
}

export function pctDelta(cur: number | null, prev: number | null, opts: { upIsGood?: boolean } = {}): { dir: "up" | "down" | "flat"; label: string; tone: "good" | "bad" | "neutral" } {
  const upIsGood = opts.upIsGood ?? true;
  if (cur == null || prev == null || prev === 0) {
    if ((cur ?? 0) === 0) return { dir: "flat", label: "0%", tone: "neutral" };
    return { dir: "up", label: "new", tone: upIsGood ? "good" : "bad" };
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  const dir = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const good = dir === "flat" ? "neutral" : (dir === "up") === upIsGood ? "good" : "bad";
  return { dir, label: `${Math.abs(pct)}%`, tone: good };
}

export function normalizeHeatmap(cells: DemandCell[]): { dow: number; hours: number[] }[] {
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of cells) if (c.dow >= 0 && c.dow < 7 && c.hour >= 0 && c.hour < 24) grid[c.dow][c.hour] = c.jobs;
  const peak = Math.max(1, ...grid.flat());
  return grid.map((hours, dow) => ({ dow, hours: hours.map((v) => v / peak) }));
}

export function bucketAging(s: AnalyticsSummary): { label: string; dollars: number; tone: "positive" | "info" | "caution" | "critical" }[] {
  if (!s.arAging) return [];
  const a = s.arAging;
  return [
    { label: "Current", dollars: Math.round(a.current / 100), tone: "positive" },
    { label: "1-7 days", dollars: Math.round(a.d1_7 / 100), tone: "info" },
    { label: "8-30 days", dollars: Math.round(a.d8_30 / 100), tone: "caution" },
    { label: "30+ days", dollars: Math.round(a.d30plus / 100), tone: "critical" },
  ];
}

function fmtMoneyShort(cents: number | null): string {
  if (cents == null) return "-";
  const d = cents / 100;
  return d >= 1000 ? `$${(d / 1000).toFixed(1)}k` : `$${Math.round(d)}`;
}

export function buildKpis(s: AnalyticsSummary, series: TimeseriesPoint[], money: boolean): Kpi[] {
  const collectedSpark = series.map((p) => (p.collectedCents ?? 0) / 100);
  const bookedSpark = series.map((p) => (p.bookedCents ?? 0) / 100);
  const jobsSpark = series.map((p) => p.jobs);
  const completion = s.jobsTotal === 0 ? 0 : Math.round((s.jobsCompleted / s.jobsTotal) * 100);
  // Only revenue has a previous-period figure to delta against; the rest carry an
  // honest muted context line instead of a fake "flat" delta badge.
  const moneyKpis: Kpi[] = money
    ? [
        { key: "revenue", label: "Revenue collected", value: fmtMoneyShort(s.revenueCents), rawValue: (s.revenueCents ?? 0) / 100, delta: pctDelta(s.revenueCents, s.revenuePrevCents), context: "vs previous", spark: collectedSpark, iconKey: "revenue", money: true },
        { key: "booked", label: "Booked pipeline", value: fmtMoneyShort(s.bookedCents), rawValue: (s.bookedCents ?? 0) / 100, context: "scheduled", spark: bookedSpark, iconKey: "booked", money: true },
        { key: "recurring", label: "Recurring share", value: `${Math.round(recurringShare(s) * 100)}%`, rawValue: Math.round(recurringShare(s) * 100), unit: "%", context: "of collected revenue", spark: [], iconKey: "recurring", money: true },
        { key: "avg", label: "Avg job value", value: fmtMoneyShort(avgJob(s)), rawValue: avgJob(s) == null ? null : Math.round(avgJob(s)! / 100), context: "per completed job", spark: [], iconKey: "avg", money: true },
      ]
    : [];
  const baseKpis: Kpi[] = [
    { key: "jobs", label: "Jobs completed", value: `${s.jobsCompleted}`, rawValue: s.jobsCompleted, context: `of ${s.jobsTotal} (${completion}%)`, spark: jobsSpark, iconKey: "jobs", money: false },
    { key: "cancel", label: "Cancel rate", value: `${(s.cancelRate * 100).toFixed(1)}%`, rawValue: +(s.cancelRate * 100).toFixed(1), unit: "%", context: `${s.cancelled} cancelled`, spark: [], iconKey: "cancel", money: false },
  ];
  // order: revenue, booked, jobs, recurring, cancel, avg (money ones interleaved when present)
  return money ? [moneyKpis[0], moneyKpis[1], baseKpis[0], moneyKpis[2], baseKpis[1], moneyKpis[3]] : baseKpis;
}

function recurringShare(s: AnalyticsSummary): number {
  const r = s.recurringCents ?? 0, o = s.oneoffCents ?? 0;
  return r + o === 0 ? 0 : r / (r + o);
}
function avgJob(s: AnalyticsSummary): number | null {
  if (s.revenueCents == null || s.jobsCompleted === 0) return null;
  return Math.round(s.revenueCents / s.jobsCompleted);
}

export function buildCsvRows(series: TimeseriesPoint[]): string[][] {
  const header = ["bucket_start", "collected", "booked", "jobs"];
  const rows = series.map((p) => [p.bucketStart, String((p.collectedCents ?? 0) / 100), String((p.bookedCents ?? 0) / 100), String(p.jobs)]);
  return [header, ...rows];
}
