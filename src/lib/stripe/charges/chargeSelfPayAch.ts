/**
 * ACH (us_bank_account) charge-at-completion for an ORG self-pay cleaning.
 *
 * Sibling of `chargeAch.ts` (homeowner ACH), with the same two deliberate differences as the
 * self-pay CARD authorization (`authorizeSelfPay.ts`):
 *   - the customer is the ORG's platform self-pay Customer (its company bank account), not a homeowner;
 *   - there is NO `on_behalf_of` and NO `transfer_data` — the org pays for its OWN cleaning, so there
 *     is no separate merchant of record. Funds land on the PLATFORM balance and a single transfer
 *     pays the cleaner after the debit settles (see `settleSelfPay`). Charging a platform Customer
 *     (not the org's connected account) keeps the cleaner transfer a legal platform→connected move.
 *
 * Bank debits have NO manual-capture hold, so unlike the self-pay card path (authorize-then-capture)
 * this both creates AND confirms the debit when the job completes. The PaymentIntent returns
 * `processing` and settles (or fails) asynchronously over ~4 business days; `payment_intent.succeeded`
 * then routes to `settleSelfPay` via `metadata.self_pay='true'`. The Nacha mandate captured when the
 * bank was saved (SetupIntent + Financial Connections) is reused automatically for the saved PM.
 *
 * The amount is the cleaner's cut GROSSED UP for the ACH fee (see `selfPayMath` with method
 * 'us_bank_account'). Idempotency key has no re-auth suffix: ACH is charged once, at completion.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { transferGroupFor } from '@/lib/stripe/transfers';

export interface SelfPayAchChargeParams {
  /** Grossed-up charge in cents (cleaner cut + ACH fee) — see computeSelfPayAmounts. */
  chargeCents: number;
  /** Organization's platform Stripe Customer id (the self-pay company bank account lives here). */
  customerId: string;
  /** Saved + verified us_bank_account PaymentMethod to debit. */
  paymentMethodId: string;
  appointmentId: string;
  organizationId: string;
}

export async function createSelfPayAchCharge(p: SelfPayAchChargeParams): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();

  const params: Stripe.PaymentIntentCreateParams = {
    amount: p.chargeCents,
    currency: 'usd',
    customer: p.customerId,
    payment_method: p.paymentMethodId,
    payment_method_types: ['us_bank_account'],
    confirm: true,
    off_session: true,
    // No on_behalf_of (the org pays for its own cleaning) and no transfer_data: funds settle to the
    // PLATFORM balance and settleSelfPay transfers the cleaner's cut once the debit succeeds.
    transfer_group: transferGroupFor(p.appointmentId),
    metadata: {
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      self_pay: 'true',
      source: 'nexxus-cleaning-platform',
    },
  };

  return stripe.paymentIntents.create(params, {
    idempotencyKey: `selfpay-ach-${p.appointmentId}`,
  });
}
