/**
 * Settle the cleaner's share after a destination charge is captured (Phase 3).
 *
 * Only percentage_contractor cleaners with a ready Connect account get paid through
 * Stripe; hourly_external (and unconfigured) cleaners are skipped — the tenant keeps the
 * full settlement and pays them outside the app (Scenario 2). The cleaner's amount is a
 * percentage of GROSS (decision #11), transferred from the tenant's balance.
 *
 * Best-effort + idempotent: a failed transfer records a `failed` payout row (for the
 * retry job) + a ledger event, and never throws back into the webhook.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { resolveTenantChargeId, createTenantToCleanerTransfer } from '@/lib/stripe/transfers';
import { recordPaymentEvent } from './events';

export interface SettleResult {
  settled: boolean;
  reason?: string;
}

export async function settleCleanerPayout(
  supabase: SupabaseClient,
  appointmentId: string,
  platformChargeId: string | null,
): Promise<SettleResult> {
  const { data: apptRow } = await supabase
    .from('appointments')
    .select('cleaner_id, organization_id, total_price, status')
    .eq('id', appointmentId)
    .maybeSingle();
  const appt = apptRow as
    | { cleaner_id: string | null; organization_id: string; total_price: number | string; status: string }
    | null;
  if (!appt?.cleaner_id) return { settled: false, reason: 'no_cleaner' };
  // A cancelled appointment can still capture money (a cancellation/no-show fee), but the
  // cleaner is never paid for it — guard against the fee's payment_intent.succeeded webhook
  // triggering a cleaner transfer (the fee compensates the tenant, not the cleaner).
  if (appt.status === 'cancelled') return { settled: false, reason: 'appointment_cancelled' };

  const { data: cleanerRow } = await supabase
    .from('cleaner_profiles')
    .select('payout_model, stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent')
    .eq('id', appt.cleaner_id)
    .maybeSingle();
  const cleaner = cleanerRow as
    | {
        payout_model: string | null;
        stripe_connect_account_id: string | null;
        stripe_connect_onboarding_complete: boolean;
        payout_percent: number | string;
      }
    | null;
  if (!cleaner) return { settled: false, reason: 'no_cleaner_profile' };
  if (cleaner.payout_model === 'hourly_external') return { settled: false, reason: 'hourly_external' };

  const payoutPercent = Number(cleaner.payout_percent);
  if (
    !cleaner.stripe_connect_account_id ||
    !cleaner.stripe_connect_onboarding_complete ||
    payoutPercent <= 0
  ) {
    return { settled: false, reason: 'cleaner_not_payable' };
  }

  const { data: orgRow } = await supabase
    .from('organizations')
    .select('stripe_connect_account_id, platform_fee_bps')
    .eq('id', appt.organization_id)
    .maybeSingle();
  const org = orgRow as { stripe_connect_account_id: string | null; platform_fee_bps: number } | null;
  if (!org?.stripe_connect_account_id) return { settled: false, reason: 'tenant_not_ready' };

  const grossCents = Math.round(Number(appt.total_price) * 100);
  const { cleanerCents } = computePaymentSplit({
    grossCents,
    payoutPercent,
    platformFeeBps: org.platform_fee_bps ?? 0,
  });
  if (cleanerCents <= 0) return { settled: false, reason: 'zero_payout' };

  let sourceTxn: string | null = null;
  if (platformChargeId) {
    try {
      sourceTxn = await resolveTenantChargeId(platformChargeId);
    } catch {
      sourceTxn = null; // fall back to available-balance transfer
    }
  }

  const payoutBase = {
    organization_id: appt.organization_id,
    cleaner_id: appt.cleaner_id,
    appointment_id: appointmentId,
    amount: cleanerCents / 100,
    payout_percent_snapshot: payoutPercent,
    source_balance_account_id: org.stripe_connect_account_id,
  };

  async function upsertPayout(fields: Record<string, unknown>) {
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
  }

  let transfer;
  try {
    transfer = await createTenantToCleanerTransfer({
      tenantAccountId: org.stripe_connect_account_id,
      cleanerAccountId: cleaner.stripe_connect_account_id,
      amountCents: cleanerCents,
      sourceTransactionId: sourceTxn,
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
    return { settled: false, reason: 'transfer_failed' };
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
    payload: { transfer_id: transfer.id, source_account: org.stripe_connect_account_id },
  });

  return { settled: true };
}
