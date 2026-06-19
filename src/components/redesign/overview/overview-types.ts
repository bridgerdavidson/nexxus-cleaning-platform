// Display shapes the Overview View renders. The hook wrapper (Task 6) maps real
// hook data into these; the dev preview supplies mock literals.

export type OverviewKpis = {
  todayJobs: number;
  inProgress: number;
  awaitingApproval: number;
  /** Dollars (the payment_stats RPC returns whole-dollar amounts, like the legacy UI).
   *  null when the viewer lacks can_view_payments (manager); then the 4th tile shows Unassigned. */
  revenueThisMonth: number | null;
  unassignedCount: number;
  canViewPayments: boolean;
};

export type QueueItem = {
  id: string;
  title: string; // property / customer
  subtitle: string; // date·time / service
};

export type ScheduleItem = { id: string; time: string; title: string };
export type ActiveItem = { id: string; title: string };

/** Amounts are in whole dollars (matches the payment_stats RPC + legacy UI). */
export function formatUsd(dollars: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.round(dollars)
  );
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
