/**
 * Manual-capture authorization (the "just-in-time authorize" leg).
 *
 * Creates a manual-capture PaymentIntent ON THE PLATFORM that makes the TENANT the merchant of
 * record (`on_behalf_of`) and tags it with the job's `transfer_group`. It deliberately does NOT
 * set `transfer_data` — this is the "separate charges and transfers" model: funds settle to the
 * PLATFORM balance on capture, then the platform fans them out with explicit transfers to the
 * tenant and (Scenario 1) the cleaner. Destination charges can route to only one connected
 * account and can't be chained to a second (connected→connected transfers are forbidden), so a
 * platform-held charge + separate transfers is the only Stripe-supported way to split one
 * payment across two connected accounts.
 *
 * The card is held (requires_capture) until the job completes, then captured. The cleaner/tenant
 * split is computed and transferred AFTER capture (see `settleCleanerPayout`), on the actually
 * captured amount.
 *
 * Idempotency key includes the re-auth attempt so a legitimate re-authorization (after a hold
 * expired) isn't collapsed into the original, while retries of the same attempt are.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { transferGroupFor } from '@/lib/stripe/transfers';

export interface AuthorizeParams {
  grossCents: number;
  /** Homeowner's platform Stripe Customer id. */
  customerId: string;
  /** Saved PaymentMethod to charge. */
  paymentMethodId: string;
  /** Tenant org's connected account — merchant of record + eventual settlement destination. */
  tenantAccountId: string;
  appointmentId: string;
  organizationId: string;
  /** 0 for the first authorization; incremented on re-auth after a hold expires. */
  reauthAttempt?: number;
}

export async function createDestinationAuthorization(
  p: AuthorizeParams,
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();

  const params: Stripe.PaymentIntentCreateParams = {
    amount: p.grossCents,
    currency: 'usd',
    customer: p.customerId,
    payment_method: p.paymentMethodId,
    off_session: true,
    confirm: true,
    capture_method: 'manual',
    // Tenant is the merchant of record (statement descriptor, settlement, liability). With no
    // transfer_data, the funds still land on the PLATFORM balance and are distributed after
    // capture via separate transfers — see settleCleanerPayout.
    on_behalf_of: p.tenantAccountId,
    transfer_group: transferGroupFor(p.appointmentId),
    metadata: {
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      source: 'nexxus-cleaning-platform',
    },
  };

  return stripe.paymentIntents.create(params, {
    idempotencyKey: `auth-${p.appointmentId}-${p.reauthAttempt ?? 0}`,
  });
}
