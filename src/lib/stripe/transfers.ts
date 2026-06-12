/**
 * Platform → connected-account transfers (marketplace settlement, Scenario 1).
 *
 * Funds for a job settle to the PLATFORM balance: the charge is created on the platform with
 * `on_behalf_of: tenant` and a `transfer_group`, but NO `transfer_data` (separate charges and
 * transfers). After capture the platform fans the money out with two transfers from its own
 * balance — tenant remainder → tenant account, cleaner percentage → cleaner account — and keeps
 * the platform fee.
 *
 * Every transfer is created ON THE PLATFORM (no `stripeAccount` header). That is deliberate and
 * load-bearing: Stripe forbids transfers BETWEEN connected accounts, so the earlier
 * "tenant → cleaner via `stripeAccount: tenant`" design failed at runtime with
 * "Cannot create transfers between connected accounts." Omitting the header makes that mistake
 * structurally impossible. All transfers for a job share a `transfer_group` so a refund can find
 * and reverse them.
 */
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';

/** Stable transfer-group tag shared by a job's charge and all its transfers. */
export function transferGroupFor(appointmentId: string): string {
  return `appt_${appointmentId}`;
}

export interface PlatformTransferParams {
  /** Connected account to receive the funds (tenant or cleaner). */
  destinationAccountId: string;
  amountCents: number;
  /** Platform charge id (PaymentIntent.latest_charge) to draw the funds from. */
  sourceTransactionId: string | null;
  transferGroup: string;
  /** Idempotency key — e.g. `tenant-payout-${appt}` / `cleaner-payout-${appt}`. */
  idempotencyKey: string;
  appointmentId: string;
}

/**
 * Create a transfer FROM the platform balance to a connected account. There is intentionally no
 * `stripeAccount` header — a platform→connected transfer is the only kind Stripe permits here.
 */
export async function createPlatformTransfer(p: PlatformTransferParams): Promise<Stripe.Transfer> {
  const stripe = getStripe();
  const params: Stripe.TransferCreateParams = {
    amount: p.amountCents,
    currency: 'usd',
    destination: p.destinationAccountId,
    transfer_group: p.transferGroup,
    metadata: { appointment_id: p.appointmentId, source: 'nexxus-cleaning-platform' },
  };
  if (p.sourceTransactionId) params.source_transaction = p.sourceTransactionId;
  return stripe.transfers.create(params, { idempotencyKey: p.idempotencyKey });
}

/** Every transfer Stripe created for a job (by transfer_group) — used to unwind on refund. */
export async function listTransfersByGroup(transferGroup: string): Promise<Stripe.Transfer[]> {
  const stripe = getStripe();
  const res = await stripe.transfers.list({ transfer_group: transferGroup, limit: 100 });
  return res.data;
}

/**
 * Read a single transfer (amount + amount_reversed) so a clawback can cap its reversal at what
 * Stripe still allows — asking for more than the un-reversed remainder throws on every retry.
 */
export async function retrievePlatformTransfer(transferId: string): Promise<Stripe.Transfer> {
  return getStripe().transfers.retrieve(transferId);
}

/**
 * Reverse (part of) a transfer. Created on the PLATFORM (no `stripeAccount`), matching how the
 * transfer was created — claws the funds back to the platform balance.
 */
export async function reversePlatformTransfer(
  transferId: string,
  amountCents: number,
  /** Optional idempotency key so a webhook/cron retry of the same reversal can't double-claw-back. */
  idempotencyKey?: string,
): Promise<Stripe.TransferReversal> {
  const stripe = getStripe();
  // 2-arg call when no key, so we never pass a 3rd arg that could be mistaken for a stripeAccount
  // (a stripeAccount here would make it a forbidden connected→connected reversal).
  return idempotencyKey
    ? stripe.transfers.createReversal(transferId, { amount: amountCents }, { idempotencyKey })
    : stripe.transfers.createReversal(transferId, { amount: amountCents });
}
