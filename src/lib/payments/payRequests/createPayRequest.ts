import type { SupabaseClient } from '@supabase/supabase-js';
import { isAutoApproved } from './threshold';
import { initialStatus } from './transitions';
import { paymentManagerRecipients } from './notifyRecipients';
import { recordPaymentEvent } from '@/lib/payments/events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';

/**
 * Creates the pay-request thread for an appointment (spec §5,
 * docs/superpowers/specs/2026-07-26-cleaner-request-pay-model-design.md).
 *
 * Cleaner-authored: evaluated against the org's min_margin_bps at THIS moment
 * (snapshot recorded on the offer row) - auto-approves or parks at pending_org.
 * Org-authored (operator completing on the cleaner's behalf): always parks at
 * pending_cleaner; consent symmetry means the cleaner must accept it.
 *
 * Settlement is NOT triggered here. Auto-approved threads settle through the
 * normal completion-charge webhook; escalated threads settle when the thread
 * approves (approve/respond routes + reconcile sweep backstop).
 *
 * Service-role only (pay_requests has no client INSERT policy). The unique
 * constraint on appointment_id makes concurrent double-submits lose with
 * 23505 -> 'duplicate'.
 */

export interface CreatePayRequestArgs {
  appointmentId: string;
  actorUserId: string;
  actorKind: 'cleaner' | 'org';
  amountCents: number;
  note?: string | null;
}

export type CreatePayRequestResult =
  | { ok: true; payRequestId: string; status: string; autoApproved: boolean }
  | {
      ok: false;
      code: 'not_found' | 'wrong_mode' | 'duplicate' | 'invalid_amount' | 'cancelled' | 'over_price';
      message: string;
    };

export async function createPayRequest(
  supabase: SupabaseClient,
  args: CreatePayRequestArgs,
): Promise<CreatePayRequestResult> {
  if (!Number.isInteger(args.amountCents) || args.amountCents < 0) {
    return { ok: false, code: 'invalid_amount', message: 'Enter a whole amount of 0 or more.' };
  }

  const { data: appt } = await supabase
    .from('appointments')
    .select('id, organization_id, cleaner_id, total_price, status')
    .eq('id', args.appointmentId)
    .maybeSingle();
  const a = appt as {
    id: string;
    organization_id: string;
    cleaner_id: string | null;
    total_price: number | string;
    status: string;
  } | null;
  if (!a?.cleaner_id) return { ok: false, code: 'not_found', message: 'Appointment not found.' };
  if (a.status === 'cancelled') {
    return { ok: false, code: 'cancelled', message: 'This job was cancelled.' };
  }

  const { data: cleaner } = await supabase
    .from('cleaner_profiles')
    .select('payout_model')
    .eq('id', a.cleaner_id)
    .maybeSingle();
  if ((cleaner as { payout_model?: string } | null)?.payout_model !== 'request') {
    return { ok: false, code: 'wrong_mode', message: 'Pay requests are not enabled for this cleaner.' };
  }

  const { data: org } = await supabase
    .from('organizations')
    .select('min_margin_bps')
    .eq('id', a.organization_id)
    .single();
  const minMarginBps = (org as { min_margin_bps?: number } | null)?.min_margin_bps ?? 2000;
  const priceCents = Math.round(Number(a.total_price) * 100);

  // Org-authored amounts obey the same job-price cap as counters and approvals
  // (review finding 6: without this, an operator-entered amount above the price
  // could be cleaner-accepted into an over-price approval). Cleaner asks stay
  // uncapped and escalate - a cap error would leak the hidden price.
  if (args.actorKind === 'org' && args.amountCents > priceCents) {
    return { ok: false, code: 'over_price', message: 'Amount cannot exceed the job price.' };
  }

  const auto = args.actorKind === 'cleaner' && isAutoApproved(args.amountCents, priceCents, minMarginBps);
  const status = initialStatus(args.actorKind, auto);

  const { data: pr, error: insertErr } = await supabase
    .from('pay_requests')
    .insert({
      organization_id: a.organization_id,
      appointment_id: a.id,
      cleaner_id: a.cleaner_id,
      status,
      job_price_cents_snapshot: priceCents,
      current_offer_cents: args.amountCents,
      ...(auto
        ? {
            approved_amount_cents: args.amountCents,
            approved_via: 'auto',
            approved_at: new Date().toISOString(),
          }
        : {}),
    })
    .select('id')
    .single();
  if (insertErr || !pr) {
    if (insertErr?.code === '23505') {
      return { ok: false, code: 'duplicate', message: 'A pay request already exists for this job.' };
    }
    throw new Error(`createPayRequest insert failed: ${insertErr?.message ?? 'unknown'}`);
  }
  const payRequestId = (pr as { id: string }).id;

  await supabase.from('pay_request_offers').insert({
    pay_request_id: payRequestId,
    actor: args.actorKind,
    actor_user_id: args.actorUserId,
    amount_cents: args.amountCents,
    note: args.note ?? null,
    min_margin_bps_snapshot: args.actorKind === 'cleaner' ? minMarginBps : null,
    auto_approved: auto,
  });

  await recordPaymentEvent(supabase, {
    appointmentId: a.id,
    organizationId: a.organization_id,
    eventType: 'pay_request_submitted',
    actor: `user:${args.actorUserId}`,
    amount: args.amountCents,
    payload: { actor_kind: args.actorKind, auto_approved: auto, status, min_margin_bps: minMarginBps },
  });

  if (auto) {
    await recordPaymentEvent(supabase, {
      appointmentId: a.id,
      organizationId: a.organization_id,
      eventType: 'pay_request_auto_approved',
      actor: 'system',
      amount: args.amountCents,
      payload: { min_margin_bps: minMarginBps },
    });
  } else if (status === 'pending_org') {
    await recordPaymentEvent(supabase, {
      appointmentId: a.id,
      organizationId: a.organization_id,
      eventType: 'pay_request_escalated',
      actor: 'system',
      amount: args.amountCents,
      payload: { min_margin_bps: minMarginBps },
    });
    const ctx = await loadNotificationContext(supabase, { appointmentId: a.id, cleanerId: a.cleaner_id });
    const payload = { ...ctx, amount_cents: args.amountCents };
    await recordNotificationEvent(supabase, {
      event_type: 'pay_request_escalated',
      appointment_id: a.id,
      organization_id: a.organization_id,
      dedupe_key: `pay_request_escalated:${payRequestId}`,
      exclude_user_ids: [args.actorUserId],
      payload,
    });
    // Payment managers are first-class approvers; the default fan-out only
    // reaches owners/admins (review finding 8).
    for (const managerId of await paymentManagerRecipients(supabase, a.organization_id)) {
      if (managerId === args.actorUserId) continue;
      await recordNotificationEvent(supabase, {
        event_type: 'pay_request_escalated',
        appointment_id: a.id,
        organization_id: a.organization_id,
        recipient_user_id: managerId,
        dedupe_key: `pay_request_escalated:${payRequestId}`,
        payload,
      });
    }
  } else {
    // Org-authored offer awaiting the cleaner's accept.
    const ctx = await loadNotificationContext(supabase, { appointmentId: a.id, cleanerId: a.cleaner_id });
    await recordNotificationEvent(supabase, {
      event_type: 'pay_request_countered',
      appointment_id: a.id,
      organization_id: a.organization_id,
      recipient_user_id: a.cleaner_id,
      dedupe_key: `pay_request_countered:${payRequestId}:0`,
      payload: { ...ctx, amount_cents: args.amountCents },
    });
  }

  return { ok: true, payRequestId, status, autoApproved: auto };
}
