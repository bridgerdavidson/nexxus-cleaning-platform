import { money2 } from "./payments-presenters";

/** The five Payments KPI tiles: three money figures (from payment_stats) + two
 *  ledger totals (from the paginated query's exact count). Pure formatting. */
export function paymentsKpiItems(a: {
  totalRevenue: number;
  thisMonth: number;
  queuedPayouts: number;
  txnCount: number;
  payoutCount: number;
}): { label: string; value: string }[] {
  return [
    { label: "Revenue", value: money2(a.totalRevenue) },
    { label: "This month", value: money2(a.thisMonth) },
    { label: "Queued payouts", value: money2(a.queuedPayouts) },
    { label: "Transactions", value: String(a.txnCount) },
    { label: "Payouts", value: String(a.payoutCount) },
  ];
}
