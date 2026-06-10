/**
 * "Charge now" orchestration for a COMPLETED appointment whose card authorization failed (and was
 * therefore never held / captured). The normal flow authorizes a manual-capture hold pre-service
 * and captures it on completion; if that hold never landed, there is nothing to capture, so once the
 * admin puts a working card on we charge it IMMEDIATELY here.
 *
 * Mirrors the authorize orchestrations (`authorizeAppointment` / `authorizeSelfPayAppointment`) but
 * uses the auto-capture charge primitives (`createDestinationCharge` / `createSelfPayCharge`):
 *   - a `succeeded` PaymentIntent is a paid revenue row (not a pending hold);
 *   - the cleaner/tenant split still settles on `payment_intent.succeeded` (homeowner via
 *     `on_behalf_of` → settleCleanerPayout; self-pay via `metadata.self_pay` → settleSelfPay), with
 *     the reconciliation sweep as the backstop, so settlement is webhook-driven, not inline.
 *
 * A bank (us_bank_account) default falls through to the existing ACH charge-at-completion
 * orchestrations (which already do an immediate debit). This is card-recovery for a finished job.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import { createSelfPayCharge } from '@/lib/stripe/charges/chargeSelfPay';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { computeChargeBreakdown } from './processingFee';
import { computeSelfPayAmounts } from './selfPayMath';
import { stripeFeePassthroughEnabled, stripeAchEnabled, stripeSelfPayEnabled } from '@/lib/stripe/flags';
import { getPaymentMethodType, listSavedCards } from '@/lib/stripe/customers/homeowner';
import { chargeAchAppointment } from './chargeAchAppointment';
import { chargeSelfPayAchAppointment } from './chargeSelfPayAchAppointment';
import { recordPaymentEvent } from './events';
import { clearFailedForBank } from './clearFailedForBank';

export type ChargeNowCode =
  | 'charged'
  | 'processing'
  | 'requires_action'
  | 'declined'
  | 'no_card'
  | 'no_org_card'
  | 'no_org_bank'
  | 'tenant_not_ready'
  | 'cleaner_not_payable'
  | 'not_chargeable'
  | 'failed'
  | 'error';

export interface ChargeNowOutcome {
  ok: boolean;
  code: ChargeNowCode;
  message?: string;
  paymentIntentId?: string;
}

interface AppointmentRow {
  id: string;
  organization_id: string;
  homeowner_id: string | null;
  cleaner_id: string | null;
  total_price: number | string;
  status: string;
  authorization_status: string | null;
  is_self_pay: boolean;
  payment_method_id: string | null;
  reauth_count: number | null;
}

/** Routes a completed appointment to the homeowner or self-pay charge-now path. */
export async function chargeCompletedAppointmentAuto(
  supabase: SupabaseClient,
  appointmentId: string,
  actor: string,
): Promise<ChargeNowOutcome> {
  const { data: apptData, error: apptErr } = await supabase
    .from('appointments')
    .select(
      'id, organization_id, homeowner_id, cleaner_id, total_price, status, authorization_status, is_self_pay, payment_method_id, reauth_count',
    )
    .eq('id', appointmentId)
    .maybeSingle();
  if (apptErr || !apptData) return { ok: false, code: 'error', message: 'Appointment not found' };
  const appt = apptData as AppointmentRow;

  // Charge-now is for a finished job. Upcoming jobs authorize a hold instead; cancelled jobs are
  // never charged.
  if (appt.status !== 'completed') {
    return { ok: false, code: 'not_chargeable', message: `Appointment is ${appt.status}, not completed` };
  }

  // Idempotency: a revenue row that is already paid or processing means the money is in flight (a
  // double-submit, a prior capture, or the webhook). Don't charge twice.
  const settled = await alreadySettled(supabase, appt.id);
  if (settled) return { ok: true, code: settled.code, message: 'Already charged', paymentIntentId: settled.paymentIntentId };

  return appt.is_self_pay
    ? chargeSelfPayNow(supabase, appt, actor)
    : chargeHomeownerNow(supabase, appt, actor);
}

/** Returns the in-flight outcome if a revenue row for the appointment is already paid/processing. */
async function alreadySettled(
  supabase: SupabaseClient,
  appointmentId: string,
): Promise<{ code: 'charged' | 'processing'; paymentIntentId?: string } | null> {
  const { data: rows } = await supabase
    .from('payments')
    .select('status, stripe_payment_intent_id')
    .eq('appointment_id', appointmentId)
    .eq('payment_type', 'revenue')
    .limit(1);
  const row = rows && rows.length > 0 ? (rows[0] as { status: string; stripe_payment_intent_id: string | null }) : null;
  if (!row) return null;
  if (row.status === 'paid') return { code: 'charged', paymentIntentId: row.stripe_payment_intent_id ?? undefined };
  if (row.status === 'processing') return { code: 'processing', paymentIntentId: row.stripe_payment_intent_id ?? undefined };
  return null;
}

