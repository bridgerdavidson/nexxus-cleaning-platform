import { money2 } from "./payments-presenters";

/** The two headline Payments KPI tiles (both from payment_stats). Queued payouts
 *  lives in the "Needs you now" band and balance/next-payout in "Your money", so
 *  the KPIs stay focused on revenue. Pure formatting. */
export function paymentsKpiItems(a: {
  totalRevenue: number;
  thisMonth: number;
}): { label: string; value: string }[] {
  return [
    { label: "Revenue this month", value: money2(a.thisMonth) },
    { label: "Total revenue", value: money2(a.totalRevenue) },
  ];
}
