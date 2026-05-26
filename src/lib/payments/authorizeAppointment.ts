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
import { recordPaymentEvent } from './events';

export type AuthorizeCode =
  | 'authorized'
  | 'requires_action'
  | 'no_card'
  | 'tenant_not_ready'
  | 'not_authorizable'
  | 'declined'
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

  const grossCents = Math.round(Number(appt.total_price) * 100);
  const platformFeeBps = org.platform_fee_bps ?? 0;
  const { platformFeeCents } = computePaymentSplit({ grossCents, payoutPercent: 0, platformFeeBps });

  await supabase.from('appointments').update({ authorization_status: 'authorizing' }).eq('id', appt.id);

  let pi;
  try {
    pi = await createDestinationAuthorization({
      grossCents,
      customerId,
      paymentMethodId: appt.payment_method_id,
      tenantAccountId: org.stripe_connect_account_id,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      reauthAttempt: appt.reauth_count ?? 0,
    });
  } catch (err) {
    await supabase.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);
    await recordPaymentEvent(supabase, {
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      eventType: 'authorize_failed',
      prevStatus: appt.authorization_status,
      newStatus: 'failed',
      actor,
      amount: grossCents,
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
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
    amount: grossCents / 100,
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
    amount: grossCents,
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
