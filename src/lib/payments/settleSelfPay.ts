/**
 * Settle a captured ORG self-pay charge → pay the cleaner.
 *
 * Sibling of `settleCleanerPayout`, but far simpler: there is NO tenant remainder and NO platform
 * fee (the org IS the tenant — it paid for its own cleaning). The captured funds sit on the
 * PLATFORM balance and a SINGLE platform→connected transfer pays the cleaner.
 *
 * Crucially, the cleaner is paid the EXACT cut derived from the job price × payout% (via
 * computeSelfPayAmounts), NOT the captured amount — the captured amount was grossed up to cover
 * Stripe's fee, and that overshoot stays on the platform/org. Never short the cleaner, never
 * overpay them.
 *
 * Idempotent (a `selfpay-cleaner-${id}` key + an existing-paid-payout guard) and best-effort:
 * a failed transfer records a `failed` payout row for the retry sweep and never throws into the
 * webhook.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeSelfPayAmounts } from './selfPayMath';
import { transferGroupFor, createPlatformTransfer } from '@/lib/stripe/transfers';
import { recordPaymentEvent } from './events';

export interface SettleResult {
  settled: boolean;
  reason?: string;
}

export async function settleSelfPay(
  supabase: SupabaseClient,
  appointmentId: string,
  /** The PLATFORM charge id (PaymentIntent.latest_charge) to source the transfer from. */
  platformChargeId: string | null,
): Promise<SettleResult> {
  const { data: apptRow } = await supabase
    .from('appointments')
    .select('cleaner_id, organization_id, total_price, status, is_self_pay')
    .eq('id', appointmentId)
    .maybeSingle();
  const appt = apptRow as
    | {
        cleaner_id: string | null;
        organization_id: string;
        total_price: number | string;
        status: string;
        is_self_pay: boolean;
      }
    | null;
  if (!appt) return { settled: false, reason: 'no_appointment' };
  if (!appt.is_self_pay) return { settled: false, reason: 'not_self_pay' };

  // Already paid? (retry / duplicate webhook). The idempotency key also protects the transfer,
  // but a stored paid payout lets us short-circuit before re-deriving anything.
  const { data: existingPayout } = await supabase
    .from('payouts')
    .select('id, status, stripe_transfer_id')
    .eq('appointment_id', appointmentId)
    .limit(1)
    .maybeSingle();
  const already = existingPayout as { id: string; status: string; stripe_transfer_id: string | null } | null;
  if (already?.status === 'paid' && already.stripe_transfer_id) {
    return { settled: true };
  }

  // A cancelled job never pays the cleaner (the hold is released, not captured — but guard anyway).
  if (appt.status === 'cancelled') return { settled: false, reason: 'cancelled' };

  // Cleaner must be payout-capable. The booking + authorize gates already enforce this; if the
  // cleaner became unpayable between hold and capture, soft-fail so it can be retried/resolved
  // (the org was charged; the funds are safe on the platform until the cleaner is paid).
  type CleanerRow = {
    payout_model: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_onboarding_complete: boolean;
    payout_percent: number | string;
  };
  let cleaner: CleanerRow | null = null;
  if (appt.cleaner_id) {
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

  if (!cleanerPayable) {
    await recordPaymentEvent(supabase, {
      appointmentId,
      organizationId: appt.organization_id,
      eventType: 'cleaner_transfer_failed',
      newStatus: 'failed',
      actor: 'webhook',
      amount: 0,
      payload: { reason: 'cleaner_not_payable_at_settlement', self_pay: true },
    });
    return { settled: false, reason: 'cleaner_not_payable' };
  }

  const payoutPercent = Number(cleaner!.payout_percent);
  const jobGrossCents = Math.round(Number(appt.total_price) * 100);
  const { cleanerCutCents } = computeSelfPayAmounts({ jobGrossCents, payoutPercent });
  if (cleanerCutCents <= 0) return { settled: false, reason: 'nothing_to_pay' };

  const transferGroup = transferGroupFor(appointmentId);
  const payoutBase = {
    organization_id: appt.organization_id,
    cleaner_id: appt.cleaner_id,
    appointment_id: appointmentId,
    amount: cleanerCutCents / 100,
    payout_percent_snapshot: payoutPercent,
    is_self_pay: true,
  };

  const upsertPayout = async (fields: Record<string, unknown>) => {
    if (already) {
      await supabase.from('payouts').update(fields).eq('id', already.id);
    } else {
      const { error: insertError } = await supabase.from('payouts').insert(fields);
      if (insertError && insertError.code === '23505') {
        // A concurrent settlement inserted the row first (unique index, migration 088); its
        // writer owns the state, and the transfer idempotency key already collapsed the money
        // side, so losing this race is benign.
        console.log('self-pay payout insert lost a benign race for appointment', appointmentId);
      }
    }
  };

  let transfer;
  try {
    transfer = await createPlatformTransfer({
      destinationAccountId: cleaner!.stripe_connect_account_id!,
      amountCents: cleanerCutCents,
      sourceTransactionId: platformChargeId,
      transferGroup,
      idempotencyKey: `selfpay-cleaner-${appointmentId}`,
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
      amount: cleanerCutCents,
      payload: { error: err instanceof Error ? err.message : String(err), self_pay: true },
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
    amount: cleanerCutCents,
    payload: { transfer_id: transfer.id, self_pay: true },
  });

  return { settled: true };
}
