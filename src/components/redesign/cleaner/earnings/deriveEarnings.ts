// src/components/redesign/cleaner/earnings/deriveEarnings.ts
// React-free: no imports from any .tsx. Formatting happens in the View.
import type { AwaitingPaymentRow } from "@/hooks/useCleanerData";
import type {
  ClearingRow,
  ClearingSettleKind,
  ConnectKind,
  DeriveEarningsInput,
  EarningsData,
} from "./earnings-types";

function settleKindFromMethod(method: string | null | undefined): ClearingSettleKind {
  if (method === "ach" || method === "us_bank_account") return "ach";
  if (method === "card") return "card";
  return "unknown";
}

function toClearingRow(row: AwaitingPaymentRow): ClearingRow {
  return {
    id: row.id,
    appointmentId: row.appointment?.id ?? null,
    serviceLabel: row.appointment?.serviceName ?? "Cleaning",
    customerLabel: row.appointment?.homeownerName ?? "Customer",
    dateRaw: row.appointment?.scheduledDate ?? row.createdAt ?? null,
    cutDollars: row.cleanerCut ?? 0,
    settleKind: settleKindFromMethod(row.paymentMethod),
  };
}

export function deriveEarnings(input: DeriveEarningsInput): EarningsData {
  const { stripeEnabled, payoutModel, connectKind, awaiting, stats } = input;

  let mode: EarningsData["mode"];
  if (payoutModel === "hourly_external") mode = "employee";
  else if (!stripeEnabled) mode = "stripe-disabled";
  else mode = "connect";

  return {
    mode,
    connectKind,
    clearing: (awaiting ?? []).map(toClearingRow),
    counts: {
      thisWeek: stats?.completedThisWeek ?? 0,
      completed: stats?.completedJobs ?? 0,
      upcoming: stats?.upcomingJobs ?? 0,
    },
  };
}

/**
 * Latching reveal: once true it stays true. The Container calls this in an effect so a
 * post-activation Stripe restriction (connectKind leaving 'active') can never unmount a
 * live embed. NEVER recompute reveal as `clicked || kind === 'active'` without the prev.
 */
export function shouldReveal(prev: boolean, connectKind: ConnectKind): boolean {
  return prev || connectKind === "active";
}
