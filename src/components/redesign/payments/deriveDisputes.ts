import type { DisputeBadgeKey, DisputeDeadlineUrgency, DisputeRowVM, DisputeDetailVM } from "./payments-types";
import { deriveDisputeBadge } from "./derivePaymentsBadges";
import { money2, longDate, methodLabel } from "./payments-presenters";

// Pure logic for the disputes (chargebacks) surface. No React or data-layer
// dependency so it unit-tests in isolation (mirrors derivePayments.ts). Uses a
// structural subset of AdminDispute so tests build fixtures by hand and the
// container passes its concrete AdminDispute[] straight through.

/** Minimal structural subset of a dispute row the pure helpers need. */
export type DisputeLike = {
  id: string;
  amount: number; // CENTS (Stripe dispute.amount)
  status: string;
  reason: string | null;
  evidence_due_by: string | null;
  created_at: string;
  payment_id: string | null;
  stripe_dispute_id: string;
  payment: {
    payment_method?: string;
    is_self_pay?: boolean;
    appointment: {
      scheduled_date: string;
      homeowner_id: string | null;
      homeowner: { first_name: string; last_name: string } | null;
      service_type: { name: string } | null;
    } | null;
  } | null;
};

/** Terminal Stripe dispute states: money is settled, no operator action left. */
const TERMINAL_STATUSES = new Set(["won", "lost", "warning_closed", "prevented"]);

/** Open = still actionable (needs a response, or under review). Anything not
 *  explicitly terminal counts as open so a new/unknown status never hides. */
export function isDisputeOpen(status: string): boolean {
  return !TERMINAL_STATUSES.has(status);
}

/** Evidence deadline pressure, for the "Respond by" pill tone. */
const SOON_MS = 72 * 60 * 60 * 1000; // 72 hours

export function disputeDeadlineUrgency(
  evidenceDueBy: string | null,
  now: number,
): DisputeDeadlineUrgency {
  if (!evidenceDueBy) return "none";
  const due = new Date(evidenceDueBy).getTime();
  if (Number.isNaN(due)) return "none";
  if (due <= now) return "overdue";
  if (due - now <= SOON_MS) return "soon";
  return "later";
}

const REASON_LABELS: Record<string, string> = {
  bank_cannot_process: "Bank cannot process",
  check_returned: "Check returned",
  credit_not_processed: "Credit not processed",
  customer_initiated: "Customer initiated",
  debit_not_authorized: "Debit not authorized",
  duplicate: "Duplicate charge",
  fraudulent: "Fraudulent",
  general: "General",
  incorrect_account_details: "Incorrect account details",
  insufficient_funds: "Insufficient funds",
  noncompliant: "Noncompliant",
  product_not_received: "Product not received",
  product_unacceptable: "Product unacceptable",
  subscription_canceled: "Subscription canceled",
  unrecognized: "Unrecognized charge",
};

/** Humanize Stripe's snake_case dispute reason; title-cases anything unknown. */
export function reasonLabel(reason: string | null): string {
  if (!reason) return "Not specified";
  const known = REASON_LABELS[reason];
  if (known) return known;
  return reason
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function payerOf(d: DisputeLike, orgName: string): string {
  const ho = d.payment?.appointment?.homeowner;
  const name = ho ? `${ho.first_name ?? ""} ${ho.last_name ?? ""}`.trim() : "";
  if (name) return name;
  if (d.payment?.is_self_pay) return orgName;
  return "Customer";
}

export function toDisputeRow(d: DisputeLike, orgName: string, now: number): DisputeRowVM {
  const open = isDisputeOpen(d.status);
  return {
    id: d.id,
    payer: payerOf(d, orgName),
    service: d.payment?.appointment?.service_type?.name || "Cleaning",
    amountLabel: money2(d.amount / 100),
    openedLabel: longDate(d.created_at),
    reason: reasonLabel(d.reason),
    badge: deriveDisputeBadge(d.status),
    isOpen: open,
    deadlineLabel: d.evidence_due_by ? longDate(d.evidence_due_by) : null,
    // Terminal disputes carry no deadline pressure even if a due date lingers.
    urgency: open ? disputeDeadlineUrgency(d.evidence_due_by, now) : "none",
  };
}

export function toDisputeDetail(d: DisputeLike, orgName: string, now: number): DisputeDetailVM {
  return {
    ...toDisputeRow(d, orgName, now),
    rawStatus: d.status,
    method: methodLabel(d.payment?.payment_method),
    paymentDateLabel: d.payment?.appointment?.scheduled_date
      ? longDate(d.payment.appointment.scheduled_date)
      : null,
    homeownerId: d.payment?.appointment?.homeowner_id ?? null,
    stripeDisputeId: d.stripe_dispute_id,
  };
}

/** The open disputes (soonest deadline first is already the query order). */
export function openDisputes<T extends DisputeLike>(list: T[]): T[] {
  return list.filter((d) => isDisputeOpen(d.status));
}

/** payment_ids with an OPEN dispute, so the ledger can flag those rows. */
export function openDisputedPaymentIds(list: DisputeLike[]): Set<string> {
  const ids = new Set<string>();
  for (const d of list) {
    if (d.payment_id && isDisputeOpen(d.status)) ids.add(d.payment_id);
  }
  return ids;
}

const BADGE_KEY_ORDER: Record<DisputeBadgeKey, number> = {
  needs_response: 0,
  warning: 1,
  under_review: 2,
  lost: 3,
  won: 4,
  closed: 5,
};

/** Stable badge-key sort key, exported for reuse/testing. */
export function disputeBadgeOrder(key: DisputeBadgeKey): number {
  return BADGE_KEY_ORDER[key];
}
