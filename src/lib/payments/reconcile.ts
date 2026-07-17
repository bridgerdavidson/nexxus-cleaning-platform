/**
 * Reconciliation sweep (Phase 4d) — the reliability backstop that makes DB correctness
 * independent of any single webhook delivery. Independent, batch-capped jobs:
 *
 *   1.  retryDeadLetterWebhooks      — re-dispatch webhook_events stuck in received/failed
 *   2.  reconcileStuckPayments       — replay the true Stripe PI status for pending/processing payments past SLA
 *   2a-pre. recoverStuckCharging     : release appointments orphaned in the 'charging' claim sentinel
 *   2a. chargeUncollectedCompletions — charge completed jobs whose completion charge never ran
 *   2b. settleUnsettledCaptures      — settle captured charges whose funds never moved (refunds
 *                                      cancelled-job completion charges instead of settling them)
 *   3.  retryFailedPayouts           — re-run cleaner settlement for payouts left 'failed' or 'pending' (held)
 *   3c. retryStrandedRefundUnwinds   — re-run the refund transfer unwind for appointments stranded
 *                                      by a failed reversal (transfer_reversal_failed /
 *                                      refund_clawback_failed / transfer_list_failed)
 *   4.  checkMoneyMathInvariants     — flag any paid cleaner payout that doesn't match the locked split
 *
 * Each job swallows per-item errors so one bad row never stalls the sweep. Everything routes
 * back through the existing idempotent handlers (dispatchStripeEvent, settleCleanerPayout) so
 * a replay is always safe.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import { dispatchStripeEvent } from './dispatchStripeEvent';
import { markWebhookProcessed, markWebhookFailed } from './webhookIdempotency';
import { settleCleanerPayout } from './settleCleanerPayout';
import { chargeCompletedAppointmentAuto } from './chargeCompletedAppointment';
import { refundCancelledInflightCharge } from './refundCancelledCharge';
import { clawbackCleanerPayout, reverseJobTransfersForRefund } from './clawback';
import { recordPaymentEvent } from './events';
import { checkSplitInvariant, type SplitInvariantResult } from './moneyMath';
import {
  retrieveStripeEvent,
  retrievePaymentIntent,
  retrieveCharge,
  listRefundsForPaymentIntent,
} from '@/lib/stripe/reconcile';
import { listTransfersByGroup, transferGroupFor } from '@/lib/stripe/transfers';
import { stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';

const DEFAULT_BATCH = 100;
const DEFAULT_STALE_MINUTES = 15;
// ACH debits legitimately sit 'processing' for several business days, so a 'processing' row is only
// "stuck" (a lost terminal webhook) well after settlement would have happened. ~6 days.
const DEFAULT_ACH_STALE_MINUTES = 6 * 24 * 60;

function staleCutoffIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// ── 1) Webhook dead-letter retry ────────────────────────────────────────────────
export interface DeadLetterResult {
  retried: number;
  recovered: number;
  stillFailed: number;
}

export async function retryDeadLetterWebhooks(
  supabase: SupabaseClient,
  opts: { batch?: number; staleMinutes?: number } = {},
): Promise<DeadLetterResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;
  const cutoff = staleCutoffIso(opts.staleMinutes ?? DEFAULT_STALE_MINUTES);

  // Anything not yet 'processed' and older than the stale window: either a 'failed' attempt or
  // a 'received' row whose live delivery never completed. The window gives the live webhook a
  // chance to finish first; by the time Stripe gives up retrying, rows are well past it.
  const { data: rows } = await supabase
    .from('webhook_events')
    .select('id')
    .neq('status', 'processed')
    .lte('received_at', cutoff)
    .order('received_at', { ascending: true })
    .limit(batch);

  const list = (rows ?? []) as Array<{ id: string }>;
  let recovered = 0;
  let stillFailed = 0;

  for (const row of list) {
    try {
      const event = await retrieveStripeEvent(row.id);
      await dispatchStripeEvent(supabase, event);
      await markWebhookProcessed(supabase, row.id);
      recovered++;
    } catch (err) {
      await markWebhookFailed(supabase, row.id, err instanceof Error ? err.message : String(err));
      stillFailed++;
    }
  }

  return { retried: list.length, recovered, stillFailed };
}

// ── 2) Stuck-payment reconcile ──────────────────────────────────────────────────
export interface StuckPaymentResult {
  checked: number;
  repaired: number;
}

export async function reconcileStuckPayments(
  supabase: SupabaseClient,
  opts: { batch?: number; staleMinutes?: number; processingStaleMinutes?: number } = {},
): Promise<StuckPaymentResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;
  const pendingCutoff = staleCutoffIso(opts.staleMinutes ?? DEFAULT_STALE_MINUTES);
  // ACH ('processing') gets a MUCH longer cutoff than card ('pending'): sweeping every in-flight
  // ACH at the 15-min window would burn the batch retrieving rows that can't be repaired yet
  // (pi.status still 'processing') and starve genuinely-terminal drift behind them.
  const achCutoff = staleCutoffIso(opts.processingStaleMinutes ?? DEFAULT_ACH_STALE_MINUTES);

  const cols =
    'id, appointment_id, organization_id, status, stripe_payment_intent_id, payment_intent_status';

  // 'pending' card/legacy rows past the short SLA are prime candidates for a webhook we never got.
  // With no upfront holds there is no 'requires_capture' in-flight state to exempt, so every stuck
  // pending row with a PaymentIntent is fair game for the reconcile retry.
  const { data: pendingRows } = await supabase
    .from('payments')
    .select(cols)
    .eq('status', 'pending')
    .not('stripe_payment_intent_id', 'is', null)
    .lte('created_at', pendingCutoff)
    .limit(batch);

  // 'processing' ACH rows only once they're well past settlement (a lost terminal webhook would
  // otherwise strand them forever — the cleaner never gets paid, the charge never confirms). Own
  // batch so a backlog of live ACH can never starve the pending sweep above.
  const { data: processingRows } = await supabase
    .from('payments')
    .select(cols)
    .eq('status', 'processing')
    .not('stripe_payment_intent_id', 'is', null)
    .lte('created_at', achCutoff)
    .limit(batch);

  const list = [...(pendingRows ?? []), ...(processingRows ?? [])] as Array<{
    id: string;
    appointment_id: string | null;
    organization_id: string | null;
    status: string;
    stripe_payment_intent_id: string;
    payment_intent_status: string | null;
  }>;
  let repaired = 0;

  for (const p of list) {
    let pi: Stripe.PaymentIntent;
    try {
      pi = await retrievePaymentIntent(p.stripe_payment_intent_id);
    } catch {
      continue; // PI unreadable/deleted — leave for manual review
    }

    // Only terminal Stripe states represent drift we can repair by replaying the matching
    // event through the idempotent dispatcher. Anything else is still legitimately in-flight.
    const replayType =
      pi.status === 'succeeded'
        ? 'payment_intent.succeeded'
        : pi.status === 'canceled'
          ? 'payment_intent.canceled'
          : pi.status === 'requires_payment_method' && pi.last_payment_error
            ? 'payment_intent.payment_failed'
            : null;
    if (!replayType) continue;

    await recordPaymentEvent(supabase, {
      paymentId: p.id,
      appointmentId: p.appointment_id,
      organizationId: p.organization_id,
      eventType: 'drift_repaired',
      prevStatus: p.status,
      newStatus: pi.status,
      actor: 'reconciler',
      payload: { payment_intent_id: pi.id, stripe_status: pi.status, source: 'reconcile-stuck-payment' },
    });

    const synthetic = {
      id: `reconcile_${pi.id}_${pi.status}`,
      object: 'event',
      type: replayType,
      data: { object: pi },
      account: null,
    } as unknown as Stripe.Event;
    await dispatchStripeEvent(supabase, synthetic);
    repaired++;
  }

  return { checked: list.length, repaired };
}

// ── 2a-pre) Stuck-'charging'-claim recovery ─────────────────────────────────────
export interface StuckChargingResult {
  checked: number;
  reset: number;
}

/**
 * Release appointments orphaned in the transient 'charging' claim sentinel. The charge claim in
 * chargeCompletedAppointmentAuto flips authorization_status to 'charging' and a `finally` releases it,
 * but a function timeout/kill between the claim and finishCharge leaves the row 'charging' FOREVER:
 * invisible to chargeUncollectedCompletions (it matches only NULL), to the setup_intent.succeeded
 * self-heal and operator triage (both key on failed/requires_action), and to a manual retry (the
 * claim WHERE never re-matches 'charging' → a permanent charge_in_progress 409).
 *
 * The claim UPDATE bumps updated_at and a real charge finishes in well under a minute, so a 'charging'
 * row whose updated_at is older than 10 minutes is definitively orphaned, never an in-flight charge.
 * Reset it to NULL so it re-enters the normal NULL recovery path (chargeUncollectedCompletions on a
 * later sweep; the reset itself bumps updated_at, so it waits out that job's own SLA first).
 *
 * Skips any row already settled / in flight (a paid or processing COMPLETION revenue row): the
 * processing branch of finishCharge writes the payment row but leaves authorization_status='charging'
 * until the caller's finally clears it, so a crash in that gap must NOT be re-armed. The per-row
 * UPDATE re-asserts `.eq('authorization_status','charging')` so a finishCharge that just wrote a
 * terminal status always wins the race.
 *
 * Residual (documented, not repaired here): the rare crash AFTER the Stripe charge SUCCEEDED but
 * BEFORE any DB write leaves a 'charging' row with NO payment row, so the settled-skip can't see it.
 * Resetting to NULL re-arms a charge; the idempotency key `charge-{id}-{attempt}` collapses the retry
 * onto the same PaymentIntent rather than double-charging, but full Stripe-side reconciliation
 * (matching an orphan PaymentIntent back to its appointment) is a pre-existing concern out of scope
 * here.
 */
