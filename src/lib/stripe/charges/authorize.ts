/**
 * Destination-charge authorization (the "just-in-time authorize" leg).
 *
 * Creates a manual-capture PaymentIntent on the platform that makes the TENANT the
 * merchant of record (`on_behalf_of`) and routes settlement to the tenant's connected
 * account (`transfer_data.destination`), with the platform keeping `application_fee_amount`
 * (0 today). The card is held (requires_capture) until the job completes, then captured.
 *
 * The cleaner's percentage payout is NOT taken here — it comes out of the tenant's
 * balance via a separate transfer after capture (Phase 3). So at this layer the split is
 * simply: platform keeps the fee, tenant receives gross − fee.
 *
 * Idempotency key includes the re-auth attempt so a legitimate re-authorization (after a
 * hold expired) isn't collapsed into the original, while retries of the same attempt are.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

export interface AuthorizeParams {
  grossCents: number;
  /** Homeowner's platform Stripe Customer id. */
  customerId: string;
  /** Saved PaymentMethod to charge. */
  paymentMethodId: string;
  /** Tenant org's connected account — merchant of record + settlement destination. */
  tenantAccountId: string;
  /** Platform application fee in cents (0 today). */
  platformFeeCents: number;
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
    on_behalf_of: p.tenantAccountId,
    transfer_data: { destination: p.tenantAccountId },
    metadata: {
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      source: 'nexxus-cleaning-platform',
    },
  };

  if (p.platformFeeCents > 0) {
    params.application_fee_amount = p.platformFeeCents;
  }

  return stripe.paymentIntents.create(params, {
    idempotencyKey: `auth-${p.appointmentId}-${p.reauthAttempt ?? 0}`,
  });
}
