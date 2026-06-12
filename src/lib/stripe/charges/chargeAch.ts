/**
 * ACH (us_bank_account) charge-at-completion.
 *
 * Bank debits have NO manual-capture hold, so unlike the card path (authorize-then-capture) this
 * both creates AND confirms the debit when the job completes. The PaymentIntent returns `processing`
 * and settles (or fails) asynchronously over ~4 business days; `payment_intent.succeeded` then
 * triggers the same settlement as cards. The Nacha mandate captured when the bank was saved
 * (SetupIntent + Financial Connections) is reused automatically for the saved PaymentMethod, so no
 * explicit mandate is passed here.
 *
 * Like the card path it sets `on_behalf_of` (tenant = merchant of record) and NO `transfer_data` —
 * funds land on the PLATFORM balance and are fanned out via separate transfers once the
 * PaymentIntent succeeds (see settleCleanerPayout). The cleaner is never paid before settlement.
 *
 * Idempotency key has no re-auth suffix: ACH is charged once, at completion (there is no hold to
 * expire and re-place), so a retried completion must collapse onto the same debit.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { transferGroupFor } from '@/lib/stripe/transfers';

export interface AchChargeParams {
  /** What the payer is charged, in cents (service price grossed up for the ACH fee when passthrough is on). */
  chargeCents: number;
  /** Homeowner's platform Stripe Customer id. */
  customerId: string;
  /** Saved + verified us_bank_account PaymentMethod to debit. */
  paymentMethodId: string;
  /** Tenant org's connected account — merchant of record + eventual settlement destination. */
  tenantAccountId: string;
  appointmentId: string;
  organizationId: string;
}

export async function createAchCharge(p: AchChargeParams): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();

  const params: Stripe.PaymentIntentCreateParams = {
    amount: p.chargeCents,
    currency: 'usd',
    customer: p.customerId,
    payment_method: p.paymentMethodId,
    payment_method_types: ['us_bank_account'],
    confirm: true,
    off_session: true,
    // Tenant is the merchant of record. No transfer_data: funds land on the PLATFORM balance and are
    // distributed after the debit settles via separate transfers (see settleCleanerPayout).
    on_behalf_of: p.tenantAccountId,
    transfer_group: transferGroupFor(p.appointmentId),
    metadata: {
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      charge_kind: 'completion',
      source: 'nexxus-cleaning-platform',
    },
  };

  return stripe.paymentIntents.create(params, {
    idempotencyKey: `ach-charge-${p.appointmentId}`,
  });
}
