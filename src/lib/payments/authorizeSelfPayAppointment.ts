/**
 * "Authorize an ORG self-pay appointment" orchestration — sibling of authorizeAppointment.
 *
 * Loads the appointment + org self-pay card + assigned cleaner, validates the cleaner is
 * payout-capable, computes the grossed-up charge (cleaner cut + Stripe fee), places a
 * manual-capture hold on the company card, and mirrors the result into appointments
 * (authorization_status), payments (a pending row flagged is_self_pay) and the payment_events
 * ledger. The cleaner is paid post-capture by settleSelfPay.
 *
 * Differences from the homeowner path: the card belongs to the ORG (organizations
 * .stripe_self_pay_customer_id, default PM), there is no homeowner, no tenant merchant of record,
 * and the amount is derived from the assigned cleaner's payout% (so the cleaner must be locked in).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSelfPayAuthorization } from '@/lib/stripe/charges/authorizeSelfPay';
import { computeSelfPayAmounts } from './selfPayMath';
import { listSavedCards } from '@/lib/stripe/customers/homeowner';
import { stripeAchEnabled } from '@/lib/stripe/flags';
import { recordPaymentEvent } from './events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

export type SelfPayAuthorizeCode =
  | 'authorized'
  | 'requires_action'
  | 'no_org_card'
  | 'cleaner_not_payable'
  | 'not_authorizable'
  | 'declined'
  | 'deferred_ach'
  | 'error';

export interface SelfPayAuthorizeOutcome {
  ok: boolean;
  code: SelfPayAuthorizeCode;
  message?: string;
  paymentIntentId?: string;
}

interface AppointmentRow {
  id: string;
  organization_id: string;
  cleaner_id: string | null;
  total_price: number | string;
  status: string;
  authorization_status: string | null;
  is_self_pay: boolean;
  reauth_count: number | null;
}

export async function authorizeSelfPayAppointment(
  supabase: SupabaseClient,
  appointmentId: string,
  actor: string,
): Promise<SelfPayAuthorizeOutcome> {
  const { data: apptData, error: apptErr } = await supabase
    .from('appointments')
    .select('id, organization_id, cleaner_id, total_price, status, authorization_status, is_self_pay, reauth_count')
    .eq('id', appointmentId)
    .maybeSingle();

  if (apptErr || !apptData) return { ok: false, code: 'error', message: 'Appointment not found' };
  const appt = apptData as AppointmentRow;

  if (!appt.is_self_pay) {
    return { ok: false, code: 'error', message: 'Appointment is not self-pay' };
  }
  if (appt.status === 'cancelled' || appt.status === 'completed') {
    return { ok: false, code: 'not_authorizable', message: `Appointment is ${appt.status}` };
  }
  if (appt.authorization_status === 'authorized' || appt.authorization_status === 'captured') {
    return { ok: true, code: 'authorized', message: 'Already authorized' };
  }

  // The org's company card and the assigned cleaner are independent reads — fetch them
  // concurrently to shave a round-trip off the hot path (this runs inside a request that has to
  // beat the function timeout).
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

  // The org must have a saved company card (its self-pay platform Customer + a PaymentMethod).
  const customerId =
    (orgRes.data as { stripe_self_pay_customer_id: string | null } | null)?.stripe_self_pay_customer_id ?? null;
  if (!customerId) {
    return { ok: false, code: 'no_org_card', message: 'Organization has no company card on file' };
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

  // Resolve the company payment method: the default PaymentMethod, else the first saved.
  const cards = await listSavedCards(customerId);
  if (cards.length === 0) {
    return { ok: false, code: 'no_org_card', message: 'No saved company card to charge' };
  }
  const defaultMethod = cards.find((c) => c.isDefault) ?? cards[0];

  // Bank (ACH) can't be held: skip the authorization at booking and charge at completion instead
  // (chargeSelfPayAchAppointment). Mirrors the homeowner `deferred_ach` skip. Return BEFORE the
  // `authorizing` write + hold so a bank self-pay leaves authorization_status untouched.
  if (stripeAchEnabled() && defaultMethod.type === 'us_bank_account') {
    return { ok: true, code: 'deferred_ach', message: 'Bank payment is charged when the job is completed' };
  }

  const paymentMethodId = defaultMethod.id;

  const jobGrossCents = Math.round(Number(appt.total_price) * 100);
  const { chargeCents, cleanerCutCents } = computeSelfPayAmounts({
    jobGrossCents,
    payoutPercent: Number(cleaner!.payout_percent),
  });

  await supabase.from('appointments').update({ authorization_status: 'authorizing' }).eq('id', appt.id);

  let pi;
  try {
    pi = await createSelfPayAuthorization({
      chargeCents,
      customerId,
      paymentMethodId,
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      reauthAttempt: appt.reauth_count ?? 0,
    });
  } catch (err) {
    await supabase.from('appointments').update({ authorization_status: 'failed' }).eq('id', appt.id);
    await upsertSelfPayPaymentRow(supabase, appt, {
      amount: chargeCents / 100,
      status: 'failed',
      payment_intent_status:
        (err as { payment_intent?: { status?: string } }).payment_intent?.status ?? 'requires_payment_method',
      stripe_payment_intent_id: (err as { payment_intent?: { id?: string } }).payment_intent?.id ?? null,
    });
    await recordPaymentEvent(supabase, {
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      eventType: 'authorize_failed',
      prevStatus: appt.authorization_status,
      newStatus: 'failed',
      actor,
      amount: chargeCents,
      payload: {
        error: err instanceof Error ? err.message : String(err),
        self_pay: true,
        cleaner_cut_cents: cleanerCutCents,
      },
    });

    // Alert admins in-app, only on the transition INTO failed (self-pay customer
    // resolves to the org name, since there is no homeowner).
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

  await upsertSelfPayPaymentRow(supabase, appt, {
    amount: chargeCents / 100,
    status: 'pending',
    stripe_payment_intent_id: pi.id,
    authorized_at: new Date().toISOString(),
    payment_intent_status: piStatus,
  });

  await recordPaymentEvent(supabase, {
    appointmentId: appt.id,
    organizationId: appt.organization_id,
    eventType: 'authorized',
    prevStatus: appt.authorization_status,
    newStatus: newAuthStatus,
    actor,
    amount: chargeCents,
    payload: { payment_intent_id: pi.id, pi_status: piStatus, self_pay: true, cleaner_cut_cents: cleanerCutCents },
  });

  if (newAuthStatus === 'authorized') return { ok: true, code: 'authorized', paymentIntentId: pi.id };
  if (newAuthStatus === 'requires_action') {
    return { ok: false, code: 'requires_action', paymentIntentId: pi.id, message: 'Customer authentication required' };
  }
  return { ok: false, code: 'error', message: `Unexpected PaymentIntent status: ${piStatus}`, paymentIntentId: pi.id };
}

/** Upsert the single self-pay charge row for an appointment (one revenue-typed, is_self_pay row). */
async function upsertSelfPayPaymentRow(
  supabase: SupabaseClient,
  appt: AppointmentRow,
  fields: Record<string, unknown>,
): Promise<void> {
  const row = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    payment_type: 'revenue' as const,
    payment_method: 'card' as const,
    is_self_pay: true,
    ...fields,
  };
  const { data: existingRows } = await supabase
    .from('payments')
    .select('id')
    .eq('appointment_id', appt.id)
    .eq('payment_type', 'revenue')
    .limit(1);
  const existing = existingRows && existingRows.length > 0 ? (existingRows[0] as { id: string }) : null;
  if (existing) {
    await supabase.from('payments').update(row).eq('id', existing.id);
  } else {
    await supabase.from('payments').insert(row);
  }
}