export async function recoverStuckCharging(
  supabase: SupabaseClient,
  opts: { batch?: number; staleMinutes?: number } = {},
): Promise<StuckChargingResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;
  const cutoff = staleCutoffIso(opts.staleMinutes ?? 10);

  const { data: rows } = await supabase
    .from('appointments')
    .select('id')
    .eq('authorization_status', 'charging')
    .lte('updated_at', cutoff)
    .limit(batch);
  const candidates = ((rows ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (candidates.length === 0) return { checked: 0, reset: 0 };

  // Never re-arm a job whose completion money already moved / is in flight (a crash after the
  // processing/paid payment row was written but before 'charging' was cleared).
  const { data: payRows } = await supabase
    .from('payments')
    .select('appointment_id, status')
    .in('appointment_id', candidates)
    .eq('payment_type', 'revenue')
    .eq('charge_kind', 'completion')
    .in('status', ['paid', 'processing']);
  const settled = new Set(
    ((payRows ?? []) as Array<{ appointment_id: string }>).map((r) => r.appointment_id),
  );

  let reset = 0;
  for (const id of candidates) {
    if (settled.has(id)) continue;
    // Per-row isolation: a transient DB error on one row must not abort the sweep (matches the
    // sibling chargeUncollectedCompletions contract that each job swallows per-item errors).
    try {
      const { data: updated } = await supabase
        .from('appointments')
        .update({ authorization_status: null })
        .eq('id', id)
        .eq('authorization_status', 'charging')
        .select('id');
      if (updated && updated.length > 0) {
        reset++;
        await recordPaymentEvent(supabase, {
          appointmentId: id,
          organizationId: null,
          eventType: 'drift_repaired',
          actor: 'reconciler',
          payload: { source: 'recover-stuck-charging' },
        });
      }
    } catch (err) {
      console.error('recoverStuckCharging failed for', id, err);
    }
  }

  return { checked: candidates.length, reset };
}

// ── 2a) Completed-but-never-charged sweep ───────────────────────────────────────
export interface UncollectedCompletionResult {
  checked: number;
  charged: number;
}

/**
 * Charge completed appointments whose completion charge NEVER ran: the job finished while the
 * Stripe flags were off, the charge request 502'd before a payment row was written, or the
 * client that triggers the charge died. Under charge-at-completion nothing else would ever
 * collect this money.
 *
 * The loop-breaker is `authorization_status IS NULL`: a declined/3DS attempt stamps
 * 'failed'/'requires_action' (taking the row out of this sweep, so a dead card is never hammered
 * every cycle), and a new saved card clears it back to NULL (setup_intent.succeeded), which
 * re-arms exactly one fresh attempt. A crashed attempt left authorization_status NULL but its
 * idempotency key `charge-{id}-{attempt}` unspent-or-cached, so the retry collapses onto the
 * same PaymentIntent rather than double-charging.
 */
export async function chargeUncollectedCompletions(
  supabase: SupabaseClient,
  opts: { batch?: number; staleMinutes?: number; organizationId?: string } = {},
): Promise<UncollectedCompletionResult> {
  if (!stripeNewChargeFlowEnabled()) return { checked: 0, charged: 0 };

  const batch = opts.batch ?? DEFAULT_BATCH;
  // Give the normal completion-route charge a window before assuming it never ran.
  const cutoff = staleCutoffIso(opts.staleMinutes ?? 30);

  // Self-pay completions charge the ORG's saved company method (resolved live from the org's
  // self-pay Customer), not appointments.payment_method_id — so they pass without one.
  let query = supabase
    .from('appointments')
    .select('id')
    .eq('status', 'completed')
    .is('authorization_status', null)
    .or('payment_method_id.not.is.null,is_self_pay.eq.true')
    .lte('updated_at', cutoff)
    .limit(batch);
  if (opts.organizationId) query = query.eq('organization_id', opts.organizationId);
  const { data: apptRows } = await query;
  const candidates = ((apptRows ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (candidates.length === 0) return { checked: 0, charged: 0 };

  // Exclude anything already collected or in flight (paid / processing revenue row) — including
  // manual cash records, which legitimately mark a job as paid without a Stripe charge.
  const { data: payRows } = await supabase
    .from('payments')
    .select('appointment_id, status')
    .in('appointment_id', candidates)
    .eq('payment_type', 'revenue')
    .in('status', ['paid', 'processing']);
  const settled = new Set(
    ((payRows ?? []) as Array<{ appointment_id: string }>).map((r) => r.appointment_id),
  );

  let charged = 0;
  for (const id of candidates) {
    if (settled.has(id)) continue;
    try {
      const outcome = await chargeCompletedAppointmentAuto(supabase, id, 'reconciler');
      if (outcome.ok) {
        charged++;
        await recordPaymentEvent(supabase, {
          appointmentId: id,
          organizationId: null,
          eventType: 'drift_repaired',
          actor: 'reconciler',
          payload: { source: 'charge-uncollected-completion', outcome: outcome.code },
        });
      }
    } catch (err) {
      console.error('chargeUncollectedCompletions failed for', id, err);
    }
  }

  return { checked: candidates.length - settled.size, charged };
}

// ── 2b) Captured-but-unsettled self-heal ────────────────────────────────────────
export interface UnsettledCaptureResult {
  checked: number;
  settled: number;
}

/**
 * Re-run settlement for homeowner charges that were captured (payments.status='paid') but whose
 * funds were never moved off the platform balance — `transfer_amount` is still null past the SLA.
 * This covers two drifts the webhook can leave behind:
 *   - a lost `payment_intent.succeeded` (settlement never ran), and
 *   - a tenant-leg transfer that failed mid-settlement (settleCleanerPayout bailed before paying
 *     anyone, so the cleaner payout retry job alone can't recover it).
 * settleCleanerPayout is fully idempotent (idempotency keys on both transfers), so replaying is
 * always safe; a charge id isn't needed — it falls back to an available-balance transfer.
 *
 * EXCLUDES org self-pay rows: they settle via `settleSelfPay` (single platform→cleaner transfer,
 * no tenant remainder) and never set `transfer_amount`, so they would otherwise match this sweep
 * forever and be force-run through the wrong (tenant-split) path. Their backstop is the idempotent
 * settleSelfPay on payment_intent.succeeded.
 */
export async function settleUnsettledCaptures(
  supabase: SupabaseClient,
  opts: { batch?: number; staleMinutes?: number } = {},
): Promise<UnsettledCaptureResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;
  const cutoff = staleCutoffIso(opts.staleMinutes ?? DEFAULT_STALE_MINUTES);

  const { data: rows } = await supabase
    .from('payments')
    .select('id, appointment_id, organization_id, charge_kind, stripe_payment_intent_id')
    .eq('status', 'paid')
    .eq('payment_type', 'revenue')
    .is('transfer_amount', null)
    .not('appointment_id', 'is', null)
    .not('captured_at', 'is', null)
    .or('is_self_pay.is.null,is_self_pay.eq.false')
    .lte('captured_at', cutoff)
    .limit(batch);

  const list = (rows ?? []) as Array<{
    id: string;
    appointment_id: string;
    organization_id: string | null;
    charge_kind: string | null;
    stripe_payment_intent_id: string | null;
  }>;
  let settled = 0;

  for (const p of list) {
    // A COMPLETION charge on a since-cancelled appointment must be refunded, never settled (the
    // payer owes nothing for a cancelled job). This is the backstop for a lost
    // payment_intent.succeeded whose live delivery would have issued the refund. A cancellation
    // FEE row (charge_kind='cancellation_fee') legitimately settles to the tenant below, as do
    // legacy rows with no charge_kind (pre-088 behavior preserved).
    if (p.charge_kind === 'completion' && p.stripe_payment_intent_id) {
      const { data: apptRow } = await supabase
        .from('appointments')
        .select('status')
        .eq('id', p.appointment_id)
        .maybeSingle();
      if ((apptRow as { status: string } | null)?.status === 'cancelled') {
        await refundCancelledInflightCharge(supabase, {
          appointmentId: p.appointment_id,
          paymentIntentId: p.stripe_payment_intent_id,
          actor: 'reconciler',
        });
        continue;
      }
    }

    const result = await settleCleanerPayout(supabase, p.appointment_id, null);
    if (result.settled) {
      await recordPaymentEvent(supabase, {
        paymentId: p.id,
        appointmentId: p.appointment_id,
        organizationId: p.organization_id,
        eventType: 'drift_repaired',
        actor: 'reconciler',
        payload: { source: 'settle-unsettled-capture' },
      });
      settled++;
    }
  }

  return { checked: list.length, settled };
}

// ── 3) Failed-payout retry ──────────────────────────────────────────────────────
export interface FailedPayoutResult {
  retried: number;
  settled: number;
}

export async function retryFailedPayouts(
  supabase: SupabaseClient,
  opts: { batch?: number } = {},
): Promise<FailedPayoutResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;

  // 'failed' = a transfer that errored; 'pending' = a cleaner slice HELD because the cleaner wasn't
  // Connect-onboarded at settlement (settleCleanerPayout). Re-running settle is idempotent: it pays
  // the cleaner once they've onboarded, or re-holds otherwise. No other flow writes a 'pending' payout.
  // A retryable row that already carries a stripe_transfer_id (money moved, possibly under a legacy
  // `payout-{id}` idempotency key) is deliberately INCLUDED: settle's repair path marks it paid
  // without re-transferring (audit H4), so the sweep self-heals it. Rows with no
  // payout_percent_snapshot are excluded — re-settling those would recompute from the CURRENT
  // percent, which conservation forbids.
  const { data: rows } = await supabase
    .from('payouts')
    .select('id, appointment_id')
    .in('status', ['failed', 'pending'])
    .not('payout_percent_snapshot', 'is', null)
    .not('appointment_id', 'is', null)
    .limit(batch);

  const list = (rows ?? []) as Array<{ id: string; appointment_id: string }>;
  let settled = 0;

  for (const row of list) {
    // No platform charge id on retry — settle falls back to an available-balance transfer.
    const result = await settleCleanerPayout(supabase, row.appointment_id, null);
    if (result.settled) settled++;
  }

  return { retried: list.length, settled };
}

// ── 4) Money-math invariant check ─────────────────────────────────────────────────
export interface MoneyMathResult {
  checked: number;
  violations: number;
}

export async function checkMoneyMathInvariants(
  supabase: SupabaseClient,
  opts: { batch?: number } = {},
): Promise<MoneyMathResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;

  const { data: rows } = await supabase
    .from('payouts')
    .select('id, appointment_id, organization_id, amount, payout_percent_snapshot')
    .eq('status', 'paid')
    .not('payout_percent_snapshot', 'is', null)
    .limit(batch);

  const list = (rows ?? []) as Array<{
    id: string;
    appointment_id: string | null;
    organization_id: string | null;
    amount: number | string;
    payout_percent_snapshot: number | string;
  }>;
  let violations = 0;

  for (const row of list) {
    if (!row.appointment_id) continue;

    const { data: apptRow } = await supabase
      .from('appointments')
      .select('total_price')
      .eq('id', row.appointment_id)
      .maybeSingle();
    const totalPrice = (apptRow as { total_price: number | string } | null)?.total_price;
    if (totalPrice == null) continue;

    let bps = 0;
    if (row.organization_id) {
      const { data: orgRow } = await supabase
        .from('organizations')
        .select('platform_fee_bps')
        .eq('id', row.organization_id)
        .maybeSingle();
      bps = Number((orgRow as { platform_fee_bps: number } | null)?.platform_fee_bps ?? 0);
    }

    const grossCents = Math.round(Number(totalPrice) * 100);
    const recordedCleanerCents = Math.round(Number(row.amount) * 100);

    let result: SplitInvariantResult | null = null;
    try {
      result = checkSplitInvariant({
        grossCents,
        payoutPercent: Number(row.payout_percent_snapshot),
        platformFeeBps: bps,
        recordedCleanerCents,
      });
    } catch {
      result = null; // invalid recorded inputs are themselves a violation
    }

    if (!result || !result.ok) {
      violations++;
      await recordPaymentEvent(supabase, {
        appointmentId: row.appointment_id,
        organizationId: row.organization_id,
        eventType: 'money_math_violation',
        actor: 'reconciler',
        amount: recordedCleanerCents,
        payload: {
          payout_id: row.id,
          gross_cents: grossCents,
          recorded_cleaner_cents: recordedCleanerCents,
          expected_cleaner_cents: result?.expectedCleanerCents ?? null,
          drift_cents: result?.driftCents ?? null,
        },
      });
    }
  }

  return { checked: list.length, violations };
}

