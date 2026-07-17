// Pure refund math for the operator ledger. No React/data-layer dependency so it
// unit-tests in isolation. Mirrors the refund route's cap logic exactly.

export type RefundLike = { amount: number; status: string };

/**
 * Cents already refunded OR in-flight. Only 'succeeded' and 'pending' count:
 * a 'failed'/'canceled' refund returned nothing, so it must not reduce the
 * remaining refundable (this matches `/api/payments/[id]/refund` line 77).
 */
export function sumRefundedCents(refunds: RefundLike[] | null | undefined): number {
  if (!refunds) return 0;
  return refunds.reduce(
    (sum, r) => (r.status === "succeeded" || r.status === "pending" ? sum + Number(r.amount || 0) : sum),
    0,
  );
}

export type RefundMath = {
  grossCents: number;
  refundedCents: number;
  remainingCents: number;
  /** Money has been returned/started but the payment isn't fully refunded yet. */
  partiallyRefunded: boolean;
};

/** Compute refund state for a payment. `grossDollars` is the payment amount
 *  (dollars); `refunds[].amount` is cents. */
export function refundMath(grossDollars: number, refunds: RefundLike[] | null | undefined): RefundMath {
  const grossCents = Math.round(Number(grossDollars || 0) * 100);
  const refundedCents = Math.min(sumRefundedCents(refunds), grossCents);
  const remainingCents = Math.max(grossCents - refundedCents, 0);
  return {
    grossCents,
    refundedCents,
    remainingCents,
    partiallyRefunded: refundedCents > 0 && refundedCents < grossCents,
  };
}
