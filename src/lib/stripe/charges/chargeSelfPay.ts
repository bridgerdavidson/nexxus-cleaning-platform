/**
 * Immediate self-pay charge for a COMPLETED org self-pay appointment.
 *
 * A company card is SAVED (not held) at booking, and this creates + auto-captures the charge on the
 * org's company card once the job is completed (also reused for charge-now recovery).
 *
 * There is NO `capture_method: 'manual'` (captures immediately) and NO `on_behalf_of`/`transfer_data`
 * (the org pays for its own cleaning): the customer is the ORG's platform self-pay Customer, funds
 * land on the PLATFORM balance, and `settleSelfPay` pays the cleaner the exact cut after the charge
 * succeeds (routed via `metadata.self_pay='true'` on payment_intent.succeeded).
 *
 * The idempotency key is `selfpay-charge-{appointmentId}-{reauthAttempt}`, so a fresh attempt after a
 * prior decline isn't collapsed into the original.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { transferGroupFor } from '@/lib/stripe/transfers';

export interface SelfPayChargeParams {
  /** Grossed-up charge in cents (cleaner cut + Stripe fee); see computeSelfPayAmounts. */
  chargeCents: number;
  /** Organization's platform Stripe Customer id (the self-pay company card lives here). */
  customerId: string;
  /** Saved company PaymentMethod to charge. */
  paymentMethodId: string;
  appointmentId: string;
  organizationId: string;
  /** 0 for the first attempt; incremented on retry after a prior decline so the key is fresh. */
  reauthAttempt?: number;
}

export async function createSelfPayCharge(p: SelfPayChargeParams): Promise<Stripe.PaymentIntent> {
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