// ── 5) Stranded-clawback retry ──────────────────────────────────────────────────
export interface StrandedClawbackResult {
  checked: number;
  recovered: number;
}

/**
 * Retry clawbacks that failed — a `cleaner_clawback_failed` ledger event with no successful
 * reversal yet. A reversal can fail transiently (e.g. the cleaner's connected account was briefly
 * restricted); without a retry the platform stays out the clawed-back cut. Idempotent:
 * clawbackCleanerPayout skips a payout already 'reversed', so a recovered row is a cheap no-op on
 * the next sweep.
 */
export async function retryStrandedClawbacks(
  supabase: SupabaseClient,
  opts: { batch?: number; staleMinutes?: number } = {},
): Promise<StrandedClawbackResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;
  const cutoff = staleCutoffIso(opts.staleMinutes ?? DEFAULT_STALE_MINUTES);

  const { data: rows } = await supabase
    .from('payment_events')
    .select('appointment_id, organization_id, payment_id')
    .eq('event_type', 'cleaner_clawback_failed')
    .not('appointment_id', 'is', null)
    .lte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(batch);

  const list = (rows ?? []) as Array<{
    appointment_id: string;
    organization_id: string | null;
    payment_id: string | null;
  }>;

  // Dedup by appointment (multiple failed attempts may be logged for one job).
  const seen = new Set<string>();
  let checked = 0;
  let recovered = 0;
  for (const row of list) {
    if (seen.has(row.appointment_id)) continue;
    seen.add(row.appointment_id);
    checked++;
    const result = await clawbackCleanerPayout(supabase, {
      appointmentId: row.appointment_id,
      actor: 'reconciler',
      reason: 'reconcile_retry',
      paymentId: row.payment_id,
      organizationId: row.organization_id,
    });
    if (result.reversed) recovered++;
  }

  return { checked, recovered };
}

