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
import { computeSelfPayAmounts } from './selfPayMath';
import { recordPaymentEvent } from './events';

export type SelfPayAchChargeCode =
  | 'processing'
  | 'no_org_card'
  | 'no_org_bank'
  | 'cleaner_not_payable'
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
  };
  const [orgRes, cleanerRes] = await Promise.all([
    supabase
      .from('organizations')
      .select('stripe_self_pay_customer_id')
      .eq('id', appt.organization_id)
      .maybeSingle(),
    appt.cleaner_id
      ? supabase
          .from('cleaner_profiles')
          .select('payout_model, stripe_connect_account_id, stripe_connect_onboarding_complete, payout_percent')
          .eq('id', appt.cleaner_id)
          .maybeSingle()
      : Promise.resolve({ data: null as CleanerRow | null }),
  ]);

  const customerId =
    (orgRes.data as { stripe_self_pay_customer_id: string | null } | null)?.stripe_self_pay_customer_id ?? null;
  if (!customerId) {
    return { ok: false, code: 'no_org_card', message: 'Organization has no company payment method on file' };
  }

  // The assigned cleaner must be payout-capable (the charge amount depends on their %).
  const cleaner = cleanerRes.data as CleanerRow | null;
  const cleanerPayable =
    !!cleaner &&
    cleaner.payout_model !== 'hourly_external' &&
    !!cleaner.stripe_connect_account_id &&
    cleaner.stripe_connect_onboarding_complete &&
    Number(cleaner.payout_percent) > 0;
  if (!cleanerPayable) {
    return {
      ok: false,
      code: 'cleaner_not_payable',
      message: 'Self-pay requires a payout-capable cleaner (Connect onboarded, payout % > 0)',
    };
  }

  // Resolve the company payment method: the default, else the first saved. Must be a bank account —
  // the card path holds at booking and captures here, so this charge-at-completion path is bank-only.
  const methods = await listSavedCards(customerId);
  if (methods.length === 0) {
    return { ok: false, code: 'no_org_card', message: 'No saved company payment method to charge' };
  }
  const pm = methods.find((m) => m.isDefault) ?? methods[0];
  if (pm.type !== 'us_bank_account') {
    return { ok: false, code: 'no_org_bank', message: 'Company default payment method is not a bank account' };
  }

  const jobGrossCents = Math.round(Number(appt.total_price) * 100);
  const { chargeCents, cleanerCutCents, estimatedFeeCents } = computeSelfPayAmounts({
    jobGrossCents,
    payoutPercent: Number(cleaner!.payout_percent),
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
  const paymentRow = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: chargeCents / 100,
    processing_fee_cents: estimatedFeeCents,
    status: 'processing' as const,
    payment_type: 'revenue' as const,
    payment_method: 'ach' as const,
    is_self_pay: true,
    stripe_payment_intent_id: pi.id,
    payment_intent_status: pi.status,
  };

  const { data: anyRow } = await supabase
    .from('payments')
    .select('id')
    .eq('appointment_id', appt.id)
    .eq('payment_type', 'revenue')
    .limit(1);
  let paymentId: string | null = null;
  if (anyRow && anyRow.length > 0) {
    paymentId = (anyRow[0] as { id: string }).id;
    await supabase.from('payments').update(paymentRow).eq('id', paymentId);
  } else {
    const { data: inserted } = await supabase.from('payments').insert(paymentRow).select('id').single();
    paymentId = (inserted as { id: string } | null)?.id ?? null;
  }

  await recordPaymentEvent(supabase, {
    paymentId,
    appointmentId: appt.id,
    organizationId: appt.organization_id,
    eventType: 'ach_charge_initiated',
    newStatus: 'processing',
    actor,
    amount: chargeCents,
    payload: { payment_intent_id: pi.id, pi_status: pi.status, self_pay: true, cleaner_cut_cents: cleanerCutCents },
  });

  return { ok: true, code: 'processing', paymentIntentId: pi.id };
}
