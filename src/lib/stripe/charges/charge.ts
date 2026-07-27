/**
 * Immediate destination charge: a card is SAVED (not held) at booking, and this creates +
 * auto-captures the charge on the homeowner's saved card once the job is completed. Also reused for
 * the cancellation/no-show fee (the caller passes a distinct `keyPrefix`).
 *
 * There is NO `capture_method: 'manual'`, so the PaymentIntent captures immediately. The charge is
 * platform-held with the TENANT as merchant of record (`on_behalf_of`, no `transfer_data`) so the
 * cleaner/tenant split runs as separate transfers after the charge succeeds (see
 * `settleCleanerPayout`, routed on `payment_intent.succeeded` because `on_behalf_of` is set). A
 * connected-to-connected transfer is forbidden, so platform-held + separate transfers is the only
 * way to split one payment across two connected accounts.
 *
 * The idempotency key is `{keyPrefix}-{appointmentId}-{reauthAttempt}` (default prefix 'charge'; the
 * cancel-fee path passes 'cancelfee'), so a fresh attempt after a prior decline isn't collapsed into
 * the original and the two charge kinds never collide.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { transferGroupFor } from '@/lib/stripe/transfers';

export interface ChargeParams {
  grossCents: number;
  /** Homeowner's platform Stripe Customer id. */
  customerId: string;
  /** Saved PaymentMethod to charge. */
  paymentMethodId: string;
  /** Tenant org's connected account: merchant of record + eventual settlement destination. */
  tenantAccountId: string;
  appointmentId: string;
  organizationId: string;
  /** 0 for the first attempt; incremented on retry after a prior decline so the key is fresh. */
  reauthAttempt?: number;
  /**
   * Idempotency-key prefix, default 'charge'. The cancellation-fee charge passes 'cancelfee' so its
   * key never collides with the completion charge for the same appointment.
   */
  keyPrefix?: string;
  /**
   * Payer's email, so Stripe sends its own emailed receipt for this charge (audit T2-1). Omitted
   * when the payer has no email on file; the in-app notification is the primary record either way.
   */
  receiptEmail?: string;
}

export async function createDestinationCharge(p: ChargeParams): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();

  const params: Stripe.PaymentIntentCreateParams = {
    amount: p.grossCents,
    currency: 'usd',
    customer: p.customerId,
    payment_method: p.paymentMethodId,
    off_session: true,
    confirm: true,
    // No capture_method: the charge captures immediately (the job is already done). Tenant is the
    // merchant of record; funds land on the PLATFORM balance and are distributed via separate
    // transfers after the charge succeeds (see settleCleanerPayout).
    on_behalf_of: p.tenantAccountId,
    transfer_group: transferGroupFor(p.appointmentId),
    ...(p.receiptEmail ? { receipt_email: p.receiptEmail } : {}),
    metadata: {
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      // Lets the webhook tell a job debit (refund it if the job was cancelled mid-flight)
      // from the cancellation fee (which legitimately settles on a cancelled job).
      charge_kind: p.keyPrefix === 'cancelfee' ? 'cancellation_fee' : 'completion',
      source: 'nexxus-cleaning-platform',
    },
  };

  return stripe.paymentIntents.create(params, {
    idempotencyKey: `${p.keyPrefix ?? 'charge'}-${p.appointmentId}-${p.reauthAttempt ?? 0}`,
  });
}
