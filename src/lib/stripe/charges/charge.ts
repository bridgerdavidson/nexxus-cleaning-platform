/**
 * Immediate destination charge (the "charge now" leg) for a COMPLETED appointment whose card
 * authorization failed and was never held.
 *
 * Sibling of `authorize.ts` with one deliberate difference: there is NO `capture_method: 'manual'`,
 * so the PaymentIntent captures automatically (charge now) instead of placing a hold. Everything
 * else matches the authorize leg: a platform-held charge with the TENANT as merchant of record
 * (`on_behalf_of`, no `transfer_data`) so the cleaner/tenant split runs as separate transfers after
 * the charge succeeds (see `settleCleanerPayout`, routed on `payment_intent.succeeded` because
 * `on_behalf_of` is set). A connected→connected transfer is forbidden, so platform-held + separate
 * transfers is the only way to split one payment across two connected accounts.
 *
 * The idempotency key carries the re-auth attempt (a fresh attempt after a prior decline) and a
 * distinct `charge-` prefix so it never collides with the authorize leg's `auth-` key.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { transferGroupFor } from '@/lib/stripe/transfers';
import type { AuthorizeParams } from './authorize';

export async function createDestinationCharge(p: AuthorizeParams): Promise<Stripe.PaymentIntent> {
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
    // transfers after the charge succeeds — see settleCleanerPayout.
    on_behalf_of: p.tenantAccountId,
    transfer_group: transferGroupFor(p.appointmentId),
    metadata: {
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      source: 'nexxus-cleaning-platform',
    },
  };

  return stripe.paymentIntents.create(params, {
    idempotencyKey: `charge-${p.appointmentId}-${p.reauthAttempt ?? 0}`,
  });
}
