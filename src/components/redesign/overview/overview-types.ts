// Display shapes the Overview View renders. The hook wrapper (Task 6) maps real
// hook data into these; the dev preview supplies mock literals.

export type OverviewKpis = {
  todayJobs: number;
  inProgress: number;
  awaitingApproval: number;
  /** null when the viewer lacks can_view_payments (manager); then the 4th tile shows Unassigned. */
  revenueThisMonthCents: number | null;
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

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.round(cents / 100)
  );
}

export function formatUsdCompact(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(
    cents / 100
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
