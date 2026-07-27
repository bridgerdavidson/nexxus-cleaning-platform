import type { SupabaseClient } from '@supabase/supabase-js';
import { isAutoApproved } from './threshold';
import { nextStatus, PayRequestTransitionError, type PayRequestAction } from './transitions';
import { recordPaymentEvent } from '@/lib/payments/events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';
import { settleCleanerPayout } from '@/lib/payments/settleCleanerPayout';
import { chargeCompletedAppointmentAuto } from '@/lib/payments/chargeCompletedAppointment';

/**
 * Shared engine for the pay-request thread routes (spec §5/§8).
 *
 * Race-safety: every transition is a compare-and-swap UPDATE guarded on the
 * expected current status; a concurrent action loses with 0 rows and surfaces
 * as `stale_state` (routes answer 409 so the client refreshes).
 *
 * Idempotency: re-running a terminal action (org_approve / cleaner_accept) on
 * an already-approved thread short-circuits to success without touching the
 * row, so a double-tap or a retried request can never double-approve, and the
 * settlement trigger behind it is itself idempotent
 * (cleaner-payout-<appointmentId> transfer keys).
 *
 * Amount sources: org_approve approves the latest CLEANER offer;
 * cleaner_accept accepts the latest ORG offer. Approvals and org counters are
 * hard-capped at the job-price snapshot (org-facing constraint only); cleaner
 * counters are uncapped and simply escalate, so no response ever leaks the
 * hidden price to the cleaner.
 */

interface PayRequestRow {
  id: string;
  organization_id: string;
  appointment_id: string;
  cleaner_id: string;
  status: 'pending_org' | 'pending_cleaner' | 'approved';
  job_price_cents_snapshot: number;
  approved_amount_cents: number | null;
}

interface OfferRow {
  id: string;
  actor: 'cleaner' | 'org';
  amount_cents: number;
  created_at: string;
}

export interface LoadedPayRequest {
  pr: PayRequestRow;
  offers: OfferRow[];
  latestCleanerOffer: OfferRow | null;
  latestOrgOffer: OfferRow | null;
}

export async function loadPayRequest(
  supabase: SupabaseClient,
  payRequestId: string,
): Promise<LoadedPayRequest | null> {
  const { data: pr } = await supabase
    .from('pay_requests')
    .select('id, organization_id, appointment_id, cleaner_id, status, job_price_cents_snapshot, approved_amount_cents')
    .eq('id', payRequestId)
    .maybeSingle();
  if (!pr) return null;

  const { data: offers } = await supabase
    .from('pay_request_offers')
    .select('id, actor, amount_cents, created_at')
    .eq('pay_request_id', payRequestId)
    .order('created_at', { ascending: true });

  const list = (offers ?? []) as OfferRow[];
  const latestCleanerOffer = [...list].reverse().find((o) => o.actor === 'cleaner') ?? null;
  const latestOrgOffer = [...list].reverse().find((o) => o.actor === 'org') ?? null;
  return { pr: pr as PayRequestRow, offers: list, latestCleanerOffer, latestOrgOffer };
}

export interface ActArgs {
  payRequestId: string;
  action: PayRequestAction;
  actorUserId: string;
  /** Required for org_counter / cleaner_counter. */
  amountCents?: number;
  note?: string | null;
}

export type ActResult =
  | {
      ok: true;
      status: 'pending_org' | 'pending_cleaner' | 'approved';
      approvedAmountCents: number | null;
      alreadyApproved: boolean;
      autoApproved: boolean;
    }
  | { ok: false; code: 'not_found' | 'stale_state' | 'no_offer' | 'over_price' | 'invalid_amount' };

