// src/hooks/homeownerPaymentStatus.ts
// Deterministic collapse of the many payment rows an appointment can have into the single
// payment_status the homeowner UI shows. An appointment can carry more than one payments row
// (a manual "record payment" row coexisting with a failed Stripe attempt, a retry, a refund),
// and the raw query has no ordering, so a plain last-write-wins reduce is non-deterministic and
// can flip the recovery card between "Paid" and "Payment failed" across refetches. Precedence
// makes it stable AND never alarms a settled customer: a collected payment (paid/refunded) always
// wins over a stray failed/pending row.

export type HomeownerPaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

// High to low: refunded (money returned, latest lifecycle state) > paid (collected) >
// pending (in progress) > failed (needs attention, only when nothing better exists).
const RANK: Record<HomeownerPaymentStatus, number> = {
  refunded: 4,
  paid: 3,
  pending: 2,
  failed: 1,
};

/** Ordering weight for a raw status string; unknown statuses rank below every known one. */
export function paymentStatusRank(status: string | null | undefined): number {
  if (!status) return -1;
  return RANK[status as HomeownerPaymentStatus] ?? 0;
}

/**
 * The status that should win between the one already chosen for an appointment and a new candidate
 * row. Higher rank wins; on a tie the incumbent is kept (so, iterating newest-first, the most
 * recent row wins ties). Reduce-friendly: `acc[id] = preferredPaymentStatus(acc[id], row.status)`.
 */
export function preferredPaymentStatus(
  current: string | null | undefined,
  next: string | null | undefined,
): string | null {
  if (!current) return next ?? null;
  if (!next) return current;
  return paymentStatusRank(next) > paymentStatusRank(current) ? next : current;
}