/**
 * A prior terminal decline (`failed`) or unauthenticated `requires_action` means the old idempotency
 * key is spent (cached against that result, and the card has likely changed). Bump reauth_count so
 * the charge gets a fresh key.
 */
async function nextReauthAttempt(supabase: SupabaseClient, appt: AppointmentRow): Promise<number> {
  let attempt = appt.reauth_count ?? 0;
  if (appt.authorization_status === 'failed' || appt.authorization_status === 'requires_action') {
    attempt += 1;
    await supabase.from('appointments').update({ reauth_count: attempt }).eq('id', appt.id);
  }
  return attempt;
}

/** Upsert the single revenue payment row for an appointment. */
async function upsertRevenueRow(
  supabase: SupabaseClient,
  appointmentId: string,
  row: Record<string, unknown>,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('payments')
    .select('id')
    .eq('appointment_id', appointmentId)
    .eq('payment_type', 'revenue')
    .limit(1);
  if (existing && existing.length > 0) {
    const id = (existing[0] as { id: string }).id;
    await supabase.from('payments').update(row).eq('id', id);
    return id;
  }
  const { data: inserted } = await supabase.from('payments').insert(row).select('id').single();
  return (inserted as { id: string } | null)?.id ?? null;
}

// --- Homeowner -----------------------------------------------------------------------------------

async function chargeHomeownerNow(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  actor: string,
): Promise<ChargeNowOutcome> {
  if (!appt.payment_method_id) return { ok: false, code: 'no_card', message: 'No payment method on the appointment' };

  // A bank default is debited via the existing ACH charge-at-completion path (also immediate).
  if (stripeAchEnabled() && (await getPaymentMethodType(appt.payment_method_id)) === 'us_bank_account') {
    const outcome = await chargeAchAppointment(supabase, appt.id, actor);
    // The debit is in flight (processing), so the prior failed card auth is resolved — drop it out
    // of "Payments needing attention".
    if (outcome.ok) await clearFailedForBank(supabase, appt);
    return outcome;
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
    ? computeChargeBreakdown('card', baseCents)
    : { chargeCents: baseCents, feeCents: 0 };
  const platformFeeBps = org.platform_fee_bps ?? 0;
  const { platformFeeCents } = computePaymentSplit({ grossCents: baseCents, payoutPercent: 0, platformFeeBps });

  const reauthAttempt = await nextReauthAttempt(supabase, appt);

  let pi;
  try {
    pi = await createDestinationCharge({
      grossCents: chargeCents,
      customerId,
      paymentMethodId: appt.payment_method_id,
      tenantAccountId: org.stripe_connect_account_id,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      reauthAttempt,
    });
  } catch (err) {
    return recordChargeDecline(supabase, appt, actor, {
      amountCents: chargeCents,
      feeCents: passthrough ? feeCents : null,
      isSelfPay: false,
      err,
    });
  }

  const baseRow = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: chargeCents / 100,
    processing_fee_cents: passthrough ? feeCents : null,
    payment_type: 'revenue' as const,
    payment_method: 'card' as const,
    stripe_payment_intent_id: pi.id,
    on_behalf_of_account_id: org.stripe_connect_account_id,
    transfer_destination_account_id: org.stripe_connect_account_id,
    application_fee_amount: platformFeeCents,
    application_fee_bps_snapshot: platformFeeBps,
    payment_intent_status: pi.status,
  };
  return finishCharge(supabase, appt, pi, baseRow, chargeCents, actor);
}

// --- Self-pay ------------------------------------------------------------------------------------

