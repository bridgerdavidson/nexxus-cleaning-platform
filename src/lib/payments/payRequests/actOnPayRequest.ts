import type { SupabaseClient } from '@supabase/supabase-js';
import { isAutoApproved } from './threshold';
import { nextStatus, PayRequestTransitionError, type PayRequestAction } from './transitions';
import { paymentManagerRecipients } from './notifyRecipients';
import { recordPaymentEvent } from '@/lib/payments/events';
import { recordNotificationEvent } from '@/lib/notifications/recordEvent';
import { loadNotificationContext } from '@/lib/notifications/context';
import { settleCleanerPayout } from '@/lib/payments/settleCleanerPayout';
import { chargeCompletedAppointmentAuto } from '@/lib/payments/chargeCompletedAppointment';

/**
 * Shared engine for the pay-request thread routes (spec §5/§8).
 *
 * Amount-safety (PR2 review findings 1/7): the LIVE offer amount rides the
 * pay_requests row itself (current_offer_cents, migration 119), so every
 * transition is ONE atomic UPDATE of {status, current_offer_cents}, and the
 * terminal actions approve exactly `current_offer_cents` as read in the same
 * load the CAS guards. The CAS matches BOTH the expected status AND the loaded
 * updated_at (auto-touched by trigger on every transition), which kills the
 * ABA interleaving where a counter round-trips the status back to its old
 * value between an actor's load and their write. pay_request_offers is pure
 * append-only history; its insert order no longer affects correctness.
 *
 * Status implies whose offer is live: pending_org = the cleaner's ask,
 * pending_cleaner = the org's counter.
 *
 * Idempotency: re-running a terminal action (org_approve / cleaner_accept) on
 * an already-approved thread short-circuits to success without touching the
 * row; the settlement trigger behind it is itself idempotent
 * (cleaner-payout-<appointmentId> transfer keys).
 *
 * Price rules: org amounts (counter, and org_approve of an ask) are hard-capped
 * at the job-price snapshot; cleaner counters are uncapped and escalate, so no
 * cleaner-facing response ever leaks the hidden price.
 */

interface PayRequestRow {
  id: string;
  organization_id: string;
  appointment_id: string;
  cleaner_id: string;
  status: 'pending_org' | 'pending_cleaner' | 'approved';
  job_price_cents_snapshot: number;
  approved_amount_cents: number | null;
  current_offer_cents: number | null;
  updated_at: string;
}

export interface LoadedPayRequest {
  pr: PayRequestRow;
  offerCount: number;
}

