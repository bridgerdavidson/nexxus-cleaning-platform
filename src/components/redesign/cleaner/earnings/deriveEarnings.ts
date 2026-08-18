// src/components/redesign/cleaner/earnings/deriveEarnings.ts
// React-free: no imports from any .tsx. Formatting happens in the View.
import type {
  AwaitingPaymentRow,
  CleanerHeldPayoutRow,
  CleanerPaidPayoutRow,
} from "@/hooks/useCleanerData";
import type {
  ClearingRow,
  ClearingSettleKind,
  ConnectKind,
  DeriveEarningsInput,
  EarningsData,
  HeldKind,
  HeldPayoutRow,
  PaidPayoutRow,
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

function heldKindFromStatus(status: CleanerHeldPayoutRow["status"]): HeldKind {
  if (status === "failed") return "failed";
  if (status === "approved") return "approved";
  return "held"; // pending
}

function toHeldRow(row: CleanerHeldPayoutRow): HeldPayoutRow {
  return {
    id: row.id,
    appointmentId: row.appointment?.id ?? null,
    serviceLabel: row.appointment?.serviceName ?? "Cleaning",
    customerLabel: row.appointment?.homeownerName ?? "Customer",
    dateRaw: row.appointment?.scheduledDate ?? row.createdAt ?? null,
    amountDollars: row.amount ?? 0,
    kind: heldKindFromStatus(row.status),
  };
}

function toPaidRow(row: CleanerPaidPayoutRow): PaidPayoutRow {
  return {
    id: row.id,
    appointmentId: row.appointment?.id ?? null,
    serviceLabel: row.appointment?.serviceName ?? "Cleaning",
    customerLabel: row.appointment?.homeownerName ?? "Customer",
    dateRaw: row.appointment?.scheduledDate ?? row.paidAt ?? row.createdAt ?? null,
    amountDollars: row.amount ?? 0,
    kind: row.status,
  };
}

export function deriveEarnings(input: DeriveEarningsInput): EarningsData {
  const { stripeEnabled, payoutModel, connectKind, awaiting, heldPayouts, paidPayouts, stats } =
    input;

  let mode: EarningsData["mode"];
  if (payoutModel === "hourly_external") mode = "employee";
  else if (!stripeEnabled) mode = "stripe-disabled";
  else mode = "connect";

  const clearing = (awaiting ?? []).map(toClearingRow);
  const held = (heldPayouts ?? []).map(toHeldRow);
  const paid = (paidPayouts ?? []).map(toPaidRow);

  // Owed = everything earned but not yet received. Summed from the cleaner's OWN cut rows
  // (clearing cuts + held/failed payout amounts), never from the org-derived stats aggregates.
  // Paid history is already received and never counts toward owed.
  const owedDollars =
    clearing.reduce((sum, r) => sum + (r.cutDollars || 0), 0) +
    held.reduce((sum, r) => sum + (r.amountDollars || 0), 0);

  return {
    mode,
    connectKind,
    clearing,
    held,
    paid,
    owedDollars,
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