// ── 5b) Stranded refund-unwind retry ────────────────────────────────────────────
export interface StrandedUnwindResult {
  checked: number;
  recovered: number;
  stillFailed: number;
  /** Routed to a terminal manual-review marker + critical alert instead of auto-reversing. */
  manualReview: number;
  /** Skipped this round (retry backoff, or a refund landed too recently). Still a candidate. */
  deferred: number;
}

/**
 * Terminal markers for a stranded unwind. payment_events is append-only, so both are companion
 * events rather than row updates: an appointment leaves the sweep once its newest marker is newer
 * than its newest failure event (a later refund that fails again re-enters it naturally). The
 * candidate query itself lives in the `stranded_refund_unwind_candidates` RPC (migration 112),
 * which applies the marker exclusion and per-appointment dedup BEFORE the batch limit, oldest
 * first — a plain newest-first LIMIT over the append-only failure rows would let recovered or
 * permanently-failing appointments starve all older stranded ones out of retry forever.
 */
export const REFUND_UNWIND_RECOVERED_EVENT = 'refund_unwind_recovered';
export const REFUND_UNWIND_MANUAL_REVIEW_EVENT = 'refund_unwind_manual_review';

/**
 * Pure: minutes a stranded unwind must sit since its LAST failure before the sweep retries it,
 * doubling per prior reconciler attempt (15m, 30m, 1h, ... capped at 2^6 = ~16h with the default
 * base). Money is never abandoned — a permanently failing reversal keeps retrying at the capped
 * cadence with its critical alert open — but the ledger/alert churn of a hot loop is bounded.
 */
