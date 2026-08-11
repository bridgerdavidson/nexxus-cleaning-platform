import { money2 } from "./payments-presenters";

/** The two headline Payments KPI tiles (both from payment_stats). Queued payouts
 *  lives in the "Needs you now" band and balance/next-payout in "Your money", so
 *  the KPIs stay focused on revenue. Amounts are integer CENTS (T2-11: the RPC
 *  is cents-precise and refund-netted). Pure formatting. */
export function paymentsKpiItems(a: {
  totalRevenueCents: number;
  thisMonthCents: number;
}): { label: string; value: string }[] {
  return [
    { label: "Revenue this month", value: money2(a.thisMonthCents / 100) },
    { label: "Total revenue", value: money2(a.totalRevenueCents / 100) },
  ];
}
