/**
 * Shared "authorize an appointment" orchestration — used by both the admin/staff
 * authorize route and the just-in-time authorizer cron (Phase 2c).
 *
 * Loads the appointment + tenant + homeowner, validates readiness, creates the
 * manual-capture destination-charge authorization, and mirrors the result into
 * `appointments` (authorization_status), `payments` (a pending revenue row), and the
 * `payment_events` ledger. Returns a structured outcome the caller maps to HTTP/log.
 *
 * The cleaner's percentage payout is NOT computed/transferred here — only the platform
 * fee snapshot. Settlement to the cleaner happens post-capture from the tenant's balance
 * (Phase 3).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDestinationAuthorization } from '@/lib/stripe/charges/authorize';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { computeChargeBreakdown } from './processingFee';
import { stripeFeePassthroughEnabled, stripeAchEnabled } from '@/lib/stripe/flags';
import { getPaymentMethodType } from '@/lib/stripe/customers/homeowner';
import { recordPaymentEvent } from './events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

export type AuthorizeCode =
  | 'authorized'
  | 'requires_action'
  | 'no_card'
  | 'tenant_not_ready'
  | 'not_authorizable'
  | 'declined'
  | 'deferred_ach'
  | 'error';

export interface AuthorizeOutcome {
  ok: boolean;
  code: AuthorizeCode;
  message?: string;
  paymentIntentId?: string;
}

interface AppointmentRow {
  id: string;
  organization_id: string;
  homeowner_id: string;
  total_price: number | string;
  status: string;
  authorization_status: string | null;
  payment_method_id: string | null;
  reauth_count: number | null;
}

export async function authorizeAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  actor: string,
): Promise<AuthorizeOutcome> {
  const { data: apptData, error: apptErr } = await supabase
    .from('appointments')
    .select(
      'id, organization_id, homeowner_id, total_price, status, authorization_status, payment_method_id, reauth_count',
    )
    .eq('id', appointmentId)
    .maybeSingle();

  if (apptErr || !apptData) {
    return { ok: false, code: 'error', message: 'Appointment not found' };
  }
  const appt = apptData as AppointmentRow;

  // Not in an authorizable lifecycle state.
  if (appt.status === 'cancelled' || appt.status === 'completed') {
    return { ok: false, code: 'not_authorizable', message: `Appointment is ${appt.status}` };
  }
  // Already has a live/used authorization — idempotent success.
  if (appt.authorization_status === 'authorized' || appt.authorization_status === 'captured') {
    return { ok: true, code: 'authorized', message: 'Already authorized' };
  }
  if (!appt.payment_method_id) {
    return { ok: false, code: 'no_card', message: 'No payment method selected for this appointment' };
  }

  // Bank (ACH) methods have NO manual-capture hold — they're charged at completion, not authorized
  // here. Detect a us_bank_account PM and defer (no card-style hold, no 'failed' status) so a
  // selected bank never hits the unsupported manual-capture path; the ACH charge-at-completion
  // lifecycle performs the actual debit. Gated by STRIPE_ACH_ENABLED (bank methods only offered then).
  if (stripeAchEnabled() && (await getPaymentMethodType(appt.payment_method_id)) === 'us_bank_account') {
    return { ok: true, code: 'deferred_ach', message: 'Bank payment is charged when the job is completed (no hold).' };
  }

  // Tenant must be a ready merchant of record.
  const { data: orgData } = await supabase
    .from('organizations')
    .select('stripe_connect_account_id, stripe_connect_charges_enabled, platform_fee_bps')
    .eq('id', appt.organization_id)
    .maybeSingle();
  const org = orgData as
    | { stripe_connect_account_id: string | null; stripe_connect_charges_enabled: boolean; platform_fee_bps: number }
    | null;
  if (!org?.stripe_connect_account_id || !org.stripe_connect_charges_enabled) {
    return {
      ok: false,
      code: 'tenant_not_ready',
      message: 'Organization Stripe account is not ready to accept charges',
    };
  }

  // Homeowner must have a platform Customer with the saved card attached.
  const { data: hoData } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', appt.homeowner_id)
    .maybeSingle();
  const customerId = (hoData as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;
  if (!customerId) {
    return { ok: false, code: 'no_card', message: 'Homeowner has no saved payment profile' };
  }

  const baseCents = Math.round(Number(appt.total_price) * 100);
  // The payer covers the processing fee: charge the service price grossed up so the platform nets
  // the base. The card path uses the card schedule (ACH is charged later, at completion). Flag-gated.
  const passthrough = stripeFeePassthroughEnabled();
  const { chargeCents, feeCents } = passthrough
    ? computeChargeBreakdown('card', baseCents)
    : { chargeCents: baseCents, feeCents: 0 };
  const platformFeeBps = org.platform_fee_bps ?? 0;
  // Platform fee is a % of the SERVICE PRICE (base), never the passed-through processing fee.
  const { platformFeeCents } = computePaymentSplit({ grossCents: baseCents, payoutPercent: 0, platformFeeBps });

  await supabase.from('appointments').update({ authorization_status: 'authorizing' }).eq('id', appt.id);

  let pi;
  try {
    pi = await createDestinationAuthorization({
      grossCents: chargeCents,
      customerId,
      paymentMethodId: appt.payment_method_id,
      tenantAccountId: org.stripe_connect_account_id,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      reauthAttempt: appt.reauth_count ?? 0,
    });
  } catch (err) {
    await supabase.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);

    // Reflect the decline in the payments ledger so the admin payment pill reads "Failed" — the
    // pill is derived from payments.status, so without a row it would stay a misleading "Unpaid".
    // Capture the failed PaymentIntent id from the Stripe error when present (the PI is created
    // before the off_session confirm declines) so payment_intent.payment_failed reconciles the
    // same row. A later successful re-auth upserts this row back to 'pending'.
    const failedPi = (err as { payment_intent?: { id?: string; status?: string } }).payment_intent ?? null;
    const failedRow: Record<string, unknown> = {
      organization_id: appt.organization_id,
      appointment_id: appt.id,
      amount: chargeCents / 100,
      processing_fee_cents: passthrough ? feeCents : null,
      status: 'failed',
      payment_type: 'revenue',
      payment_method: 'card',
    };
    if (failedPi?.id) {
      failedRow.stripe_payment_intent_id = failedPi.id;
      failedRow.payment_intent_status = failedPi.status ?? 'requires_payment_method';
    }
    const { data: existingFailRows } = await supabase
      .from('payments')
      .select('id')
      .eq('appointment_id', appt.id)
      .eq('payment_type', 'revenue')
      .limit(1);
    const existingFail =
      existingFailRows && existingFailRows.length > 0 ? (existingFailRows[0] as { id: string }) : null;
    let failedPaymentId: string | null = existingFail?.id ?? null;
    if (existingFail) {
      await supabase.from('payments').update(failedRow).eq('id', existingFail.id);
    } else {
      const { data: insertedFail } = await supabase.from('payments').insert(failedRow).select('id').single();
      failedPaymentId = (insertedFail as { id: string } | null)?.id ?? null;
    }

    await recordPaymentEvent(supabase, {
      paymentId: failedPaymentId,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      eventType: 'authorize_failed',
      prevStatus: appt.authorization_status,
      newStatus: 'failed',
      actor,
      amount: chargeCents,
      payload: {
        error: err instanceof Error ? err.message : String(err),
        payment_intent_id: failedPi?.id ?? null,
      },
    });

    // Alert admins in-app, but only on the transition INTO failed so the JIT
    // authorizer cron's later retries don't re-notify for the same appointment.
    if (appt.authorization_status !== 'failed') {
      const ctx = await loadNotificationContext(supabase, { appointmentId: appt.id });
      await recordNotificationEvent(supabase, {
        event_type: 'authorization_failed',
        appointment_id: appt.id,
        organization_id: appt.organization_id,
        payload: { ...ctx, audience: 'admin', amount_cents: chargeCents },
      });
    }

    return { ok: false, code: 'declined', message: err instanceof Error ? err.message : 'Authorization declined' };
  }

  const piStatus = pi.status;
  const newAuthStatus =
    piStatus === 'requires_capture'
      ? 'authorized'
      : piStatus === 'requires_action'
        ? 'requires_action'
        : piStatus === 'succeeded'
          ? 'captured'
          : 'failed';

  await supabase.from('appointments').update({ authorization_status: newAuthStatus }).eq('id', appt.id);

  // Upsert the pending revenue payment row for this appointment.
  const paymentRow = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: chargeCents / 100,
    processing_fee_cents: passthrough ? feeCents : null,
    status: 'pending' as const,
    payment_type: 'revenue' as const,
    payment_method: 'card' as const,
    stripe_payment_intent_id: pi.id,
    authorized_at: new Date().toISOString(),
    on_behalf_of_account_id: org.stripe_connect_account_id,
    transfer_destination_account_id: org.stripe_connect_account_id,
    application_fee_amount: platformFeeCents,
    application_fee_bps_snapshot: platformFeeBps,
    payment_intent_status: piStatus,
  };

  const { data: existingRows } = await supabase
    .from('payments')
    .select('id')
    .eq('appointment_id', appt.id)
    .eq('payment_type', 'revenue')
    .limit(1);
  const existing = existingRows && existingRows.length > 0 ? (existingRows[0] as { id: string }) : null;

  let paymentId: string | null = existing?.id ?? null;
  if (existing) {
    await supabase.from('payments').update(paymentRow).eq('id', existing.id);
  } else {
    const { data: inserted } = await supabase.from('payments').insert(paymentRow).select('id').single();
    paymentId = (inserted as { id: string } | null)?.id ?? null;
  }

  await recordPaymentEvent(supabase, {
    paymentId,
    appointmentId: appt.id,
    organizationId: appt.organization_id,
    eventType: 'authorized',
    prevStatus: appt.authorization_status,
    newStatus: newAuthStatus,
    actor,
    amount: chargeCents,
    payload: { payment_intent_id: pi.id, pi_status: piStatus },
  });

  if (newAuthStatus === 'authorized') {
    return { ok: true, code: 'authorized', paymentIntentId: pi.id };
  }
  if (newAuthStatus === 'requires_action') {
    return { ok: false, code: 'requires_action', paymentIntentId: pi.id, message: 'Customer authentication required' };
  }
  return { ok: false, code: 'error', message: `Unexpected PaymentIntent status: ${piStatus}`, paymentIntentId: pi.id };
}
