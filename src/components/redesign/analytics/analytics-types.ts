export type RangePreset = "7d" | "30d" | "90d" | "12m";
export type Grain = "day" | "week" | "month";

export interface ResolvedRange {
  preset: RangePreset;
  start: string;      // ISO date (YYYY-MM-DD)
  end: string;
  prevStart: string;
  prevEnd: string;
  grain: Grain;
  rangeKey: string;   // stable cache key, e.g. "30d"
}

export interface AnalyticsSummary {
  revenueCents: number | null;
  revenuePrevCents: number | null;
  bookedCents: number | null;
  jobsCompleted: number;
  jobsTotal: number;
  cancelled: number;
  cancelRate: number;          // 0..1
  recurringCents: number | null;
  oneoffCents: number | null;
  runRateCents: number | null;
  forecast30Cents: number | null;
  arAging: { current: number; d1_7: number; d8_30: number; d30plus: number } | null;
}

export interface TimeseriesPoint {
  bucketStart: string;
  collectedCents: number | null;
  bookedCents: number | null;
  jobs: number;
}
export interface ServiceMixRow {
  serviceTypeId: string; name: string;
  revenueCents: number | null; jobs: number; avgTicketCents: number | null;
}
export interface LeaderRow {
  cleanerId: string; name: string; jobs: number;
  revenueCents: number | null; avgRating: number | null;
}
export interface DemandCell { dow: number; hour: number; jobs: number }
export interface CancellationsData {
  total: number; cancelled: number; rate: number; prevRate: number;
  byReason: { reason: string; count: number }[];
}

export type DeltaTone = "good" | "bad" | "neutral";
export interface Kpi {
  key: string;
  label: string;
  value: string;               // preformatted display ("$48.2k", "132", "4.2%")
  rawValue: number | null;     // for NumberFlow; null = "-"
  unit?: string;
  delta?: { dir: "up" | "down" | "flat"; label: string; tone: DeltaTone };
  context?: string;            // muted secondary line under the value (e.g. "of 27 (63%)")
  spark: number[];
  iconKey: "revenue" | "booked" | "jobs" | "recurring" | "cancel" | "avg";
  money: boolean;              // hidden entirely when viewer lacks can_view_payments
}

export interface InsightVM {
  id: string;
  tone: "pos" | "warn" | "crit" | "brand";
  iconKey: "trend" | "alert" | "repeat" | "users";
  text: string;                // may contain **bold** markers handled by the panel
}
