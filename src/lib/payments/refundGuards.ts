/**
 * Settle-time refund visibility (audit H2).
 *
 * A refund can land BEFORE settlement runs: an out-of-band Dashboard refund, or a
 * `charge.refunded` webhook delivered ahead of `payment_intent.succeeded`. At that point
 * `reverseJobTransfersForRefund` no-ops (there are no transfers to unwind yet), so unless
 * settlement itself checks the charge's `amount_refunded`, the tenant and cleaner get paid out
 * of money the payer already got back.
 *
 * Reads Stripe (the source of truth for cumulative refunds) via the reconcile wrappers so tests
 * can mock one module. Returns null when Stripe can't be read — callers fall back to DB signals
 * (e.g. payments.status === 'refunded') rather than guessing zero.
 */
import { retrieveCharge, retrievePaymentIntent } from '@/lib/stripe/reconcile';

export async function chargeAmountRefundedCents(p: {
  /** The platform charge id when the caller has one (the webhook settle path). */
  platformChargeId: string | null;
  /** Fallback: resolve the charge through the PaymentIntent (reconcile/retry paths). */
  paymentIntentId: string | null;
}): Promise<number | null> {
  try {
    if (p.platformChargeId) {
      const charge = await retrieveCharge(p.platformChargeId);
      return charge.amount_refunded ?? 0;
    }
    if (p.paymentIntentId) {
      const pi = await retrievePaymentIntent(p.paymentIntentId);
      const latest = pi.latest_charge;
      if (latest && typeof latest !== 'string') return latest.amount_refunded ?? 0;
      if (typeof latest === 'string') {
        const charge = await retrieveCharge(latest);
        return charge.amount_refunded ?? 0;
      }
    }
  } catch {
    // Stripe unreadable (network, or the flag-off stub in tests): unknown, not zero.
  }
  return null;
}
