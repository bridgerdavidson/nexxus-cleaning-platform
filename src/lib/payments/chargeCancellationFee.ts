/**
 * Off-session cancellation / no-show fee charge.
 *
 * With no upfront hold, a homeowner-fault late-cancel or no-show fee is collected by charging the
 * saved card on file at cancel time (idempotency key `cancelfee-{appointmentId}-{attempt}`, a
 * distinct prefix from the completion charge's `charge-` key). A prior FAILED fee attempt bumps
 * the attempt counter so a retry gets a fresh key — Stripe caches an idempotency key against its
 * original outcome (and rejects key reuse with a different amount if the fee policy changed), so
 * without the bump a same-day retry could only ever replay the original decline. The caller marks
 * the appointment cancelled BEFORE this runs, so the fee charge's `payment_intent.succeeded`
 * settles to the TENANT only: `settleCleanerPayout` never pays the cleaner for a cancelled job,
 * and the split is computed on the captured fee amount.
 *
 * Best-effort and never blocks the cancellation:
 *   - no saved card, a bank (ACH) payer, an unready tenant, or no customer -> 'uncollectable' ($0);
 *   - a decline or off-session 3-D Secure (the customer isn't present to authenticate) -> 'failed'.
 * Every terminal outcome is written to the `payment_events` ledger AND surfaced to admins as a
 * `cancellation_fee_failed` notification (the fee is lost revenue someone has to act on).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createDestinationCharge } from '@/lib/stripe/charges/charge';
import { computePaymentSplit } from '@/lib/stripe/charges/splits';
import { getPaymentMethodType } from '@/lib/stripe/customers/homeowner';
import { recordPaymentEvent } from './events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';
import { notifyHomeownerCancellationFeeCharged } from './homeownerMoneyEvents';

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
  /** Charge-attempt counter shared with the completion charge (distinct key prefixes). */
  reauth_count: number | null;
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

  // Admin alert: an assessed fee that wasn't collected is lost revenue with no other signal.
  const notifyFeeFailed = async (reason: string, dedupeSuffix?: string) => {
    const ctx = await loadNotificationContext(supabase, { appointmentId: appt.id });
    await recordNotificationEvent(supabase, {
      event_type: 'cancellation_fee_failed',
      appointment_id: appt.id,
      organization_id: appt.organization_id,
      dedupe_key: `cancellation_fee_failed:${appt.id}${dedupeSuffix ? `:${dedupeSuffix}` : ''}`,
      payload: { ...ctx, audience: 'admin', amount_cents: feeCents, reason },
    });
  };

  // Idempotency: a paid/processing revenue row means the fee already went through (a retry or the
  // webhook). Don't charge again. Reuse the row for any later status write.
  const { data: existingRows } = await supabase
    .from('payments')
    .select('id, status, stripe_payment_intent_id, charge_kind')
    .eq('appointment_id', appt.id)
    .eq('payment_type', 'revenue')
    .order('created_at', { ascending: false })
    .limit(1);
  const existing =
    existingRows && existingRows.length > 0
      ? (existingRows[0] as {
          id: string;
          status: string;
          stripe_payment_intent_id: string | null;
          charge_kind: string | null;
        })
      : null;
  if (existing && (existing.status === 'paid' || existing.status === 'processing')) {
    // T2-1 recovery: a crash between the paid-row write below and its notification would otherwise
    // leave that fee permanently un-notified, since every retry lands here. Re-emitting is free
    // (same dedupe key). Narrowed to a CAPTURED FEE row so a paid completion charge can never be
    // announced as a cancellation fee.
    if (
      existing.status === 'paid' &&
      existing.charge_kind === 'cancellation_fee' &&
      existing.stripe_payment_intent_id &&
      appt.homeowner_id
    ) {
      await notifyHomeownerCancellationFeeCharged(supabase, {
        appointmentId: appt.id,
        organizationId: appt.organization_id,
        homeownerId: appt.homeowner_id,
        paymentIntentId: existing.stripe_payment_intent_id,
        amountCents: feeCents,
        noShow: context.noShow,
      });
    }
    return { code: 'charged', feeCapturedCents: feeCents, paymentIntentId: existing.stripe_payment_intent_id ?? undefined };
  }

  if (!appt.payment_method_id || !appt.homeowner_id) {
    await ledger('cancellation_fee_uncollectable', { reason: 'no_card' });
    await notifyFeeFailed('no_card');
    return { code: 'uncollectable', feeCapturedCents: 0 };
  }

  // A bank (ACH) payer: don't off-session debit a small, return-prone fee. Mark it uncollectable.
  if ((await getPaymentMethodType(appt.payment_method_id)) === 'us_bank_account') {
    await ledger('cancellation_fee_uncollectable', { reason: 'ach_payer' });
    await notifyFeeFailed('ach_payer');
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
    await notifyFeeFailed('tenant_not_ready');
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
    await notifyFeeFailed('no_customer');
    return { code: 'uncollectable', feeCapturedCents: 0 };
  }

  const platformFeeBps = org.platform_fee_bps ?? 0;
  const { platformFeeCents } = computePaymentSplit({ grossCents: feeCents, payoutPercent: 0, platformFeeBps });

  // A prior FAILED fee attempt means its idempotency key is spent (cached against the decline, or
  // pinned to a different fee amount). Bump the shared attempt counter so this retry is a real
  // new charge. The completion charge uses a distinct key prefix, so the shared counter is safe.
  let reauthAttempt = appt.reauth_count ?? 0;
  if (existing && existing.status === 'failed') {
    reauthAttempt += 1;
    await supabase.from('appointments').update({ reauth_count: reauthAttempt }).eq('id', appt.id);
  }

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
      reauthAttempt,
    });
  } catch (err) {
    // Persist a FAILED revenue row even on a thrown decline: the retry-bump above keys off it
    // (without it a hard decline would retry forever on the same spent idempotency key), and it
    // keeps the failure visible in the payments views.
    const failedPi = (err as { payment_intent?: { id?: string; status?: string } }).payment_intent ?? null;
    const failedRow: Record<string, unknown> = {
      organization_id: appt.organization_id,
      appointment_id: appt.id,
      amount: feeCents / 100,
      status: 'failed',
      payment_type: 'revenue',
      payment_method: 'card',
      charge_kind: 'cancellation_fee',
      ...(failedPi?.id
        ? { stripe_payment_intent_id: failedPi.id, payment_intent_status: failedPi.status ?? 'requires_payment_method' }
        : {}),
    };
    let failedPaymentId = existing?.id ?? null;
    if (existing) {
      await supabase.from('payments').update(failedRow).eq('id', existing.id);
    } else {
      const { data: inserted } = await supabase.from('payments').insert(failedRow).select('id').maybeSingle();
      failedPaymentId = (inserted as { id: string } | null)?.id ?? null;
    }
    await ledger('cancellation_fee_failed', { error: err instanceof Error ? err.message : String(err) }, failedPaymentId);
    await notifyFeeFailed('declined', `attempt-${reauthAttempt}`);
    return { code: 'failed', feeCapturedCents: 0, message: err instanceof Error ? err.message : 'Card declined' };
  }

  const baseRow = {
    organization_id: appt.organization_id,
    appointment_id: appt.id,
    amount: feeCents / 100,
    payment_type: 'revenue' as const,
    payment_method: 'card' as const,
    charge_kind: 'cancellation_fee' as const,
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
    // T2-1: the homeowner's record of a fee charged off-session, so it isn't first seen on a
    // bank statement. Only the charging path notifies; the paid-row short-circuit above is a
    // re-entry of an attempt that already sent it.
    await notifyHomeownerCancellationFeeCharged(supabase, {
      appointmentId: appt.id,
      organizationId: appt.organization_id,
      homeownerId: appt.homeowner_id,
      paymentIntentId: pi.id,
      amountCents: feeCents,
      noShow: context.noShow,
    });
    return { code: 'charged', feeCapturedCents: feeCents, paymentIntentId: pi.id };
  }

  // requires_action (off-session 3-D Secure: the customer isn't present) or any other non-success.
  // Don't block the cancellation; record the attempt as failed so it's visible and ledgered.
  const paymentId = await upsertRow({ ...baseRow, status: 'failed' });
  await ledger('cancellation_fee_failed', { payment_intent_id: pi.id, pi_status: pi.status }, paymentId);
  await notifyFeeFailed('authentication_required', pi.id);
  return { code: 'failed', feeCapturedCents: 0, paymentIntentId: pi.id, message: 'Customer authentication required' };
}
