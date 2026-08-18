// src/components/redesign/cleaner/earnings/earnings-types.ts
import type {
  AwaitingPaymentRow,
  CleanerHeldPayoutRow,
  CleanerPaidPayoutRow,
  CleanerStats,
} from "@/hooks/useCleanerData";
import type { CleanerPayoutModel } from "@/components/redesign/cleaner/today/today-types";

/** Mirrors cleanerStatusKind()'s output (computed in the Container). */
export type ConnectKind = "loading" | "inactive" | "pending" | "active";

/** Top-level screen mode. "connect" covers every Stripe-enabled contractor state. */
export type EarningsMode = "stripe-disabled" | "employee" | "connect";

export type ClearingSettleKind = "ach" | "card" | "unknown";

export interface ClearingRow {
  id: string;
  appointmentId: string | null;
  serviceLabel: string;
  customerLabel: string;
  /** scheduledDate when present, else createdAt; formatted in the View. */
  dateRaw: string | null;
  /** The cleaner's own cut, in whole dollars (privacy-safe). */
  cutDollars: number;
  settleKind: ClearingSettleKind;
}

/**
 * A payout the cleaner is owed but hasn't received: "held" (pending), "approved" (about to send),
 * or "failed" (transfer errored). A subset of the payments `PayoutBadgeKey` union by design, so the
 * View can hand `kind` straight to `PayoutStatusBadge`.
 */
export type HeldKind = "held" | "approved" | "failed";

export interface HeldPayoutRow {
  id: string;
  appointmentId: string | null;
  serviceLabel: string;
  customerLabel: string;
  /** scheduledDate when present, else createdAt; formatted in the View. */
  dateRaw: string | null;
  /** The cleaner's own payout amount, in dollars (privacy-safe). */
  amountDollars: number;
  kind: HeldKind;
}

/** Settled history: 'paid' = sent to their Stripe balance, 'bank_paid' = deposited. */
export type PaidKind = "paid" | "bank_paid";

export interface PaidPayoutRow {
  id: string;
  appointmentId: string | null;
  serviceLabel: string;
  customerLabel: string;
  /** scheduledDate when present, else paidAt, else createdAt; formatted in the View. */
  dateRaw: string | null;
  /** The cleaner's own payout amount, in dollars (privacy-safe). */
  amountDollars: number;
  kind: PaidKind;
}

export interface ActivityCounts {
  thisWeek: number;
  completed: number;
  upcoming: number;
}

export interface EarningsData {
  mode: EarningsMode;
  connectKind: ConnectKind;
  clearing: ClearingRow[];
  /** Held/approved/failed payout rows (Hop 2). Split into "Needs attention" + "Held" in the View. */
  held: HeldPayoutRow[];
  /** Recent settled payouts, newest first (capped server-side). Excluded from owedDollars. */
  paid: PaidPayoutRow[];
  /**
   * Total the cleaner is owed but hasn't received: the sum of their own clearing cuts + held/failed
   * payout amounts. Derived from per-row cleaner cuts ONLY, never from the org-derived stats
   * aggregates (totalEarnings/pendingPayouts), which the privacy test forbids leaking here.
   */
  owedDollars: number;
  counts: ActivityCounts;
}

export interface DeriveEarningsInput {
  stripeEnabled: boolean;
  payoutModel: CleanerPayoutModel;
  connectKind: ConnectKind;
  awaiting: AwaitingPaymentRow[] | undefined;
  heldPayouts: CleanerHeldPayoutRow[] | undefined;
  paidPayouts: CleanerPaidPayoutRow[] | undefined;
  stats: CleanerStats | undefined;
}