export async function actOnPayRequest(supabase: SupabaseClient, args: ActArgs): Promise<ActResult> {
  const loaded = await loadPayRequest(supabase, args.payRequestId);
  if (!loaded) return { ok: false, code: 'not_found' };
  const { pr, offers, latestCleanerOffer, latestOrgOffer } = loaded;

  // Idempotency short-circuit: a repeated terminal action on an approved
  // thread is success, not a conflict.
  if (pr.status === 'approved' && (args.action === 'org_approve' || args.action === 'cleaner_accept')) {
    return {
      ok: true,
      status: 'approved',
      approvedAmountCents: pr.approved_amount_cents,
      alreadyApproved: true,
      autoApproved: false,
    };
  }

  const isCounter = args.action === 'org_counter' || args.action === 'cleaner_counter';
  if (isCounter) {
    if (!Number.isInteger(args.amountCents) || (args.amountCents as number) < 0) {
      return { ok: false, code: 'invalid_amount' };
    }
    // Org amounts can never exceed the job price (spec §5 over-price rule);
    // cleaner counters are uncapped and escalate instead.
    if (args.action === 'org_counter' && (args.amountCents as number) > pr.job_price_cents_snapshot) {
      return { ok: false, code: 'over_price' };
    }
  }

  // Resolve threshold for cleaner counters against the CURRENT org setting
  // (each offer is judged at its own moment; snapshot recorded on the row).
  let minMarginBps: number | null = null;
  let autoApproved = false;
  if (args.action === 'cleaner_counter') {
    const { data: org } = await supabase
      .from('organizations')
      .select('min_margin_bps')
      .eq('id', pr.organization_id)
      .single();
    minMarginBps = (org as { min_margin_bps?: number } | null)?.min_margin_bps ?? 2000;
    autoApproved = isAutoApproved(args.amountCents as number, pr.job_price_cents_snapshot, minMarginBps);
  }

  let newStatus: 'pending_org' | 'pending_cleaner' | 'approved';
  try {
    newStatus = nextStatus(pr.status, args.action, { autoApproved });
  } catch (err) {
    if (err instanceof PayRequestTransitionError) return { ok: false, code: 'stale_state' };
    throw err;
  }

  // The amount that becomes final if this action lands in `approved`.
  let approvedAmountCents: number | null = null;
  let approvedVia: 'auto' | 'org' | 'cleaner_accept' | null = null;
  if (newStatus === 'approved') {
    if (args.action === 'org_approve') {
      if (!latestCleanerOffer) return { ok: false, code: 'no_offer' };
      if (latestCleanerOffer.amount_cents > pr.job_price_cents_snapshot) {
        // An over-price ask cannot be approved as-is; the org must counter.
        return { ok: false, code: 'over_price' };
      }
      approvedAmountCents = latestCleanerOffer.amount_cents;
      approvedVia = 'org';
    } else if (args.action === 'cleaner_accept') {
      if (!latestOrgOffer) return { ok: false, code: 'no_offer' };
      approvedAmountCents = latestOrgOffer.amount_cents;
      approvedVia = 'cleaner_accept';
    } else {
      // cleaner_counter that cleared the threshold.
      approvedAmountCents = args.amountCents as number;
      approvedVia = 'auto';
    }
  }

  // Compare-and-swap on the expected current status.
  const { data: updated } = await supabase
    .from('pay_requests')
    .update({
      status: newStatus,
      ...(newStatus === 'approved'
        ? {
            approved_amount_cents: approvedAmountCents,
            approved_via: approvedVia,
            approved_by: approvedVia === 'auto' ? null : args.actorUserId,
            approved_at: new Date().toISOString(),
          }
        : {}),
    })
    .eq('id', pr.id)
    .eq('status', pr.status)
    .select('id')
    .maybeSingle();
  if (!updated) return { ok: false, code: 'stale_state' };

  if (isCounter) {
    await supabase.from('pay_request_offers').insert({
      pay_request_id: pr.id,
      actor: args.action === 'org_counter' ? 'org' : 'cleaner',
      actor_user_id: args.actorUserId,
      amount_cents: args.amountCents as number,
      note: args.note ?? null,
      min_margin_bps_snapshot: args.action === 'cleaner_counter' ? minMarginBps : null,
      auto_approved: autoApproved,
    });
  }

  // Forensics + notifications (best-effort; recordNotificationEvent swallows).
  const paymentEventType =
    args.action === 'org_approve' ? 'pay_request_approved'
    : args.action === 'org_counter' ? 'pay_request_countered'
    : args.action === 'cleaner_accept' ? 'pay_request_accepted'
    : autoApproved ? 'pay_request_auto_approved'
    : 'pay_request_escalated';
  await recordPaymentEvent(supabase, {
    appointmentId: pr.appointment_id,
    organizationId: pr.organization_id,
    eventType: paymentEventType,
    actor: `user:${args.actorUserId}`,
    amount: approvedAmountCents ?? args.amountCents ?? null,
    payload: {
      pay_request_id: pr.id,
      action: args.action,
      new_status: newStatus,
      ...(minMarginBps != null ? { min_margin_bps: minMarginBps } : {}),
    },
  });

  const ctx = await loadNotificationContext(supabase, {
    appointmentId: pr.appointment_id,
    cleanerId: pr.cleaner_id,
  });
  const offerCount = offers.length;
  if (args.action === 'org_approve') {
    await recordNotificationEvent(supabase, {
      event_type: 'pay_request_approved',
      appointment_id: pr.appointment_id,
      organization_id: pr.organization_id,
      recipient_user_id: pr.cleaner_id,
      dedupe_key: `pay_request_approved:${pr.id}`,
      payload: { ...ctx, amount_cents: approvedAmountCents },
    });
  } else if (args.action === 'org_counter') {
    await recordNotificationEvent(supabase, {
      event_type: 'pay_request_countered',
      appointment_id: pr.appointment_id,
      organization_id: pr.organization_id,
      recipient_user_id: pr.cleaner_id,
      dedupe_key: `pay_request_countered:${pr.id}:${offerCount}`,
      payload: { ...ctx, amount_cents: args.amountCents },
    });
  } else if (args.action === 'cleaner_accept' || (args.action === 'cleaner_counter' && autoApproved)) {
    await recordNotificationEvent(supabase, {
      event_type: 'pay_request_accepted',
      appointment_id: pr.appointment_id,
      organization_id: pr.organization_id,
      dedupe_key: `pay_request_accepted:${pr.id}:${offerCount}`,
      exclude_user_ids: [args.actorUserId],
      payload: { ...ctx, amount_cents: approvedAmountCents, auto_approved: autoApproved },
    });
  } else {
    // cleaner_counter that escalated back to the org.
    await recordNotificationEvent(supabase, {
      event_type: 'pay_request_escalated',
      appointment_id: pr.appointment_id,
      organization_id: pr.organization_id,
      dedupe_key: `pay_request_escalated:${pr.id}:${offerCount}`,
      exclude_user_ids: [args.actorUserId],
      payload: { ...ctx, amount_cents: args.amountCents },
    });
  }

  return {
    ok: true,
    status: newStatus,
    approvedAmountCents,
    alreadyApproved: false,
    autoApproved,
  };
}

