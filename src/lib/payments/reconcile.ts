/**
 * Reconciliation sweep (Phase 4d) — the reliability backstop that makes DB correctness
 * independent of any single webhook delivery. Independent, batch-capped jobs:
 *
 *   1.  retryDeadLetterWebhooks      — re-dispatch webhook_events stuck in received/failed
 *   2.  reconcileStuckPayments       — replay the true Stripe PI status for pending/processing payments past SLA
 *   2a. chargeUncollectedCompletions — charge completed jobs whose completion charge never ran
 *   2b. settleUnsettledCaptures      — settle captured charges whose funds never moved (refunds
 *                                      cancelled-job completion charges instead of settling them)
 *   3.  retryFailedPayouts           — re-run cleaner settlement for payouts left 'failed' or 'pending' (held)
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
import { clawbackCleanerPayout } from './clawback';
import { recordPaymentEvent } from './events';
import { checkSplitInvariant, type SplitInvariantResult } from './moneyMath';
import { retrieveStripeEvent, retrievePaymentIntent } from '@/lib/stripe/reconcile';
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
  // Two exclusions (audit H4): a row that already carries a stripe_transfer_id means money MOVED
  // (possibly under a legacy `payout-{id}` idempotency key the current `cleaner-payout-{id}` key
  // wouldn't collapse onto) — settle's repair path owns those, never a re-transfer from here. And a
  // row with no payout_percent_snapshot predates the carved-slice model; re-settling it would
  // recompute from the CURRENT percent, which conservation forbids.
  const { data: rows } = await supabase
    .from('payouts')
    .select('id, appointment_id')
    .in('status', ['failed', 'pending'])
    .is('stripe_transfer_id', null)
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
