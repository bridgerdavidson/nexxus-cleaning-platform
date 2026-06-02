/**
 * Manual-capture authorization for an ORG self-pay cleaning.
 *
 * Sibling of `authorize.ts`, with two deliberate differences:
 *   - the customer is the ORG's platform self-pay Customer (its company card), not a homeowner;
 *   - there is NO `on_behalf_of` — the org is paying for its OWN cleaning, so there is no
 *     separate merchant of record. As with the tenant flow there is NO `transfer_data`: the
 *     funds land on the PLATFORM balance and a single transfer pays the cleaner after capture
 *     (see `settleSelfPay`). Charging a platform Customer (not the org's connected account) is
 *     what keeps the cleaner transfer a legal platform→connected move — a connected→connected
 *     transfer is forbidden by Stripe.
 *
 * The amount is the cleaner's cut GROSSED UP for Stripe's fee (see `selfPayMath`) so the cleaner
 * nets their full %. `metadata.self_pay='true'` routes the captured-charge webhook to the
 * self-pay settlement path. Idempotency key carries the re-auth attempt (reassignment re-auth).
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { transferGroupFor } from '@/lib/stripe/transfers';

export interface SelfPayAuthorizeParams {
  /** Grossed-up charge in cents (cleaner cut + Stripe fee) — see computeSelfPayAmounts. */
  chargeCents: number;
  /** Organization's platform Stripe Customer id (the self-pay company card lives here). */
  customerId: string;
  /** Saved company PaymentMethod to charge. */
  paymentMethodId: string;
  appointmentId: string;
  organizationId: string;
  /** 0 for the first authorization; incremented on re-auth (e.g. cleaner reassignment). */
  reauthAttempt?: number;
}

export async function createSelfPayAuthorization(
  p: SelfPayAuthorizeParams,
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();

  const params: Stripe.PaymentIntentCreateParams = {
    amount: p.chargeCents,
    currency: 'usd',
    customer: p.customerId,
    payment_method: p.paymentMethodId,
    off_session: true,
    confirm: true,
    capture_method: 'manual',
    // No on_behalf_of (the org pays for its own cleaning) and no transfer_data: funds settle to
    // the PLATFORM balance and settleSelfPay transfers the cleaner's cut after capture.
    transfer_group: transferGroupFor(p.appointmentId),
    metadata: {
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      self_pay: 'true',
      source: 'nexxus-cleaning-platform',
    },
  };

  return stripe.paymentIntents.create(params, {
    idempotencyKey: `selfpay-auth-${p.appointmentId}-${p.reauthAttempt ?? 0}`,
  });
}