/**
 * Kick settlement after a thread lands in `approved`. Homeowner-paid jobs:
 * the completion charge already ran (or will), so this is the same idempotent
 * settleCleanerPayout the sweep and retry route use. Self-pay jobs: the CHARGE
 * itself was waiting on the approval (chargeSelfPayNow bails
 * pay_request_pending until now). Every failure mode defers to the reconcile
 * sweep - this trigger is an accelerator, never the only path.
 */
export async function triggerPayRequestSettlement(
  supabase: SupabaseClient,
  appointmentId: string,
  actor: string,
): Promise<'settled' | 'deferred'> {
  try {
    const { data: appt } = await supabase
      .from('appointments')
      .select('id, is_self_pay')
      .eq('id', appointmentId)
      .maybeSingle();
    if (!appt) return 'deferred';
    if ((appt as { is_self_pay: boolean }).is_self_pay) {
      const outcome = await chargeCompletedAppointmentAuto(supabase, appointmentId, actor);
      return outcome.ok ? 'settled' : 'deferred';
    }
    const result = await settleCleanerPayout(supabase, appointmentId, null);
    return result.settled ? 'settled' : 'deferred';
  } catch (err) {
    console.error('triggerPayRequestSettlement failed (sweep will retry):', err);
    return 'deferred';
  }
}
