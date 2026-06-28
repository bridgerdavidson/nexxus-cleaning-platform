// src/components/redesign/cleaner/earnings/earnings-types.ts
import type { AwaitingPaymentRow, CleanerStats } from "@/hooks/useCleanerData";
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

export interface ActivityCounts {
  thisWeek: number;
  completed: number;
  upcoming: number;
}

export interface EarningsData {
  mode: EarningsMode;
  connectKind: ConnectKind;
  clearing: ClearingRow[];
  counts: ActivityCounts;
}

export interface DeriveEarningsInput {
  stripeEnabled: boolean;
  payoutModel: CleanerPayoutModel;
  connectKind: ConnectKind;
  awaiting: AwaitingPaymentRow[] | undefined;
  stats: CleanerStats | undefined;
}
