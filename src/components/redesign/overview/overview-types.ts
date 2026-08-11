// Display shapes the Overview View renders. The hook wrapper (Task 6) maps real
// hook data into these; the dev preview supplies mock literals.

export type OverviewKpis = {
  todayJobs: number;
  inProgress: number;
  awaitingApproval: number;
  /** Integer cents (T2-11: payment_stats is cents-precise and refund-netted).
   *  null when the viewer lacks can_view_payments (manager); then the 4th KPI
   *  tile is dropped entirely (the strip reflows to 3 tiles, no substitute). */
  revenueThisMonthCents: number | null;
  canViewPayments: boolean;
  /** Gates the operational tiles' click-through to /admin/bookings (mirrors the
   *  can_view_bookings route gate). When false the tiles render non-clickable. */
  canViewBookings: boolean;
};

export type QueueItem = {
  id: string;
  title: string; // property / customer
  subtitle: string; // date·time / service
};

export type TodayItemStatus = "done" | "live" | "unassigned" | "upcoming";

/** One row of the unified Today card. `elapsed` is preformatted ("42 min") and
 *  present only for live rows whose started_at is known. */
export type TodayItem = {
  id: string;
  time: string; // "8:00am"
  title: string; // "Property · Service"
  subtitle: string; // cleaner short name, with a date hint for non-today live rows
  status: TodayItemStatus;
  elapsed?: string | null;
};

export function fmtTime(t: string | undefined): string {
  const [hh, mm] = (t ?? "").split(":");
  let h = parseInt(hh ?? "0", 10);
  if (Number.isNaN(h)) return t ?? "";
  const m = mm ?? "00";
  const ap = h >= 12 ? "pm" : "am";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m}${ap}`;
}

export function fmtShortDate(s: string): string {
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function formatUsdCompact(dollars: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(
    dollars
  );
}

/** Time-of-day greeting + long date label for the Overview header. Pure: the
 *  caller passes `now` (client-side in the real wrapper, avoiding SSR/hydration
 *  time drift). */
export function getGreeting(firstName: string | undefined, now: Date): { greeting: string; dateLabel: string } {
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const greeting = firstName ? `${part}, ${firstName}` : part;
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return { greeting, dateLabel };
}
