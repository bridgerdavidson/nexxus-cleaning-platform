/**
 * Off-session cancellation / no-show fee charge.
 *
 * With no upfront hold, a homeowner-fault late-cancel or no-show fee is collected by charging the
 * saved card on file at cancel time (idempotency key `cancelfee-{appointmentId}`, a distinct prefix
 * from the completion charge's `charge-` key). The caller marks the appointment cancelled BEFORE
 * this runs, so the fee charge's `payment_intent.succeeded` settles to the TENANT only:
 * `settleCleanerPayout` never pays the cleaner for a cancelled job, and the split is computed on the
 * captured fee amount.
 *
 * Best-effort and never blocks the cancellation:
 *   - no saved card, a bank (ACH) payer, an unready tenant, or no customer -> 'uncollectable' ($0);
 *   - a decline or off-session 3-D Secure (the customer isn't present to authenticate) -> 'failed'.
 * Every terminal outcome is written to the `payment_events` ledger.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { getPaymentMethodType } from '@/lib/stripe/customers/homeowner';
import { recordPaymentEvent } from './events';

export type CancellationFeeCode = 'charged' | 'uncollectable' | 'failed';

export interface CancellationFeeOutcome {
  code: CancellationFeeCode;
  feeCapturedCents: number;
  paymentIntentId?: string;
  message?: string;
}

export interface FeeAppointment {
  id: string;
  organization_id: string;
  homeowner_id: string | null;
  payment_method_id: string | null;
}

export async function chargeCancellationFee(
  supabase: SupabaseClient,
  appt: FeeAppointment,
  feeCents: number,
  actor: string,
  context: { party: string; noShow: boolean; insideWindow: boolean },
): Promise<CancellationFeeOutcome> {
  const ledger = (eventType: string, payload: Record<string, unknown>, paymentId?: string | null) =>
    recordPaymentEvent(supabase, {
      paymentId: paymentId ?? null,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      eventType,
      actor,
      amount: feeCents,
      payload: { party: context.party, no_show: context.noShow, inside_window: context.insideWindow, ...payload },
    });

  // Idempotency: a paid/processing revenue row means the fee already went through (a retry or the
  // webhook). Don't charge again. Reuse the row for any later status write.
  const { data: existingRows } = await supabase
    .from('payments')
    .select('id, status, stripe_payment_intent_id')
    .eq('appointment_id', appt.id)
    .eq('payment_type', 'revenue')
    .limit(1);
  const existing =
    existingRows && existingRows.length > 0
      ? (existingRows[0] as { id: string; status: string; stripe_payment_intent_id: string | null })
      : null;
  if (existing && (existing.status === 'paid' || existing.status === 'processing')) {
    return { code: 'charged', feeCapturedCents: feeCents, paymentIntentId: existing.stripe_payment_intent_id ?? undefined };
  }

  if (!appt.payment_method_id || !appt.homeowner_id) {
    await ledger('cancellation_fee_uncollectable', { reason: 'no_card' });
    return { code: 'uncollectable', feeCapturedCents: 0 };
  }

  // A bank (ACH) payer: don't off-session debit a small, return-prone fee. Mark it uncollectable.
  if ((await getPaymentMethodType(appt.payment_method_id)) === 'us_bank_account') {
    await ledger('cancellation_fee_uncollectable', { reason: 'ach_payer' });
    return { code: 'uncollectable', feeCapturedCents: 0 };
  }

  const { data: orgData } = await supabase
    .from('organizations')
    .select('stripe_connect_account_id, stripe_connect_charges_enabled, platform_fee_bps')
    .eq('id', appt.organization_id)
    .maybeSingle();
  const org = orgData as
    | { stripe_connect_account_id: string | null; stripe_connect_charges_enabled: boolean; platform_fee_bps: number }
    | null;
  if (!org?.stripe_connect_account_id || !org.stripe_connect_charges_enabled) {
    await ledger('cancellation_fee_uncollectable', { reason: 'tenant_not_ready' });
    return { code: 'uncollectable', feeCapturedCents: 0 };
  }

  const { data: hoData } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', appt.homeowner_id)
    .maybeSingle();
  const customerId = (hoData as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;
  if (!customerId) {
    await ledger('cancellation_fee_uncollectable', { reason: 'no_customer' });
    return { code: 'uncollectable', feeCapturedCents: 0 };
  }

  const platformFeeBps = org.platform_fee_bps ?? 0;
  const { platformFeeCents } = computePaymentSplit({ grossCents: feeCents, payoutPercent: 0, platformFeeBps });

  let pi;
  try {
    pi = await createDestinationCharge({
      grossCents: feeCents,
      customerId,
      paymentMethodId: appt.payment_method_id,
      tenantAccountId: org.stripe_connect_account_id,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      keyPrefix: 'cancelfee',
    });
  } catch (err) {
    await ledger('cancellation_fee_failed', { error: err instanceof Error ? err.message : String(err) }, existing?.id);
    return { code: 'failed', feeCapturedCents: 0, message: err instanceof Error ? err.message : 'Card declined' };
  }

  const baseRow = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: feeCents / 100,
    payment_type: 'revenue' as const,
    payment_method: 'card' as const,
    stripe_payment_intent_id: pi.id,
    on_behalf_of_account_id: org.stripe_connect_account_id,
    transfer_destination_account_id: org.stripe_connect_account_id,
    application_fee_amount: platformFeeCents,
    application_fee_bps_snapshot: platformFeeBps,
    payment_intent_status: pi.status,
  };

  const upsertRow = async (fields: Record<string, unknown>): Promise<string | null> => {
    if (existing) {
      await supabase.from('payments').update(fields).eq('id', existing.id);
      return existing.id;
    }
    const { data: inserted } = await supabase.from('payments').insert(fields).select('id').single();
    return (inserted as { id: string } | null)?.id ?? null;
  };

  if (pi.status === 'succeeded') {
    const now = new Date().toISOString();
    const paymentId = await upsertRow({ ...baseRow, status: 'paid', authorized_at: now, captured_at: now, paid_at: now });
    await ledger('cancellation_fee_charged', { payment_intent_id: pi.id, pi_status: pi.status }, paymentId);
    return { code: 'charged', feeCapturedCents: feeCents, paymentIntentId: pi.id };
  }

  // requires_action (off-session 3-D Secure: the customer isn't present) or any other non-success.
  // Don't block the cancellation; record the attempt as failed so it's visible and ledgered.
  const paymentId = await upsertRow({ ...baseRow, status: 'failed' });
  await ledger('cancellation_fee_failed', { payment_intent_id: pi.id, pi_status: pi.status }, paymentId);
  return { code: 'failed', feeCapturedCents: 0, paymentIntentId: pi.id, message: 'Customer authentication required' };
}
