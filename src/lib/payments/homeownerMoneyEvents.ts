/**
 * Homeowner-audience money notifications (audit T2-1).
 *
 * The render half (bell + toast copy) shipped in `src/lib/notifications/labels.ts`
 * (`describeHomeownerMoneyEvent`); this module is the emit half. The event-type strings, payload
 * fields, and dedupe-key shapes are a contract with that renderer — see
 * `docs/redesign/2026-07-27-t2-1-homeowner-money-events-contract.md` before changing either side.
 *
 * Every function is best-effort and never throws: these run inside money paths (webhook
 * settlement, refund creation, the off-session cancel-fee charge) where a notification failure
 * must never change the money outcome. Self-pay appointments never notify — the payer there is
 * the org, not a homeowner.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

/** The receipt: the off-session completion charge landed on the homeowner's card/bank. */
export async function notifyHomeownerChargeSucceeded(
  supabase: SupabaseClient,
  p: {
    appointmentId: string;
    organizationId: string;
    homeownerId: string;
    paymentIntentId: string;
    /** What actually hit the card (gross + any passthrough processing fee). */
    amountCents: number;
  },
): Promise<void> {
  try {
    const ctx = await loadNotificationContext(supabase, { appointmentId: p.appointmentId });
    await recordNotificationEvent(supabase, {
      event_type: 'charge_succeeded',
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      recipient_user_id: p.homeownerId,
      dedupe_key: `charge_succeeded:${p.appointmentId}:${p.paymentIntentId}`,
      payload: { ...ctx, audience: 'homeowner', amount_cents: p.amountCents },
    });
  } catch (err) {
    console.error('notifyHomeownerChargeSucceeded failed (non-blocking):', err);
  }
}

/**
 * A refund was created at Stripe, so the homeowner hears it from the app before their bank
 * statement. Loads the appointment itself: both creation sites (operator refund route, cancelled
 * in-flight auto-refund) hold only the payments row, and the self-pay/no-homeowner skip belongs
 * here rather than copied at each site.
 */
export async function notifyHomeownerRefundIssued(
  supabase: SupabaseClient,
  p: {
    appointmentId: string;
    organizationId: string;
    /** Stripe refund id — the dedupe key, one notification per refund object. */
    refundId: string;
    amountCents: number;
  },
): Promise<void> {
  try {
    const { data } = await supabase
      .from('appointments')
      .select('homeowner_id, is_self_pay')
      .eq('id', p.appointmentId)
      .maybeSingle();
    const appt = data as { homeowner_id: string | null; is_self_pay: boolean | null } | null;
    if (!appt?.homeowner_id || appt.is_self_pay) return;

    const ctx = await loadNotificationContext(supabase, { appointmentId: p.appointmentId });
    await recordNotificationEvent(supabase, {
      event_type: 'refund_issued',
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      recipient_user_id: appt.homeowner_id,
      dedupe_key: `refund_issued:${p.refundId}`,
      payload: { ...ctx, audience: 'homeowner', amount_cents: p.amountCents },
    });
  } catch (err) {
    console.error('notifyHomeownerRefundIssued failed (non-blocking):', err);
  }
}

/** The post-hoc record for a cancel/no-show fee that hit the saved card off-session. */
export async function notifyHomeownerCancellationFeeCharged(
  supabase: SupabaseClient,
  p: {
    appointmentId: string;
    organizationId: string;
    homeownerId: string;
    paymentIntentId: string;
    amountCents: number;
    /** Drives the rendered wording: no-show fee vs cancellation fee. */
    noShow: boolean;
  },
): Promise<void> {
  try {
    const ctx = await loadNotificationContext(supabase, { appointmentId: p.appointmentId });
    await recordNotificationEvent(supabase, {
      event_type: 'cancellation_fee_charged',
      appointment_id: p.appointmentId,
      organization_id: p.organizationId,
      recipient_user_id: p.homeownerId,
      dedupe_key: `cancellation_fee_charged:${p.appointmentId}:${p.paymentIntentId}`,
      payload: {
        ...ctx,
        audience: 'homeowner',
        amount_cents: p.amountCents,
        reason: p.noShow ? 'no_show' : 'cancellation',
      },
    });
  } catch (err) {
    console.error('notifyHomeownerCancellationFeeCharged failed (non-blocking):', err);
  }
}
