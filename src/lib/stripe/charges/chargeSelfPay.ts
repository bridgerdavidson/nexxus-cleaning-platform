/**
 * Immediate self-pay charge (the "charge now" leg) for a COMPLETED org self-pay appointment whose
 * company-card authorization failed and was never held.
 *
 * Sibling of `authorizeSelfPay.ts` with one deliberate difference: there is NO
 * `capture_method: 'manual'`, so the PaymentIntent captures automatically (charge now) instead of
 * placing a hold. Everything else matches: the customer is the ORG's platform self-pay Customer (its
 * company card), there is NO `on_behalf_of` and NO `transfer_data` (the org pays for its own
 * cleaning), funds land on the PLATFORM balance, and `settleSelfPay` pays the cleaner the exact cut
 * after the charge succeeds (routed via `metadata.self_pay='true'` on payment_intent.succeeded).
 *
 * The idempotency key carries the re-auth attempt and a distinct `selfpay-charge-` prefix so it
 * never collides with the authorize leg's `selfpay-auth-` key.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { transferGroupFor } from '@/lib/stripe/transfers';
import type { SelfPayAuthorizeParams } from './authorizeSelfPay';

export async function createSelfPayCharge(p: SelfPayAuthorizeParams): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();

  const params: Stripe.PaymentIntentCreateParams = {
    amount: p.chargeCents,
    currency: 'usd',
    customer: p.customerId,
    payment_method: p.paymentMethodId,
    off_session: true,
    confirm: true,
    // No capture_method (captures now) and no on_behalf_of/transfer_data: funds settle to the
    // PLATFORM balance and settleSelfPay transfers the cleaner's cut after the charge succeeds.
    transfer_group: transferGroupFor(p.appointmentId),
    metadata: {
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      self_pay: 'true',
      source: 'nexxus-cleaning-platform',
    },
  };

  return stripe.paymentIntents.create(params, {
    idempotencyKey: `selfpay-charge-${p.appointmentId}-${p.reauthAttempt ?? 0}`,
  });
}
