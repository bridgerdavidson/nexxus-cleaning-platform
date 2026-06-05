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
  const cleanerPayable =
    !!cleaner &&
    cleaner.payout_model !== 'hourly_external' &&
    !!cleaner.stripe_connect_account_id &&
    cleaner.stripe_connect_onboarding_complete &&
    Number(cleaner.payout_percent) > 0;
  const payoutPercent = cleanerPayable ? Number(cleaner!.payout_percent) : 0;

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
  //    row for the retry sweep.
  if (cleanerPayable && cleanerCents > 0) {
    const payoutBase = {
      organization_id: appt.organization_id,
      cleaner_id: appt.cleaner_id,
      appointment_id: appointmentId,
      amount: cleanerCents / 100,
      payout_percent_snapshot: payoutPercent,
    };

    const upsertPayout = async (fields: Record<string, unknown>) => {
      const { data: existing } = await supabase
        .from('payouts')
        .select('id')
        .eq('appointment_id', appointmentId)
        .limit(1);
      if (existing && existing.length > 0) {
        await supabase.from('payouts').update(fields).eq('id', (existing[0] as { id: string }).id);
      } else {
        await supabase.from('payouts').insert(fields);
      }
    };

    let transfer;
    try {
      transfer = await createPlatformTransfer({
        destinationAccountId: cleaner!.stripe_connect_account_id!,
        amountCents: cleanerCents,
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
        amount: cleanerCents,
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
      amount: cleanerCents,
      payload: { transfer_id: transfer.id },
    });
  }

  return { settled: true };
}
