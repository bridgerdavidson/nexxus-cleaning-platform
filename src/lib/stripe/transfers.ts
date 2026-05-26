/**
 * Tenant → cleaner transfers (Phase 3, marketplace Scenario 1).
 *
 * After a destination charge is captured, the tenant holds (gross − platform fee). The
 * cleaner's percentage is then transferred FROM THE TENANT'S balance to the cleaner's
 * connected account — a transfer created on the tenant account (`stripeAccount: tenant`).
 *
 * We source it from the tenant's destination-payment charge (`source_transaction`) so the
 * exact funds the tenant received back the cleaner payout (no reliance on general
 * available balance). Idempotency key `cleaner-payout-${appointmentId}` makes webhook
 * retries safe.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

/**
 * Given the platform charge id from the PaymentIntent, resolve the charge id as it
 * appears ON THE TENANT's account (the destination payment) — the correct
 * `source_transaction` for the onward tenant→cleaner transfer. Returns null if it can't
 * be resolved (caller falls back to an available-balance transfer).
 */
export async function resolveTenantChargeId(platformChargeId: string): Promise<string | null> {
  const stripe = getStripe();
  const charge = await stripe.charges.retrieve(platformChargeId, { expand: ['transfer'] });
  const transfer = charge.transfer as Stripe.Transfer | string | null;
  if (!transfer || typeof transfer === 'string') return null;
  const destPayment = transfer.destination_payment;
  if (!destPayment) return null;
  return typeof destPayment === 'string' ? destPayment : destPayment.id;
}

export interface TenantToCleanerTransferParams {
  tenantAccountId: string;
  cleanerAccountId: string;
  amountCents: number;
  sourceTransactionId: string | null;
  appointmentId: string;
}

export async function createTenantToCleanerTransfer(
  p: TenantToCleanerTransferParams,
): Promise<Stripe.Transfer> {
  const stripe = getStripe();

  const params: Stripe.TransferCreateParams = {
    amount: p.amountCents,
    currency: 'usd',
    destination: p.cleanerAccountId,
    metadata: { appointment_id: p.appointmentId, source: 'nexxus-cleaning-platform' },
  };
  if (p.sourceTransactionId) {
    params.source_transaction = p.sourceTransactionId;
  }

  return stripe.transfers.create(params, {
    stripeAccount: p.tenantAccountId,
    idempotencyKey: `cleaner-payout-${p.appointmentId}`,
  });
}