async function chargeSelfPayNow(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  actor: string,
): Promise<ChargeNowOutcome> {
  type CleanerRow = {
    payout_model: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_onboarding_complete: boolean;
    payout_percent: number | string;
  };
  const [orgRes, cleanerRes] = await Promise.all([
    supabase.from('organizations').select('stripe_self_pay_customer_id').eq('id', appt.organization_id).maybeSingle(),
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
  if (!customerId) return { ok: false, code: 'no_org_card', message: 'Organization has no company card on file' };

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

  // Resolve the company method: default, else first. A bank default is debited via the existing
  // self-pay ACH charge-at-completion path (also immediate).
  const methods = await listSavedCards(customerId);
  if (methods.length === 0) return { ok: false, code: 'no_org_card', message: 'No saved company card to charge' };
  const method = methods.find((m) => m.isDefault) ?? methods[0];
  if (stripeAchEnabled() && stripeSelfPayEnabled() && method.type === 'us_bank_account') {
    const outcome = await chargeSelfPayAchAppointment(supabase, appt.id, actor);
    if (outcome.ok) await clearFailedForBank(supabase, appt);
    return outcome;
  }

  const jobGrossCents = Math.round(Number(appt.total_price) * 100);
  const { chargeCents, cleanerCutCents, estimatedFeeCents } = computeSelfPayAmounts({
    jobGrossCents,
    payoutPercent: Number(cleaner!.payout_percent),
  });

  const reauthAttempt = await nextReauthAttempt(supabase, appt);

  let pi;
  try {
    pi = await createSelfPayCharge({
      chargeCents,
      customerId,
      paymentMethodId: method.id,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      reauthAttempt,
    });
  } catch (err) {
    return recordChargeDecline(supabase, appt, actor, {
      amountCents: chargeCents,
      feeCents: estimatedFeeCents,
      isSelfPay: true,
      err,
    });
  }

  const baseRow = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: chargeCents / 100,
    processing_fee_cents: estimatedFeeCents,
    payment_type: 'revenue' as const,
    payment_method: 'card' as const,
    is_self_pay: true,
    stripe_payment_intent_id: pi.id,
    payment_intent_status: pi.status,
  };
  return finishCharge(supabase, appt, pi, baseRow, chargeCents, actor, { cleanerCutCents });
}

// --- Shared result handling ----------------------------------------------------------------------

/**
 * Maps the auto-capture PaymentIntent status to DB state + outcome. `succeeded` is the happy path
 * (paid row, captured); settlement to the cleaner runs on the payment_intent.succeeded webhook.
 */
async function finishCharge(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  pi: { id: string; status: string },
  baseRow: Record<string, unknown>,
  chargeCents: number,
  actor: string,
  extra?: { cleanerCutCents?: number },
): Promise<ChargeNowOutcome> {
  const now = new Date().toISOString();

  if (pi.status === 'succeeded') {
    await supabase.from('appointments').update({ authorization_status: 'captured' }).eq('id', appt.id);
    const paymentId = await upsertRevenueRow(supabase, appt.id, {
      ...baseRow,
      status: 'paid',
      authorized_at: now,
      captured_at: now,
      paid_at: now,
    });
    await recordPaymentEvent(supabase, {
      paymentId,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      eventType: 'charged',
      prevStatus: appt.authorization_status,
      newStatus: 'paid',
      actor,
      amount: chargeCents,
      payload: { payment_intent_id: pi.id, pi_status: pi.status, ...(extra ?? {}) },
    });
    return { ok: true, code: 'charged', paymentIntentId: pi.id };
  }

  if (pi.status === 'processing') {
    await upsertRevenueRow(supabase, appt.id, { ...baseRow, status: 'processing' });
    await recordPaymentEvent(supabase, {
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      eventType: 'charged',
      prevStatus: appt.authorization_status,
      newStatus: 'processing',
      actor,
      amount: chargeCents,
      payload: { payment_intent_id: pi.id, pi_status: pi.status, ...(extra ?? {}) },
    });
    return { ok: true, code: 'processing', paymentIntentId: pi.id };
  }

  if (pi.status === 'requires_action') {
    // 3-D Secure on an off-session charge: nothing was captured and the customer isn't present to
    // authenticate. Surface it so the row stays in "needs attention"; recovery is a different card.
    await supabase.from('appointments').update({ authorization_status: 'requires_action' }).eq('id', appt.id);
    await upsertRevenueRow(supabase, appt.id, { ...baseRow, status: 'failed' });
    return { ok: false, code: 'requires_action', paymentIntentId: pi.id, message: 'Customer authentication required' };
  }

  // Any other terminal status is a failure.
  await supabase.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);
  await upsertRevenueRow(supabase, appt.id, { ...baseRow, status: 'failed' });
  return { ok: false, code: 'error', message: `Unexpected PaymentIntent status: ${pi.status}`, paymentIntentId: pi.id };
}

/** Mirrors a charge decline into appointments/payments/ledger so the pill reads "Failed". */
async function recordChargeDecline(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  actor: string,
  opts: { amountCents: number; feeCents: number | null; isSelfPay: boolean; err: unknown },
): Promise<ChargeNowOutcome> {
  const failedPi = (opts.err as { payment_intent?: { id?: string; status?: string } }).payment_intent ?? null;
  await supabase.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);
  const row: Record<string, unknown> = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: opts.amountCents / 100,
    processing_fee_cents: opts.feeCents,
    status: 'failed',
    payment_type: 'revenue',
    payment_method: 'card',
    ...(opts.isSelfPay ? { is_self_pay: true } : {}),
  };
  if (failedPi?.id) {
    row.stripe_payment_intent_id = failedPi.id;
    row.payment_intent_status = failedPi.status ?? 'requires_payment_method';
  }
  const paymentId = await upsertRevenueRow(supabase, appt.id, row);
  await recordPaymentEvent(supabase, {
    paymentId,
    appointmentId: appt.id,
    organizationId: appt.organization_id,
    eventType: 'charge_failed',
    prevStatus: appt.authorization_status,
    newStatus: 'failed',
    actor,
    amount: opts.amountCents,
    payload: {
      error: opts.err instanceof Error ? opts.err.message : String(opts.err),
      payment_intent_id: failedPi?.id ?? null,
      self_pay: opts.isSelfPay,
    },
  });
  return { ok: false, code: 'declined', message: opts.err instanceof Error ? opts.err.message : 'Charge declined' };
}