export function unwindRetryBackoffMinutes(attempts: number, baseMinutes: number): number {
  return baseMinutes * Math.pow(2, Math.min(Math.max(attempts, 0), 6));
}

interface StrandedUnwindCandidate {
  appointment_id: string;
  organization_id: string | null;
  payment_id: string | null;
  failed_at: string;
  reconciler_attempts: number;
}

/**
 * Retry refund unwinds that stranded — a homeowner was refunded from the platform balance but a
 * tenant/cleaner transfer reversal then threw, leaving the platform out the money (audit T1-1).
 * The live paths (refund route + charge.refunded webhook) are each single-shot: the webhook
 * handler never throws, so its webhook_events row is marked processed and the dead-letter retry
 * never replays it. This job is the durable retry.
 *
 * The failure events don't store the refund totals, and the local refunds ledger can miss
 * out-of-band Dashboard refunds, so the cumulative target is re-derived from the authoritative
 * Stripe charge (amount_refunded / amount) — the same inputs handleChargeRefunded uses. The
 * unwind itself is re-invoked wholesale: its read-then-delta math against live amount_reversed
 * makes a replay top-up-only (over-asking a reversal THROWS at Stripe, forever), and any future
 * policy guard added to it applies to retries automatically. A failed retry re-records the
 * failure event, which bumps the open critical platform alert (paymentEventAlerts).
 *
 * Proportional-to-gross reversal is only valid when every transfer in the group was split from
 * the FULL charge and belongs to THIS charge, so two guards route anything else to a terminal
 * `refund_unwind_manual_review` marker (critical alert, no money moved) instead of auto-reversing:
 *   - another Stripe-charged payment shares the appointment (e.g. a cancellation fee) — the
 *     transfer group mixes charges, and a group-wide reversal would claw back the fee the tenant
 *     is owed;
 *   - a transfer was created AFTER the earliest refund — settlement splits net of refunds
 *     (settleCleanerPayout), so that refund is already absorbed in the transfer sizes and
 *     reversing proportional-to-gross would double-deduct it from the tenant and cleaner.
 * And to keep the sweep from racing a live unwind to a DIFFERENT cumulative target (the
 * idempotency key only dedupes EQUAL targets), any appointment whose newest Stripe refund is
 * younger than the stale window is deferred to the next round.
 */