export async function loadPayRequest(
  supabase: SupabaseClient,
  payRequestId: string,
): Promise<LoadedPayRequest | null> {
  const { data: pr } = await supabase
    .from('pay_requests')
    .select(
      'id, organization_id, appointment_id, cleaner_id, status, job_price_cents_snapshot, approved_amount_cents, current_offer_cents, updated_at',
    )
    .eq('id', payRequestId)
    .maybeSingle();
  if (!pr) return null;

  const { count } = await supabase
    .from('pay_request_offers')
    .select('id', { count: 'exact', head: true })
    .eq('pay_request_id', payRequestId);

  return { pr: pr as PayRequestRow, offerCount: count ?? 0 };
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
  const { pr, offerCount } = loaded;

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

  // The amount that becomes final if this action lands in `approved`. Terminal
  // actions bind to the row's LIVE offer (current_offer_cents) - the exact
  // value the CAS below guards - never to a separately-loaded offer list.
  let approvedAmountCents: number | null = null;
  let approvedVia: 'auto' | 'org' | 'cleaner_accept' | null = null;
  if (newStatus === 'approved') {
    if (args.action === 'org_approve') {
      if (pr.current_offer_cents == null) return { ok: false, code: 'no_offer' };
      if (pr.current_offer_cents > pr.job_price_cents_snapshot) {
        // An over-price ask cannot be approved as-is; the org must counter.
        return { ok: false, code: 'over_price' };
      }
      approvedAmountCents = pr.current_offer_cents;
      approvedVia = 'org';
    } else if (args.action === 'cleaner_accept') {
      if (pr.current_offer_cents == null) return { ok: false, code: 'no_offer' };
      approvedAmountCents = pr.current_offer_cents;
      approvedVia = 'cleaner_accept';
    } else {
      // cleaner_counter that cleared the threshold.
      approvedAmountCents = args.amountCents as number;
      approvedVia = 'auto';
    }
  }

  // Compare-and-swap on BOTH the expected status and the loaded updated_at
  // (the 117 trigger touches updated_at on every UPDATE, so any concurrent
  // transition - including an ABA status round-trip - makes this match 0 rows).
  const { data: updated } = await supabase
    .from('pay_requests')
    .update({
      status: newStatus,
      ...(isCounter ? { current_offer_cents: args.amountCents as number } : {}),
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
    .eq('updated_at', pr.updated_at)
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
    await notifyOrgApprovers(supabase, {
      eventType: 'pay_request_accepted',
      pr,
      actorUserId: args.actorUserId,
      dedupeKey: `pay_request_accepted:${pr.id}:${offerCount}`,
      payload: { ...ctx, amount_cents: approvedAmountCents, auto_approved: autoApproved },
    });
  } else {
    // cleaner_counter that escalated back to the org.
    await notifyOrgApprovers(supabase, {
      eventType: 'pay_request_escalated',
      pr,
      actorUserId: args.actorUserId,
      dedupeKey: `pay_request_escalated:${pr.id}:${offerCount}`,
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
 * Escalations/acceptances go to everyone who can act on them: org owners and
 * admins (recordNotificationEvent's default fan-out) plus managers holding
 * can_manage_payments (review finding 8 - they are first-class approvers via
 * requireOrgPaymentsAuth, so they must get the signal).
 */
async function notifyOrgApprovers(
  supabase: SupabaseClient,
  args: {
    eventType: 'pay_request_escalated' | 'pay_request_accepted';
    pr: Pick<PayRequestRow, 'appointment_id' | 'organization_id'>;
    actorUserId: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await recordNotificationEvent(supabase, {
    event_type: args.eventType,
    appointment_id: args.pr.appointment_id,
    organization_id: args.pr.organization_id,
    dedupe_key: args.dedupeKey,
    exclude_user_ids: [args.actorUserId],
    payload: args.payload,
  });
  const managers = await paymentManagerRecipients(supabase, args.pr.organization_id);
  for (const managerId of managers) {
    if (managerId === args.actorUserId) continue;
    await recordNotificationEvent(supabase, {
      event_type: args.eventType,
      appointment_id: args.pr.appointment_id,
      organization_id: args.pr.organization_id,
      recipient_user_id: managerId,
      dedupe_key: args.dedupeKey,
      payload: args.payload,
    });
  }
}

/**
 * Kick settlement after a thread lands in `approved`.
 *
 * Homeowner-paid jobs: ONLY when a captured revenue row exists (status='paid'
 * with captured_at set - the same filter settleUnsettledCaptures uses). The
 * PR2 review's critical finding: without this gate, approving a thread whose
 * completion charge DECLINED (payments row status='failed', a normal recovery
 * state) would settle real transfers out of the pooled platform balance for a
 * job on which nothing was collected. When no captured row exists yet, the
 * money path is: charge recovers/completes -> payment_intent.succeeded settles
 * (the thread is approved by then) -> reconcile sweep as backstop.
 *
 * Self-pay jobs: the CHARGE itself was waiting on the approval
 * (pay_request_pending precondition), so this triggers the charge orchestrator,
 * which owns its own preconditions and claim serialization.
 *
 * Every failure mode defers - this trigger is an accelerator, never the only
 * path.
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
    const { data: captured } = await supabase
      .from('payments')
      .select('id')
      .eq('appointment_id', appointmentId)
      .eq('payment_type', 'revenue')
      .eq('status', 'paid')
      .not('captured_at', 'is', null)
      .limit(1);
    if (!captured || captured.length === 0) return 'deferred';
    const result = await settleCleanerPayout(supabase, appointmentId, null);
    return result.settled ? 'settled' : 'deferred';
  } catch (err) {
    console.error('triggerPayRequestSettlement failed (sweep will retry):', err);
    return 'deferred';
  }
}
