/**
 * Settle a captured homeowner charge across the tenant and (Scenario 1) the cleaner.
 *
 * In the separate-charges-and-transfers model the captured funds sit on the PLATFORM balance, so
 * settlement MUST move them out: the platform transfers the tenant remainder to the tenant
 * account and the cleaner's percentage to the cleaner account, keeping the platform fee. Both are
 * platform→connected transfers tagged with the job's transfer_group; connected→connected transfers
 * are forbidden by Stripe (the bug this replaces).
 *
 * The split is computed on the AMOUNT ACTUALLY CAPTURED (so partial captures and cancellation
 * fees are handled correctly), per decision #11 floored so the parts never exceed it. A cancelled
 * appointment never pays the cleaner — its captured fee goes entirely to the tenant.
 *
 * Idempotent (idempotency keys on both transfers) and best-effort: a failed tenant transfer
 * records a ledger event and bails (the cleaner isn't paid before the tenant is made whole); a
 * failed cleaner transfer records a `failed` payout row for the retry job. Never throws into the
 * webhook.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { transferGroupFor, createPlatformTransfer } from '@/lib/stripe/transfers';
import { recordPaymentEvent } from './events';

export interface SettleResult {
  settled: boolean;
  reason?: string;
}

export async function settleCleanerPayout(
  supabase: SupabaseClient,
  appointmentId: string,
  /** The PLATFORM charge id (PaymentIntent.latest_charge) to source the transfers from. */
  platformChargeId: string | null,
  /** Amount actually captured, in cents (PaymentIntent.amount_received). Falls back to the
   *  recorded payment / appointment price when omitted (e.g. the reconcile retry path). */
  capturedCents?: number,
): Promise<SettleResult> {
  const { data: apptRow } = await supabase
    .from('appointments')
    .select('cleaner_id, organization_id, total_price, status')
    .eq('id', appointmentId)
    .maybeSingle();
  const appt = apptRow as
    | { cleaner_id: string | null; organization_id: string; total_price: number | string; status: string }
    | null;
  if (!appt) return { settled: false, reason: 'no_appointment' };

  // The tenant MUST be a ready connected account: the funds are on the platform and have to be
  // transferred out, or no one gets paid.
  const { data: orgRow } = await supabase
    .from('organizations')
    .select('stripe_connect_account_id, platform_fee_bps')
    .eq('id', appt.organization_id)
    .maybeSingle();
  const org = orgRow as { stripe_connect_account_id: string | null; platform_fee_bps: number } | null;
  if (!org?.stripe_connect_account_id) return { settled: false, reason: 'tenant_not_ready' };

  // The revenue payment row drives the captured-amount fallback AND tells us whether the tenant
  // leg already ran (transfer_amount recorded). On a retry `platformChargeId` is null, so
  // re-attempting the tenant transfer under the same `tenant-payout-${id}` idempotency key with
  // different params would be rejected by Stripe and bail before the cleaner leg — so the failed
  // cleaner payout could never self-heal. Skip the tenant leg once it's already recorded.
  const { data: payRow } = await supabase
    .from('payments')
    .select('amount, transfer_amount, processing_fee_cents')
    .eq('appointment_id', appointmentId)
    .eq('payment_type', 'revenue')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const tenantAlreadyTransferred =
    (payRow as { transfer_amount: number | null } | null)?.transfer_amount != null;

  // Amount actually captured (handles partial capture + cancellation fees). Includes any
  // processing fee the payer funded on top of the service price.
  let capturedTotalCents = capturedCents ?? 0;
  if (!capturedTotalCents) {
    const amt = (payRow as { amount: number | string } | null)?.amount;
    capturedTotalCents = amt != null ? Math.round(Number(amt) * 100) : Math.round(Number(appt.total_price) * 100);
  }
  if (capturedTotalCents <= 0) return { settled: false, reason: 'nothing_captured' };

  // Distribute only the SERVICE PRICE (captured minus the passed-through fee) — the fee was
  // consumed by Stripe, so splitting on it would overdraw the platform balance. Legacy/no-
  // passthrough rows (null fee) distribute the full captured amount, unchanged.
  const processingFeeCents = Number(
    (payRow as { processing_fee_cents: number | null } | null)?.processing_fee_cents ?? 0,
  );
  const splitBaseCents = Math.max(0, capturedTotalCents - processingFeeCents);

  // Cleaner payability — never pay the cleaner for a cancelled job (the captured fee compensates
  // the tenant, not the cleaner).
  type CleanerRow = {
    payout_model: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_onboarding_complete: boolean;
    payout_percent: number | string;
  };
  let cleaner: CleanerRow | null = null;
  if (appt.cleaner_id && appt.status !== 'cancelled') {
    const { data: cleanerRow } = await supabase
      .from('cleaner_profiles')
      .select('payout_model, stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent')
      .eq('id', appt.cleaner_id)
      .maybeSingle();
    cleaner = cleanerRow as CleanerRow | null;
  }
  // A cleaner whose payout share we must CARVE OUT, even if they can't be paid yet: assigned,
  // not hourly-external, positive %. We split on their real % so the tenant gets only their TRUE
  // remainder; then either pay the cleaner now (onboarded) or HOLD their slice for a later retry.
  // This replaces the old behavior where an un-onboarded cleaner's share silently folded into the
  // tenant payout (payoutPercent forced to 0).
  const cleanerHasShare =
    !!cleaner &&
    cleaner.payout_model !== 'hourly_external' &&
    Number(cleaner.payout_percent) > 0;
  // Connect-readiness of the cleaner's account, independent of their CURRENT share: a slice that
  // was already carved out must be paid once they finish onboarding even if their percent was
  // later edited (including down to 0) — the money was set aside at settlement time.
  const cleanerAccountReady =
    !!cleaner && !!cleaner.stripe_connect_account_id && cleaner.stripe_connect_onboarding_complete;
  const payoutPercent = cleanerHasShare ? Number(cleaner!.payout_percent) : 0;

  const { cleanerCents, tenantRemainderCents } = computePaymentSplit({
    grossCents: splitBaseCents,
    payoutPercent,
    platformFeeBps: org.platform_fee_bps ?? 0,
  });

  const transferGroup = transferGroupFor(appointmentId);

  // 1) Tenant remainder → tenant connected account. This MUST happen or the tenant never gets
  //    paid (funds are stranded on the platform); on failure, record + bail before paying the cleaner.
  if (tenantRemainderCents > 0 && !tenantAlreadyTransferred) {
    try {
      await createPlatformTransfer({
        destinationAccountId: org.stripe_connect_account_id,
        amountCents: tenantRemainderCents,
        sourceTransactionId: platformChargeId,
        transferGroup,
        idempotencyKey: `tenant-payout-${appointmentId}`,
        appointmentId,
      });
      await supabase
        .from('payments')
        .update({
          transfer_amount: tenantRemainderCents,
          transfer_destination_account_id: org.stripe_connect_account_id,
        })
        .eq('appointment_id', appointmentId)
        .eq('payment_type', 'revenue');
    } catch (err) {
      await recordPaymentEvent(supabase, {
        appointmentId,
        organizationId: appt.organization_id,
        eventType: 'tenant_transfer_failed',
        newStatus: 'failed',
        actor: 'webhook',
        amount: tenantRemainderCents,
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
      return { settled: false, reason: 'tenant_transfer_failed' };
    }
  }

  // 2) Cleaner percentage → cleaner connected account (Scenario 1). Soft-fail → 'failed' payout
  //    row for the retry sweep; not-yet-onboarded → 'pending' (held) for the retry sweep.
  //
  // On a RETRY, an existing payout row carries the slice CARVED OUT at first settlement (its
  // `amount` + `payout_percent_snapshot`). The tenant was already paid the complementary remainder
  // against that original percent, so we MUST pay the cleaner that snapshot, never a fresh recompute:
  // if the cleaner's payout_percent was edited while they were still onboarding, recomputing would
  // over/underpay the cleaner and strand funds (conservation breaks).
  const { data: priorPayoutRow } = await supabase
    .from('payouts')
    .select('id, amount, payout_percent_snapshot, status')
    .eq('appointment_id', appointmentId)
    .limit(1)
    .maybeSingle();
  const priorPayout = priorPayoutRow as
    | { id: string; amount: number | string; payout_percent_snapshot: number | string | null; status: string }
    | null;
  // A carved slice we still owe the cleaner: held ('pending') or a failed transfer. 'paid'/'reversed'
  // are terminal and must never be re-paid.
  const hasCarvedSlice =
    !!priorPayout &&
    (priorPayout.status === 'pending' || priorPayout.status === 'failed') &&
    priorPayout.amount != null;

  // Amount + percent snapshot to settle: the carved slice on a retry, else the freshly computed
  // split on first settlement. A carved slice is paid even if the current share is now 0.
  const cleanerSettleCents = hasCarvedSlice ? Math.round(Number(priorPayout!.amount) * 100) : cleanerCents;
  const cleanerSettlePercent =
    hasCarvedSlice && priorPayout!.payout_percent_snapshot != null
      ? Number(priorPayout!.payout_percent_snapshot)
      : payoutPercent;
  const shouldSettleCleaner = (cleanerHasShare || hasCarvedSlice) && cleanerSettleCents > 0;

  if (shouldSettleCleaner) {
    const payoutBase = {
      organization_id: appt.organization_id,
      cleaner_id: appt.cleaner_id,
      appointment_id: appointmentId,
      amount: cleanerSettleCents / 100,
      payout_percent_snapshot: cleanerSettlePercent,
    };

    const upsertPayout = async (fields: Record<string, unknown>) => {
      if (priorPayout) {
        await supabase.from('payouts').update(fields).eq('id', priorPayout.id);
      } else {
        await supabase.from('payouts').insert(fields);
      }
    };

    // Cleaner isn't Connect-ready yet: HOLD their slice on the platform (the tenant already got
    // only their remainder, so the money stays put) as a 'pending' payout. The reconcile retry
    // settles it once the cleaner finishes onboarding (account.updated flips onboarding_complete).
    if (!cleanerAccountReady) {
      await upsertPayout({ ...payoutBase, status: 'pending' });
      await recordPaymentEvent(supabase, {
        appointmentId,
        organizationId: appt.organization_id,
        eventType: 'cleaner_payout_held',
        newStatus: 'pending',
        actor: 'webhook',
        amount: cleanerSettleCents,
        payload: { reason: 'cleaner_not_onboarded' },
      });
      return { settled: true, reason: 'cleaner_slice_held' };
    }

    let transfer;
    try {
      transfer = await createPlatformTransfer({
        destinationAccountId: cleaner!.stripe_connect_account_id!,
        amountCents: cleanerSettleCents,
        sourceTransactionId: platformChargeId,
        transferGroup,
        idempotencyKey: `cleaner-payout-${appointmentId}`,
        appointmentId,
      });
    } catch (err) {
      await upsertPayout({ ...payoutBase, status: 'failed' });
      await recordPaymentEvent(supabase, {
        appointmentId,
        organizationId: appt.organization_id,
        eventType: 'cleaner_transfer_failed',
        newStatus: 'failed',
        actor: 'webhook',
        amount: cleanerSettleCents,
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
      return { settled: false, reason: 'cleaner_transfer_failed' };
    }

    await upsertPayout({
      ...payoutBase,
      status: 'paid',
      stripe_transfer_id: transfer.id,
      paid_at: new Date().toISOString(),
    });
    await recordPaymentEvent(supabase, {
      appointmentId,
      organizationId: appt.organization_id,
      eventType: 'cleaner_paid',
      newStatus: 'paid',
      actor: 'webhook',
      amount: cleanerSettleCents,
      payload: { transfer_id: transfer.id },
    });
  }

  return { settled: true };
}
