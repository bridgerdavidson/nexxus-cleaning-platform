/**
 * Charge a bank-account (ACH) appointment AT COMPLETION.
 *
 * Cards are authorized (held) at confirm and captured on completion; bank accounts can't hold, so
 * the debit is created+confirmed here and lands in `processing` for ~4 business days. The payment
 * row mirrors that with payment_status='processing' (migration 082) — that, not authorization_status
 * (whose CHECK constraint has no 'processing' value), is the source of truth for the cleaner's
 * "Awaiting customer payment" view. Settlement to cleaner/tenant runs later on
 * payment_intent.succeeded (never before the debit settles); the split runs on the service price
 * via processing_fee_cents, so the platform never goes negative.
 *
 * Idempotent: if a revenue payment row with a PaymentIntent already exists for the appointment, it
 * returns that instead of double-charging.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAchCharge } from '@/lib/stripe/charges/chargeAch';
import { computeChargeBreakdown } from './processingFee';
import { stripeFeePassthroughEnabled } from '@/lib/stripe/flags';
import { recordPaymentEvent } from './events';

export type AchChargeCode =
  | 'processing'
  | 'no_card'
  | 'tenant_not_ready'
  | 'not_chargeable'
  | 'failed'
  | 'error';

export interface AchChargeOutcome {
  ok: boolean;
  code: AchChargeCode;
  message?: string;
  paymentIntentId?: string;
}

interface ApptRow {
  id: string;
  organization_id: string;
  homeowner_id: string;
  total_price: number | string;
  status: string;
  payment_method_id: string | null;
}

export async function chargeAchAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  actor: string,
): Promise<AchChargeOutcome> {
  const { data: apptData } = await supabase
    .from('appointments')
    .select('id, organization_id, homeowner_id, total_price, status, payment_method_id')
    .eq('id', appointmentId)
    .maybeSingle();
  if (!apptData) return { ok: false, code: 'error', message: 'Appointment not found' };
  const appt = apptData as ApptRow;

  if (appt.status === 'cancelled') {
    return { ok: false, code: 'not_chargeable', message: 'Appointment is cancelled' };
  }
  if (!appt.payment_method_id) {
    return { ok: false, code: 'no_card', message: 'No payment method on the appointment' };
  }

  // Idempotency: an existing revenue row with a PaymentIntent means the debit was already initiated
  // (double-submit, retry, or the cron). Don't charge twice.
  const { data: piRows } = await supabase
    .from('payments')
    .select('stripe_payment_intent_id')
    .eq('appointment_id', appointmentId)
    .eq('payment_type', 'revenue')
    .not('stripe_payment_intent_id', 'is', null)
    .limit(1);
  if (piRows && piRows.length > 0) {
    return {
      ok: true,
      code: 'processing',
      message: 'Already charging',
      paymentIntentId: (piRows[0] as { stripe_payment_intent_id: string }).stripe_payment_intent_id,
    };
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
    return { ok: false, code: 'tenant_not_ready', message: 'Organization Stripe account is not ready to accept charges' };
  }

  const { data: hoData } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', appt.homeowner_id)
    .maybeSingle();
  const customerId = (hoData as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;
  if (!customerId) return { ok: false, code: 'no_card', message: 'Homeowner has no saved payment profile' };

  const baseCents = Math.round(Number(appt.total_price) * 100);
  const passthrough = stripeFeePassthroughEnabled();
  const { chargeCents, feeCents } = passthrough
    ? computeChargeBreakdown('us_bank_account', baseCents)
    : { chargeCents: baseCents, feeCents: 0 };

  let pi;
  try {
    pi = await createAchCharge({
      chargeCents,
      customerId,
      paymentMethodId: appt.payment_method_id,
      tenantAccountId: org.stripe_connect_account_id,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
    });
  } catch (err) {
    return { ok: false, code: 'failed', message: err instanceof Error ? err.message : 'ACH charge failed' };
  }

  // ACH PaymentIntent starts in `processing`; the row mirrors that until payment_intent.succeeded.
  const paymentRow = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: chargeCents / 100,
    processing_fee_cents: passthrough ? feeCents : null,
    status: 'processing' as const,
    payment_type: 'revenue' as const,
    payment_method: 'ach' as const,
    charge_kind: 'completion' as const,
    stripe_payment_intent_id: pi.id,
    on_behalf_of_account_id: org.stripe_connect_account_id,
    transfer_destination_account_id: org.stripe_connect_account_id,
    payment_intent_status: pi.status,
  };

  const paymentId = await upsertAchPaymentRow(supabase, appt.id, appt.organization_id, paymentRow);

  await recordPaymentEvent(supabase, {
    paymentId,
    appointmentId: appt.id,
    organizationId: appt.organization_id,
    eventType: 'ach_charge_initiated',
    newStatus: 'processing',
    actor,
    amount: chargeCents,
    payload: { payment_intent_id: pi.id, pi_status: pi.status },
  });

  return { ok: true, code: 'processing', paymentIntentId: pi.id };
}

/**
 * Update-or-insert the revenue row for an ACH debit. The partial unique index (migration 088)
 * backstops the check-then-insert race: on 23505 the concurrent writer won — adopt its row when
 * it carries the SAME PaymentIntent (the idempotency key collapsed the race), or flag a real
 * duplicate charge loudly instead of overwriting either record.
 */
export async function upsertAchPaymentRow(
  supabase: SupabaseClient,
  appointmentId: string,
  organizationId: string,
  paymentRow: Record<string, unknown>,
): Promise<string | null> {
  const { data: anyRow } = await supabase
    .from('payments')
    .select('id')
    .eq('appointment_id', appointmentId)
    .eq('payment_type', 'revenue')
    .order('created_at', { ascending: false })
    .limit(1);
  if (anyRow && anyRow.length > 0) {
    const id = (anyRow[0] as { id: string }).id;
    await supabase.from('payments').update(paymentRow).eq('id', id);
    return id;
  }
  const { data: inserted, error: insertError } = await supabase
    .from('payments')
    .insert(paymentRow)
    .select('id')
    .single();
  if (insertError && insertError.code === '23505') {
    const { data: winner } = await supabase
      .from('payments')
      .select('id, stripe_payment_intent_id')
      .eq('appointment_id', appointmentId)
      .eq('payment_type', 'revenue')
      .not('stripe_payment_intent_id', 'is', null)
      .limit(1)
      .maybeSingle();
    const w = winner as { id: string; stripe_payment_intent_id: string | null } | null;
    if (!w) return null;
    if (w.stripe_payment_intent_id === (paymentRow.stripe_payment_intent_id ?? null)) {
      await supabase.from('payments').update(paymentRow).eq('id', w.id);
      return w.id;
    }
    await recordPaymentEvent(supabase, {
      paymentId: w.id,
      appointmentId,
      organizationId,
      eventType: 'duplicate_charge_detected',
      actor: 'system',
      payload: {
        kept_payment_intent_id: w.stripe_payment_intent_id,
        duplicate_payment_intent_id: paymentRow.stripe_payment_intent_id ?? null,
      },
    });
    return w.id;
  }
  return (inserted as { id: string } | null)?.id ?? null;
}
