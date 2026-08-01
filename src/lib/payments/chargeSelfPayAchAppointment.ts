/**
 * Charge an ORG self-pay BANK (ACH) cleaning AT COMPLETION.
 *
 * Self-pay sibling of `chargeAchAppointment` (homeowner ACH) and `authorizeSelfPayAppointment`
 * (self-pay card). Self-pay cards are authorized (held) at booking and captured on completion;
 * bank accounts can't hold, so the debit is created+confirmed here and lands in `processing` for
 * ~4 business days. The org card/bank is charged the cleaner's cut GROSSED UP for the ACH fee
 * (computeSelfPayAmounts, method 'us_bank_account'); funds land on the PLATFORM balance (no
 * on_behalf_of, no transfer_data) and `settleSelfPay` pays the cleaner the EXACT cut once the
 * debit succeeds (routed via `metadata.self_pay='true'` on payment_intent.succeeded).
 *
 * The payment row mirrors `processing` (migration 082, payment_method='ach', is_self_pay=true) —
 * that, not authorization_status, drives the cleaner's "Awaiting customer payment" view.
 * Idempotent: if a revenue row with a PaymentIntent already exists, returns it instead of
 * double-charging.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSelfPayAchCharge } from '@/lib/stripe/charges/chargeSelfPayAch';
import { listSavedCards } from '@/lib/stripe/customers/homeowner';
import { computeSelfPayAmountsFromCents } from './selfPayMath';
import { resolveSelfPayCutCents } from './payRequests/selfPayCut';
import { isCleanerPayable } from './isCleanerPayable';
import { recordPaymentEvent } from './events';
import { upsertAchPaymentRow } from './chargeAchAppointment';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

export type SelfPayAchChargeCode =
  | 'processing'
  | 'no_org_card'
  | 'no_org_bank'
  | 'cleaner_not_payable'
  | 'pay_request_pending'
  | 'not_chargeable'
  | 'failed'
  | 'error';

export interface SelfPayAchChargeOutcome {
  ok: boolean;
  code: SelfPayAchChargeCode;
  message?: string;
  paymentIntentId?: string;
}

interface ApptRow {
  id: string;
  organization_id: string;
  cleaner_id: string | null;
  total_price: number | string;
  status: string;
  is_self_pay: boolean;
}

export async function chargeSelfPayAchAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  actor: string,
): Promise<SelfPayAchChargeOutcome> {
  const { data: apptData } = await supabase
    .from('appointments')
    .select('id, organization_id, cleaner_id, total_price, status, is_self_pay')
    .eq('id', appointmentId)
    .maybeSingle();
  if (!apptData) return { ok: false, code: 'error', message: 'Appointment not found' };
  const appt = apptData as ApptRow;

  if (!appt.is_self_pay) return { ok: false, code: 'error', message: 'Appointment is not self-pay' };
  if (appt.status === 'cancelled') return { ok: false, code: 'not_chargeable', message: 'Appointment is cancelled' };

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

  // The org's company bank account and the assigned cleaner are independent reads — fetch them
  // concurrently to shave a round-trip off the request hot path.
  type CleanerRow = {
    payout_model: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_onboarding_complete: boolean;
    payout_percent: number | string;
    flat_rate_cents: number | null;
    payout_configured_at: string | null;
  };
  const [orgRes, cleanerRes] = await Promise.all([
    supabase
      .from('organizations')
      .select('stripe_self_pay_customer_id, platform_fee_bps')
      .eq('id', appt.organization_id)
      .maybeSingle(),
    appt.cleaner_id
      ? supabase
          .from('cleaner_profiles')
          .select('payout_model, stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent, flat_rate_cents, payout_configured_at')
          .eq('id', appt.cleaner_id)
          .maybeSingle()
      : Promise.resolve({ data: null as CleanerRow | null }),
  ]);

  const orgRow = orgRes.data as { stripe_self_pay_customer_id: string | null; platform_fee_bps: number } | null;
  const customerId = orgRow?.stripe_self_pay_customer_id ?? null;
  if (!customerId) {
    await recordSelfPayNoMethod(supabase, appt, actor, 'no_self_pay_customer');
    return { ok: false, code: 'no_org_card', message: 'Organization has no company payment method on file' };
  }

  // The assigned cleaner must be payout-capable (the charge amount depends on their cut).
  const cleaner = cleanerRes.data as CleanerRow | null;
  if (!cleaner || !isCleanerPayable(cleaner)) {
    return {
      ok: false,
      code: 'cleaner_not_payable',
      message: 'Self-pay requires a payout-capable cleaner (Connect onboarded with pay set up)',
    };
  }

  // Request mode: the debit amount is the approved pay-request cut, so nothing
  // can be charged until the thread approves. Precondition bail; the approve
  // trigger / reconcile sweep re-collects once approved.
  const jobGrossCents = Math.round(Number(appt.total_price) * 100);
  const cut = await resolveSelfPayCutCents(supabase, { appointmentId: appt.id, cleaner, jobGrossCents });
  if (!cut.ok) {
    return { ok: false, code: 'pay_request_pending', message: 'Waiting for the pay request to be approved' };
  }

  // Resolve the company payment method: the default, else the first saved. Must be a bank account —
  // the card path holds at booking and captures here, so this charge-at-completion path is bank-only.
  const methods = await listSavedCards(customerId);
  if (methods.length === 0) {
    await recordSelfPayNoMethod(supabase, appt, actor, 'no_saved_method');
    return { ok: false, code: 'no_org_card', message: 'No saved company payment method to charge' };
  }
  const pm = methods.find((m) => m.isDefault) ?? methods[0];
  if (pm.type !== 'us_bank_account') {
    await recordSelfPayNoMethod(supabase, appt, actor, 'default_not_bank');
    return { ok: false, code: 'no_org_bank', message: 'Company default payment method is not a bank account' };
  }

  const platformFeeBps = orgRow?.platform_fee_bps ?? 0;
  const { chargeCents, cleanerCutCents, platformFeeCents, estimatedFeeCents } = computeSelfPayAmountsFromCents({
    jobGrossCents,
    cleanerCutCents: cut.cutCents,
    platformFeeBps,
    method: 'us_bank_account',
  });
  if (chargeCents <= 0) return { ok: false, code: 'not_chargeable', message: 'Nothing to charge' };

  let pi;
  try {
    pi = await createSelfPayAchCharge({
      chargeCents,
      customerId,
      paymentMethodId: pm.id,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
    });
  } catch (err) {
    return { ok: false, code: 'failed', message: err instanceof Error ? err.message : 'ACH charge failed' };
  }

  // ACH PaymentIntent starts in `processing`; the row mirrors that until payment_intent.succeeded.
  // application_fee_amount/bps record the platform's retained fee (see chargeCompletedAppointment).
  const paymentRow = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: chargeCents / 100,
    processing_fee_cents: estimatedFeeCents,
    status: 'processing' as const,
    payment_type: 'revenue' as const,
    payment_method: 'ach' as const,
    charge_kind: 'completion' as const,
    is_self_pay: true,
    stripe_payment_intent_id: pi.id,
    application_fee_amount: platformFeeCents,
    application_fee_bps_snapshot: platformFeeBps,
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
    payload: {
      payment_intent_id: pi.id,
      pi_status: pi.status,
      self_pay: true,
      cleaner_cut_cents: cleanerCutCents,
      platform_fee_cents: platformFeeCents,
    },
  });

  return { ok: true, code: 'processing', paymentIntentId: pi.id };
}

/** Ledger + admin notification for a self-pay completion with no usable company method. */
async function recordSelfPayNoMethod(
  supabase: SupabaseClient,
  appt: ApptRow,
  actor: string,
  reason: string,
): Promise<void> {
  await recordPaymentEvent(supabase, {
    appointmentId: appt.id,
    organizationId: appt.organization_id,
    eventType: 'self_pay_no_card',
    actor,
    payload: { reason, rail: 'ach' },
  });
  const ctx = await loadNotificationContext(supabase, { appointmentId: appt.id, cleanerId: appt.cleaner_id });
  await recordNotificationEvent(supabase, {
    event_type: 'self_pay_no_card',
    appointment_id: appt.id,
    organization_id: appt.organization_id,
    dedupe_key: `self_pay_no_card:${appt.id}`,
    payload: { ...ctx, audience: 'admin', reason },
  });
}