export async function retryStrandedRefundUnwinds(
  supabase: SupabaseClient,
  opts: { batch?: number; staleMinutes?: number } = {},
): Promise<StrandedUnwindResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;
  const staleMinutes = opts.staleMinutes ?? DEFAULT_STALE_MINUTES;
  const cutoff = staleCutoffIso(staleMinutes);

  const { data: rows, error: rpcError } = await supabase.rpc('stranded_refund_unwind_candidates', {
    p_cutoff: cutoff,
    p_batch: batch,
  });
  if (rpcError) {
    // Migration 112 not applied yet (or transient DB error): no-op this round rather than fall
    // back to a selection shape with the starvation bug.
    console.error('retryStrandedRefundUnwinds: candidate RPC failed:', rpcError.message);
    return { checked: 0, recovered: 0, stillFailed: 0, manualReview: 0, deferred: 0 };
  }
  const candidates = (rows ?? []) as StrandedUnwindCandidate[];

  let checked = 0;
  let recovered = 0;
  let stillFailed = 0;
  let manualReview = 0;
  let deferred = 0;
  for (const c of candidates) {
    checked++;
    try {
      // Exponential backoff since the last failure; a first retry passes immediately (the RPC
      // cutoff already guarantees the failure is at least staleMinutes old).
      const backoffMs = unwindRetryBackoffMinutes(c.reconciler_attempts, staleMinutes) * 60_000;
      if (Date.now() - Date.parse(c.failed_at) < backoffMs) {
        deferred++;
        continue;
      }

      type PaymentLookup = {
        id: string;
        organization_id: string | null;
        stripe_payment_intent_id: string | null;
      } | null;
      let payment: PaymentLookup = null;
      if (c.payment_id) {
        const { data } = await supabase
          .from('payments')
          .select('id, organization_id, stripe_payment_intent_id')
          .eq('id', c.payment_id)
          .maybeSingle();
        payment = data as PaymentLookup;
      }
      if (!payment?.stripe_payment_intent_id) {
        // The failure event should always carry payment_id (both unwind call sites pass it), but
        // fall back to the appointment's newest Stripe-charged revenue row so a null never
        // permanently strands the retry.
        const { data } = await supabase
          .from('payments')
          .select('id, organization_id, stripe_payment_intent_id')
          .eq('appointment_id', c.appointment_id)
          .eq('payment_type', 'revenue')
          .not('stripe_payment_intent_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1);
        payment = ((data ?? [])[0] ?? null) as PaymentLookup;
      }
      if (!payment?.stripe_payment_intent_id) continue; // nothing to re-derive from — manual review

      let charge: Stripe.Charge | null = null;
      try {
        const pi = await retrievePaymentIntent(payment.stripe_payment_intent_id);
        charge =
          typeof pi.latest_charge === 'object' && pi.latest_charge !== null
            ? (pi.latest_charge as Stripe.Charge)
            : typeof pi.latest_charge === 'string'
              ? await retrieveCharge(pi.latest_charge)
              : null;
      } catch {
        // Stripe unreadable — leave for the next sweep.
      }
      if (!charge) continue;

      const totalRefundedCents = charge.amount_refunded ?? 0;
      const grossCents = charge.amount;
      const orgId = payment.organization_id ?? c.organization_id;

      if (totalRefundedCents <= 0) {
        // No refund actually exists at Stripe (e.g. transfer_list_failed recorded before the
        // charge was ever refunded). There is nothing to unwind — terminalize so the sweep stops
        // re-checking it.
        await recordPaymentEvent(supabase, {
          paymentId: payment.id,
          appointmentId: c.appointment_id,
          organizationId: orgId,
          eventType: REFUND_UNWIND_RECOVERED_EVENT,
          actor: 'reconciler',
          amount: 0,
          payload: { source: 'retry-stranded-refund-unwinds', nothing_to_unwind: true },
        });
        recovered++;
        continue;
      }

      // Authoritative refund history (created times drive the guards below; the local refunds
      // ledger can miss out-of-band Dashboard refunds).
      let refunds: Stripe.Refund[];
      try {
        refunds = await listRefundsForPaymentIntent(payment.stripe_payment_intent_id);
      } catch {
        continue; // Stripe unreadable — leave for the next sweep.
      }
      if (refunds.length === 0) continue; // amount_refunded > 0 but no refunds listed — leave it.

      // A refund younger than the stale window means the live unwind (route or charge.refunded
      // webhook) may still be acting on a DIFFERENT cumulative target; two concurrent unwinds
      // with divergent targets both execute (the idempotency key encodes the target) and can
      // over-reverse. Defer until the live path has had the full window to finish.
      const newestRefundMs = Math.max(...refunds.map((r) => (r.created ?? 0) * 1000));
      if (newestRefundMs > Date.now() - staleMinutes * 60_000) {
        deferred++;
        continue;
      }

      let transfers: Awaited<ReturnType<typeof listTransfersByGroup>>;
      try {
        transfers = await listTransfersByGroup(transferGroupFor(c.appointment_id));
      } catch {
        continue; // Stripe unreadable — leave for the next sweep.
      }
      if (transfers.length === 0) {
        // Nothing was ever distributed (the strand predates settlement). Settlement reads the
        // live refunded amount and splits net of it, so there is nothing to unwind here.
        await recordPaymentEvent(supabase, {
          paymentId: payment.id,
          appointmentId: c.appointment_id,
          organizationId: orgId,
          eventType: REFUND_UNWIND_RECOVERED_EVENT,
          actor: 'reconciler',
          amount: 0,
          payload: { source: 'retry-stranded-refund-unwinds', nothing_to_unwind: true, no_transfers: true },
        });
        recovered++;
        continue;
      }

      // Guard 1: another charge on this appointment (e.g. a cancellation fee) shares the
      // transfer group — a group-wide proportional reversal would claw back money belonging to
      // the OTHER, un-refunded charge. Detect it both DB-side (any other paid/processing
      // Stripe-charged or cancellation-fee payment row) and Stripe-side (a group transfer
      // sourced from a different charge).
      const { data: otherCharged } = await supabase
        .from('payments')
        .select('id')
        .eq('appointment_id', c.appointment_id)
        .neq('id', payment.id)
        .or('charge_kind.eq.cancellation_fee,stripe_payment_intent_id.not.is.null')
        .in('status', ['paid', 'processing'])
        .limit(1);
      const mixedCharges =
        ((otherCharged ?? []) as Array<{ id: string }>).length > 0 ||
        transfers.some(
          (t) => typeof t.source_transaction === 'string' && t.source_transaction !== charge.id,
        );

      // Guard 2: a transfer created after the earliest refund was split NET of that refund
      // (settleCleanerPayout subtracts already-refunded cents), so proportional-to-gross would
      // deduct it a second time.
      const earliestRefundSec = Math.min(...refunds.map((r) => r.created ?? 0));
      const refundAbsorbedAtSettlement = transfers.some((t) => (t.created ?? 0) > earliestRefundSec);

      if (mixedCharges || refundAbsorbedAtSettlement) {
        await recordPaymentEvent(supabase, {
          paymentId: payment.id,
          appointmentId: c.appointment_id,
          organizationId: orgId,
          eventType: REFUND_UNWIND_MANUAL_REVIEW_EVENT,
          actor: 'reconciler',
          amount: totalRefundedCents,
          payload: {
            source: 'retry-stranded-refund-unwinds',
            mixed_charges: mixedCharges,
            refund_absorbed_at_settlement: refundAbsorbedAtSettlement,
            gross_cents: grossCents,
          },
        });
        manualReview++;
        continue;
      }

      const result = await reverseJobTransfersForRefund(supabase, {
        appointmentId: c.appointment_id,
        totalRefundedCents,
        grossCents,
        actor: 'reconciler',
        paymentId: payment.id,
        organizationId: orgId,
      });

      if (result.failures > 0) {
        // The unwind already re-recorded the failure event(s), bumping the platform alert.
        stillFailed++;
      } else {
        await recordPaymentEvent(supabase, {
          paymentId: payment.id,
          appointmentId: c.appointment_id,
          organizationId: orgId,
          eventType: REFUND_UNWIND_RECOVERED_EVENT,
          actor: 'reconciler',
          amount: result.reversedCents,
          payload: {
            source: 'retry-stranded-refund-unwinds',
            total_refunded_cents: totalRefundedCents,
            gross_cents: grossCents,
          },
        });
        recovered++;
      }
    } catch (err) {
      console.error('retryStrandedRefundUnwinds failed for', c.appointment_id, err);
      stillFailed++;
    }
  }

  return { checked, recovered, stillFailed, manualReview, deferred };
}
