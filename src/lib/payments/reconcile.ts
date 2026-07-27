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
 *   3a. reconcileBankPaidPayouts     — re-derive bank_paid from Stripe's payout list for stuck 'paid'
 *                                      rows (T1-3: the payout.* webhook events are an optimization,
 *                                      not a dependency)
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
import { markWebhookProcessed, markWebhookFailed, markWebhookDead } from './webhookIdempotency';
import { settleCleanerPayout } from './settleCleanerPayout';
import { settleSelfPay } from './settleSelfPay';
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
  listConnectedAccountPayouts,
  retrieveConnectedAccountPayout,
  searchPaymentIntentsByAppointment,
  listRecentPaymentIntentsForCustomer,
} from '@/lib/stripe/reconcile';
import { listTransfersByGroup, transferGroupFor } from '@/lib/stripe/transfers';
import { stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { recordPlatformAlert } from '@/lib/monitoring/platformAlert';

const DEFAULT_BATCH = 100;
const DEFAULT_STALE_MINUTES = 15;
// ACH debits legitimately sit 'processing' for several business days, so a 'processing' row is only
// "stuck" (a lost terminal webhook) well after settlement would have happened. ~6 days.
const DEFAULT_ACH_STALE_MINUTES = 6 * 24 * 60;

// T1-10: after this many failed dead-letter retries, terminalize a webhook_events row to 'dead' so a
// permanently-unrecoverable event can't starve the ascending-FIFO batch forever. retry_count only
// advances once per sweep, so at the 15-min cron cadence ~20 attempts is ~5h of transient-error grace
// before we give up and page a human.
const DEAD_LETTER_MAX_ATTEMPTS = 20;

function staleCutoffIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

// ── 1) Webhook dead-letter retry ────────────────────────────────────────────────
export interface DeadLetterResult {
  retried: number;
  recovered: number;
  stillFailed: number;
  dead: number;
}

export async function retryDeadLetterWebhooks(
  supabase: SupabaseClient,
  opts: { batch?: number; staleMinutes?: number } = {},
): Promise<DeadLetterResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;
  const cutoff = staleCutoffIso(opts.staleMinutes ?? DEFAULT_STALE_MINUTES);

  // Retryable rows only: a 'failed' attempt or a 'received' row whose live delivery never completed,
  // older than the stale window (which gives the live webhook a chance to finish first). 'dead' rows
  // (T1-10: gave up after DEAD_LETTER_MAX_ATTEMPTS) are excluded so a permanently-unrecoverable event
  // can never occupy a slot in this ascending-FIFO batch and starve newer recoverable dead-letters.
  const { data: rows, error: selectError } = await supabase
    .from('webhook_events')
    .select('id, type, account_id, retry_count')
    .in('status', ['received', 'failed'])
    .lte('received_at', cutoff)
    .order('received_at', { ascending: true })
    .limit(batch);

  if (selectError) {
    // This sweep IS the backstop for lost Connect money events (payout.failed, transfer.reversed). If
    // the query fails (e.g. migration 113 not yet applied, so retry_count is unknown; or a transient DB
    // error), supabase-js returns data=null WITHOUT throwing — a silent zero-result would report a
    // clean run while the backstop is down. Raise a critical alert (deduped by alert_type) and no-op
    // this round rather than fake success. Mirrors the retryStrandedRefundUnwinds RPC-failure guard.
    console.error('retryDeadLetterWebhooks: dead-letter query failed:', selectError.message);
    try {
      await recordPlatformAlert(supabase, {
        alert_type: 'dead_letter_sweep_disabled',
        severity: 'critical',
        summary: 'Dead-letter retry sweep is disabled: the webhook_events query failed',
        details: { error: selectError.message },
      });
    } catch (alertErr) {
      console.error('retryDeadLetterWebhooks: failed to raise sweep-disabled alert:', alertErr);
    }
    return { retried: 0, recovered: 0, stillFailed: 0, dead: 0 };
  }

  const list = (rows ?? []) as Array<{
    id: string;
    type: string;
    account_id: string | null;
    retry_count: number | null;
  }>;
  let recovered = 0;
  let stillFailed = 0;
  let dead = 0;

  for (const row of list) {
    try {
      // Pass the stored Connect account so Connect-delivered events (payout.paid/failed,
      // account.updated, connected transfer.reversed) resolve instead of 404ing on the platform.
      const event = await retrieveStripeEvent(row.id, { stripeAccount: row.account_id });
      // An event re-fetched via the Stripe-Account header does NOT carry the top-level `account` field
      // Stripe injects only on live Connect DELIVERY, yet the payout.* handlers derive the connected
      // account from event.account. Without this, a replayed payout.paid/failed sees a null account and
      // silently no-ops (then gets marked processed forever). Restore it from the stored account_id.
      if (!event.account && row.account_id) {
        (event as { account?: string | null }).account = row.account_id;
      }
      await dispatchStripeEvent(supabase, event);
      await markWebhookProcessed(supabase, row.id);
      recovered++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const attempts = (row.retry_count ?? 0) + 1;
      if (attempts >= DEAD_LETTER_MAX_ATTEMPTS) {
        // Give up: terminalize so the batch drains, and page a human — a dead Connect event is money
        // state (a payout failure, a reversal) we could never process. Key the alert by event TYPE
        // (not id) so a systemic Connect-retrieval outage folds into one incident per type via the 6h
        // dedupe instead of flooding the channel with up to `batch` distinct criticals; the specific
        // id is in the summary/details, and `webhook_events WHERE status='dead'` has the full list.
        await markWebhookDead(supabase, row.id, msg, attempts);
        try {
          await recordPlatformAlert(supabase, {
            alert_type: `webhook_dead_letter:${row.type}`,
            severity: 'critical',
            summary: `Webhook event ${row.id} (${row.type}) abandoned after ${attempts} failed dead-letter retries; replay manually (see webhook_events WHERE status='dead')`,
            details: { event_id: row.id, event_type: row.type, account_id: row.account_id, attempts, last_error: msg },
          });
        } catch (alertErr) {
          console.error('retryDeadLetterWebhooks: failed to raise dead-letter alert for', row.id, alertErr);
        }
        dead++;
      } else {
        await markWebhookFailed(supabase, row.id, msg, { retryCount: attempts });
        stillFailed++;
      }
    }
  }

  return { retried: list.length, recovered, stillFailed, dead };
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

// ── 2b-pre) Unknown charge-outcome verification (T1-16) ─────────────────────────
export interface UnknownOutcomeResult {
  checked: number;
  /** Rows re-linked to a live PaymentIntent found at Stripe (succeeded rows also flip to paid). */
  repaired: number;
  /** Rows Stripe confirmed have no charge — verification stamped, fresh retries unblocked. */
  verifiedAbsent: number;
  /** Left for the next sweep (search unavailable, row too young for an absence verdict). */
  deferred: number;
}

// Must outlive Stripe's search-indexing lag (~1 minute) with a wide margin before we conclude
// "no charge exists" and unblock a fresh (fresh-key) charge attempt.
const VERIFY_ABSENT_MIN_MINUTES = 20;

/**
 * T1-16: a completion charge whose create THREW WITHOUT a PaymentIntent attached (lost response,
 * SDK retries exhausted) is recorded as a `failed` revenue row with no PI — but Stripe may have
 * captured it. That money would sit stranded on the platform balance, and an operator Retry would
 * mint a fresh idempotency key and charge a SECOND time. chargeCompletedAppointment blocks fresh
 * charges while such a row is unverified; this job resolves each one against Stripe by metadata
 * search:
 *   - a live PI found → re-link the row (succeeded → paid + captured_at, so settleUnsettledCaptures
 *     / settleSelfPay move the money) + critical per-appointment alert (`charge_outcome_recovered`);
 *   - no charge exists (row old enough for search indexing) → stamp charge_outcome_verified_at so
 *     retries unblock;
 *   - Stripe unreadable / row too young → leave for the next sweep (retries stay blocked — the
 *     safe direction).
 */
export async function verifyUnknownChargeOutcomes(
  supabase: SupabaseClient,
  opts: { batch?: number } = {},
): Promise<UnknownOutcomeResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;

  const { data: rows, error } = await supabase
    .from('payments')
    .select('id, appointment_id, organization_id, amount, is_self_pay, created_at, charge_outcome_unknown_since')
    .eq('status', 'failed')
    .eq('payment_type', 'revenue')
    .eq('charge_kind', 'completion')
    .eq('payment_method', 'card')
    .is('stripe_payment_intent_id', null)
    .is('charge_outcome_verified_at', null)
    .order('created_at', { ascending: true })
    .limit(batch);
  if (error) {
    // The fresh-charge guard is blocking retries on exactly these rows, so a silently-disabled
    // sweep would leave them blocked forever (migration 116 lag, grant drift). Alert + no-op —
    // the T1-10-F3 pattern.
    console.error('verifyUnknownChargeOutcomes: select failed:', error);
    await recordPlatformAlert(supabase, {
      alert_type: 'charge_outcome_sweep_disabled',
      severity: 'critical',
      summary: 'Unknown-charge-outcome verification sweep is disabled: candidate select failed (is migration 116 applied?)',
      details: { error: error.message },
    });
    return { checked: 0, repaired: 0, verifiedAbsent: 0, deferred: 0 };
  }

  const list = (rows ?? []) as Array<{
    id: string;
    appointment_id: string;
    organization_id: string | null;
    amount: number | string;
    is_self_pay: boolean | null;
    created_at: string;
    charge_outcome_unknown_since: string | null;
  }>;

  let checked = 0;
  let repaired = 0;
  let verifiedAbsent = 0;
  let deferred = 0;
  const nowIso = new Date().toISOString();

  for (const row of list) {
    checked++;
    try {
      // The grace anchor is the LATEST unknown attempt, not the row's insert time: the revenue
      // row is upserted in place across attempts, so created_at can be days old the moment a
      // retry loses its response (which would collapse the indexing-lag grace to zero).
      // created_at is only the fallback for rows written before the column existed.
      const unknownSinceIso = row.charge_outcome_unknown_since ?? row.created_at;
      const unknownSinceMs = Date.parse(unknownSinceIso);

      let searched: Stripe.PaymentIntent[];
      try {
        searched = await searchPaymentIntentsByAppointment(row.appointment_id);
      } catch (err) {
        // Stripe unreadable: retries stay blocked (safe), try again next sweep.
        console.error('verifyUnknownChargeOutcomes: search failed for', row.appointment_id, err);
        deferred++;
        continue;
      }

      // Corroborate with the strongly-consistent LIST endpoint: search alone can miss a
      // seconds-old capture (indexing lag, unbounded during a Stripe backlog), and can't be the
      // sole basis for an "absent" verdict that re-arms a fresh-key charge. The customer id also
      // pins the payer. A capture found here repairs immediately instead of waiting out the lag.
      const rowSelfPay = !!row.is_self_pay;
      let listed: Stripe.PaymentIntent[] = [];
      let corroborated = false;
      const customer = await resolveCompletionCustomerId(supabase, row.appointment_id, rowSelfPay);
      if (!customer.ok) {
        // A DB read error is not "no customer exists" — defer rather than weaken corroboration.
        deferred++;
        continue;
      }
      if (customer.customerId) {
        try {
          listed = await listRecentPaymentIntentsForCustomer(
            customer.customerId,
            Math.floor(unknownSinceMs / 1000) - 3600,
          );
          corroborated = true;
        } catch (err) {
          console.error('verifyUnknownChargeOutcomes: customer list failed for', row.appointment_id, err);
          deferred++;
          continue;
        }
      }

      // Merge, then scope: this appointment's completion PIs only, on the row's leg (homeowner
      // and self-pay completions share charge_kind; a homeowner row must never adopt a self-pay
      // PI and vice versa).
      const byId = new Map<string, Stripe.PaymentIntent>();
      for (const pi of [...searched, ...listed]) byId.set(pi.id, pi);
      const scoped = [...byId.values()].filter(
        (pi) =>
          pi.metadata?.appointment_id === row.appointment_id &&
          pi.metadata?.charge_kind === 'completion' &&
          (pi.metadata?.self_pay === 'true') === rowSelfPay,
      );
      const newestFirst = [...scoped].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
      const succeeded = newestFirst.find((pi) => pi.status === 'succeeded');
      // Only an in-flight PI plausibly created BY the unknown attempt resolves the verdict: an
      // old requires_action PI from a PRIOR attempt (off-session 3DS stays live indefinitely)
      // must not be adopted while the real capture may still be un-indexed — adoption exits the
      // sweep shape forever.
      const inFlight = newestFirst.find(
        (pi) =>
          (pi.status === 'processing' || pi.status === 'requires_action') &&
          (pi.created ?? 0) * 1000 >= unknownSinceMs - 10 * 60_000,
      );

      if (succeeded) {
        // Two adopt refusals, both fail-CLOSED (retries stay blocked, a human is paged):
        // an amount that doesn't match what this row recorded (stale processing_fee_cents would
        // mis-split settlement), and a PI that has already been refunded (out-of-band Dashboard
        // refund leaves no local trace on a PI-less row; repairing to paid would re-arm
        // settlement on returned money).
        if (succeeded.amount !== Math.round(Number(row.amount) * 100)) {
          await recordPaymentEvent(supabase, {
            paymentId: row.id,
            appointmentId: row.appointment_id,
            organizationId: row.organization_id,
            eventType: 'charge_outcome_adopt_blocked',
            actor: 'reconciler',
            amount: succeeded.amount,
            payload: {
              reason: 'amount_mismatch',
              payment_intent_id: succeeded.id,
              row_amount_cents: Math.round(Number(row.amount) * 100),
              self_pay: rowSelfPay,
            },
          });
          deferred++;
          continue;
        }
        let refundedCents = 0;
        try {
          const refunds = await listRefundsForPaymentIntent(succeeded.id);
          refundedCents = refunds
            .filter((r) => r.status !== 'failed' && r.status !== 'canceled')
            .reduce((sum, r) => sum + (r.amount ?? 0), 0);
        } catch (err) {
          console.error('verifyUnknownChargeOutcomes: refund check failed:', err);
          deferred++;
          continue;
        }
        if (refundedCents > 0) {
          await recordPaymentEvent(supabase, {
            paymentId: row.id,
            appointmentId: row.appointment_id,
            organizationId: row.organization_id,
            eventType: 'charge_outcome_adopt_blocked',
            actor: 'reconciler',
            amount: succeeded.amount,
            payload: {
              reason: 'already_refunded',
              payment_intent_id: succeeded.id,
              refunded_cents: refundedCents,
              self_pay: rowSelfPay,
            },
          });
          deferred++;
          continue;
        }

        const chargeId =
          typeof succeeded.latest_charge === 'string'
            ? succeeded.latest_charge
            : succeeded.latest_charge?.id ?? null;
        // .eq(status,'failed') + the unknown_since token: a racing repair, manual fix, or a NEW
        // unknown attempt (which re-arms with a fresh timestamp) makes this match 0 rows.
        const { data: repairedRows, error: repairErr } = await supabase
          .from('payments')
          .update({
            status: 'paid',
            stripe_payment_intent_id: succeeded.id,
            payment_intent_status: succeeded.status,
            amount: succeeded.amount / 100,
            captured_at: new Date((succeeded.created ?? 0) * 1000).toISOString(),
            charge_outcome_verified_at: nowIso,
          })
          .eq('id', row.id)
          .eq('status', 'failed')
          .select('id');
        if (repairErr || !repairedRows || repairedRows.length === 0) {
          if (repairErr) console.error('verifyUnknownChargeOutcomes: repair failed:', repairErr);
          deferred++;
          continue;
        }
        // NULL covers the card-link self-heal reset; a paid row must always leave triage.
        const { error: flipErr } = await supabase
          .from('appointments')
          .update({ authorization_status: 'captured' })
          .eq('id', row.appointment_id)
          .or('authorization_status.in.(failed,requires_action),authorization_status.is.null');
        if (flipErr) {
          console.error('verifyUnknownChargeOutcomes: triage flip failed:', flipErr);
        }
        let selfPaySettled: boolean | null = null;
        if (rowSelfPay && chargeId) {
          // Self-pay rows are excluded from settleUnsettledCaptures; settle the recovered charge
          // directly (idempotent). The outcome rides in the alert payload so the owner's
          // "verify settlement" instruction has the answer attached.
          try {
            const settle = await settleSelfPay(supabase, row.appointment_id, chargeId);
            selfPaySettled = settle.settled;
          } catch (err) {
            console.error('verifyUnknownChargeOutcomes: self-pay settle failed:', err);
            selfPaySettled = false;
          }
        }
        await recordPaymentEvent(supabase, {
          paymentId: row.id,
          appointmentId: row.appointment_id,
          organizationId: row.organization_id,
          eventType: 'charge_outcome_recovered',
          actor: 'reconciler',
          amount: succeeded.amount,
          payload: {
            payment_intent_id: succeeded.id,
            candidate_count: scoped.length,
            self_pay: rowSelfPay,
            ...(selfPaySettled != null ? { self_pay_settled: selfPaySettled } : {}),
          },
        });
        repaired++;
        continue;
      }

      if (inFlight) {
        // Link the row so the normal machinery owns it: 'processing' rows are
        // reconcileStuckPayments territory; requires_action stays failed for the card-recovery
        // surfaces. Either way the outcome is now KNOWN.
        const { data: linkedRows, error: linkErr } = await supabase
          .from('payments')
          .update({
            stripe_payment_intent_id: inFlight.id,
            payment_intent_status: inFlight.status,
            ...(inFlight.status === 'processing' ? { status: 'processing' } : {}),
            charge_outcome_verified_at: nowIso,
          })
          .eq('id', row.id)
          .eq('status', 'failed')
          .select('id');
        if (linkErr || !linkedRows || linkedRows.length === 0) {
          if (linkErr) console.error('verifyUnknownChargeOutcomes: link failed:', linkErr);
          deferred++;
          continue;
        }
        await recordPaymentEvent(supabase, {
          paymentId: row.id,
          appointmentId: row.appointment_id,
          organizationId: row.organization_id,
          eventType: 'charge_outcome_recovered',
          actor: 'reconciler',
          amount: inFlight.amount,
          payload: {
            payment_intent_id: inFlight.id,
            payment_intent_status: inFlight.status,
            candidate_count: scoped.length,
            self_pay: rowSelfPay,
          },
        });
        repaired++;
        continue;
      }

      // No live PI. Conclude "no charge exists" only when the LATEST unknown attempt comfortably
      // outlives search-indexing lag AND the strongly-consistent customer list corroborated the
      // absence (search alone can return empty for hours during a Stripe indexing backlog, and
      // this stamp is exactly what re-arms a fresh-key charge). No resolvable customer means no
      // charge could have been created off-session either, so grace alone suffices there.
      if (Date.now() - unknownSinceMs < VERIFY_ABSENT_MIN_MINUTES * 60_000) {
        deferred++;
        continue;
      }
      const stampQuery = supabase
        .from('payments')
        .update({ charge_outcome_verified_at: nowIso })
        .eq('id', row.id)
        .eq('status', 'failed');
      // Optimistic-concurrency token: a NEW unknown attempt re-arms with a fresh timestamp, so a
      // verdict computed against the OLD attempt (overlapping sweep run) matches 0 rows.
      const { data: stampedRows, error: stampErr } = await (row.charge_outcome_unknown_since
        ? stampQuery.eq('charge_outcome_unknown_since', row.charge_outcome_unknown_since)
        : stampQuery.is('charge_outcome_unknown_since', null)
      ).select('id');
      if (stampErr || !stampedRows || stampedRows.length === 0) {
        if (stampErr) {
          console.error('verifyUnknownChargeOutcomes: verify-absent stamp failed:', stampErr);
        }
        deferred++;
        continue;
      }
      await recordPaymentEvent(supabase, {
        paymentId: row.id,
        appointmentId: row.appointment_id,
        organizationId: row.organization_id,
        eventType: 'charge_outcome_verified_absent',
        actor: 'reconciler',
        amount: Math.round(Number(row.amount) * 100),
        payload: { candidate_count: scoped.length, self_pay: rowSelfPay, corroborated },
      });
      verifiedAbsent++;
    } catch (err) {
      console.error('verifyUnknownChargeOutcomes failed for', row.appointment_id, err);
      deferred++;
    }
  }

  return { checked, repaired, verifiedAbsent, deferred };
}

/**
 * The Stripe Customer a completion charge for this appointment would have been created against:
 * the homeowner's platform Customer, or the org's self-pay Customer. `customerId: null` with
 * `ok: true` means no customer EXISTS (the charge could not have been created off-session without
 * one); `ok: false` means a read failed and the caller must defer, not weaken corroboration.
 */
async function resolveCompletionCustomerId(
  supabase: SupabaseClient,
  appointmentId: string,
  selfPay: boolean,
): Promise<{ ok: boolean; customerId: string | null }> {
  const { data: apptRow, error: apptErr } = await supabase
    .from('appointments')
    .select('homeowner_id, organization_id')
    .eq('id', appointmentId)
    .maybeSingle();
  if (apptErr) return { ok: false, customerId: null };
  const appt = apptRow as { homeowner_id: string | null; organization_id: string | null } | null;
  if (!appt) return { ok: true, customerId: null };
  if (selfPay) {
    if (!appt.organization_id) return { ok: true, customerId: null };
    const { data, error } = await supabase
      .from('organizations')
      .select('stripe_self_pay_customer_id')
      .eq('id', appt.organization_id)
      .maybeSingle();
    if (error) return { ok: false, customerId: null };
    return {
      ok: true,
      customerId:
        (data as { stripe_self_pay_customer_id: string | null } | null)?.stripe_self_pay_customer_id ?? null,
    };
  }
  if (!appt.homeowner_id) return { ok: true, customerId: null };
  const { data, error } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', appt.homeowner_id)
    .maybeSingle();
  if (error) return { ok: false, customerId: null };
  return {
    ok: true,
    customerId: (data as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null,
  };
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

// ── 3a) Bank-paid payout reconcile (T1-3) ───────────────────────────────────────
export interface BankPaidReconcileResult {
  cleanersChecked: number;
  replayed: number;
  bankPaidRechecked: number;
}

// Stripe payouts arrive T+2, so give the live webhook first crack; below 3 days a 'paid' row is
// normal in-flight state, not drift.
const BANK_PAID_MIN_AGE_DAYS = 3;
// A permanently-unmatchable row must not poll Stripe every sweep forever; outside the lookback it
// stays visible as 'paid' in the ledger UI but is no longer polled.
const BANK_PAID_LOOKBACK_DAYS = 45;
const BANK_PAID_CLEANER_BATCH = 10;
const BANK_PAID_PAYOUTS_PER_CLEANER = 20;
// A bank bounce (paid → failed at the bank) typically surfaces within a couple of business days
// of the stamp; recheck recent bank_paid stamps for a week.
const BANK_PAID_RECHECK_DAYS = 7;
const BANK_PAID_RECHECK_BATCH = 20;

/**
 * T1-3: `bank_paid` must not depend on webhook delivery. A payouts row sits 'paid' (the transfer
 * landed on the cleaner's connected balance) until a payout.paid event marks it bank_paid; if the
 * event subscription is missing/misconfigured or a delivery is lost, the row lies at 'paid'
 * forever and a bank-level payout failure changes nothing. This job re-derives the truth from
 * Stripe in both directions:
 *
 *   (a) STUCK 'paid' ROWS → for cleaners with old-enough stuck rows, list the connected account's
 *       payouts from just before the oldest stuck row's paid_at (so an old missed payout is always
 *       inside the window, not crowded out by newer ones) and replay each terminal payout
 *       OLDEST-FIRST through the normal idempotent dispatcher as a synthetic payout.paid /
 *       payout.failed event (the same pattern reconcileStuckPayments uses for PI states). All
 *       matching, replay-guard, notification and dedupe logic lives in the handlers, so webhook
 *       delivery and reconcile discovery can never disagree.
 *   (b) RECENT bank_paid STAMPS → re-retrieve each row's payout and replay payout.failed if it
 *       has since flipped failed/canceled at the bank. Without this, the revert direction would
 *       still hard-depend on the payout.failed subscription (and a stale-list race in (a) could
 *       leave a false bank_paid standing); this closes both within one sweep cycle.
 */
export async function reconcileBankPaidPayouts(
  supabase: SupabaseClient,
  opts: {
    minAgeDays?: number;
    lookbackDays?: number;
    cleanerBatch?: number;
    payoutsPerCleaner?: number;
  } = {},
): Promise<BankPaidReconcileResult> {
  const minAgeDays = opts.minAgeDays ?? BANK_PAID_MIN_AGE_DAYS;
  const lookbackDays = opts.lookbackDays ?? BANK_PAID_LOOKBACK_DAYS;
  const cleanerBatch = opts.cleanerBatch ?? BANK_PAID_CLEANER_BATCH;
  const payoutsPerCleaner = opts.payoutsPerCleaner ?? BANK_PAID_PAYOUTS_PER_CLEANER;
  const minAgeCutoff = staleCutoffIso(minAgeDays * 24 * 60);
  const lookbackCutoff = staleCutoffIso(lookbackDays * 24 * 60);

  const { data: stuckRows, error: selectError } = await supabase
    .from('payouts')
    .select('cleaner_id, paid_at')
    .eq('status', 'paid')
    .not('stripe_transfer_id', 'is', null)
    .lte('paid_at', minAgeCutoff)
    .gte('paid_at', lookbackCutoff)
    .order('paid_at', { ascending: true })
    .limit(200);
  if (selectError) {
    // A failing select silently disables the backstop (the T1-10 F3 lesson); no new columns are
    // involved so this can only be transient, but say so loudly rather than returning "0 checked".
    console.error('reconcileBankPaidPayouts: candidate select failed:', selectError);
    return { cleanersChecked: 0, replayed: 0, bankPaidRechecked: 0 };
  }

  // Oldest-first distinct cleaners so one busy cleaner can't starve the rest; remember each
  // cleaner's OLDEST stuck paid_at so the Stripe list window can anchor just before it.
  const oldestStuckByCleaner = new Map<string, number>();
  for (const r of (stuckRows ?? []) as Array<{ cleaner_id: string; paid_at: string }>) {
    if (!oldestStuckByCleaner.has(r.cleaner_id)) {
      if (oldestStuckByCleaner.size >= cleanerBatch) continue;
      oldestStuckByCleaner.set(r.cleaner_id, new Date(r.paid_at).getTime());
    }
  }

  let replayed = 0;
  for (const [cleanerId, oldestStuckMs] of oldestStuckByCleaner) {
    const { data: cleaner } = await supabase
      .from('cleaner_profiles')
      .select('stripe_connect_account_id')
      .eq('id', cleanerId)
      .maybeSingle();
    const acct = (cleaner as { stripe_connect_account_id: string | null } | null)
      ?.stripe_connect_account_id;
    if (!acct) continue;

    // Anchor the window at the oldest stuck row (minus 2 days of slack: its covering payout was
    // created shortly AFTER the transfer) rather than "the last N payouts" — a daily-payout
    // cleaner's old missed payout would otherwise sit forever beyond the newest-N slice.
    const anchorMs = Math.max(
      Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
      oldestStuckMs - 2 * 24 * 60 * 60 * 1000,
    );
    let payouts: Stripe.Payout[];
    try {
      payouts = await listConnectedAccountPayouts(acct, {
        createdAfterEpochSec: Math.floor(anchorMs / 1000),
      });
    } catch (err) {
      console.error('reconcileBankPaidPayouts: could not list payouts for', acct, err);
      continue;
    }

    // Stripe lists newest-first; replay OLDEST-first so the oldest stuck rows (the ones that made
    // this cleaner a candidate) heal before the per-cleaner cap cuts the tail.
    const ascending = [...payouts].reverse();
    for (const po of ascending.slice(0, payoutsPerCleaner)) {
      // Only terminal payout states are actionable; pending/in_transit resolve on their own.
      const type =
        po.status === 'paid'
          ? 'payout.paid'
          : po.status === 'failed' || po.status === 'canceled'
            ? 'payout.failed'
            : null;
      if (!type) continue;
      const synthetic = {
        id: `reconcile_${po.id}_${po.status}`,
        object: 'event',
        type,
        data: { object: po },
        account: acct,
      } as unknown as Stripe.Event;
      try {
        await dispatchStripeEvent(supabase, synthetic);
        replayed++;
      } catch (err) {
        console.error('reconcileBankPaidPayouts: replay failed for payout', po.id, err);
      }
    }
  }

  const bankPaidRechecked = await recheckRecentBankPaid(supabase);
  return { cleanersChecked: oldestStuckByCleaner.size, replayed, bankPaidRechecked };
}

/**
 * (b) Bank-bounce recheck: for rows stamped bank_paid in the last week, re-retrieve the payout
 * and replay payout.failed if it has since flipped failed/canceled. Returns how many distinct
 * payouts were rechecked. Best-effort per item; a retrieve failure leaves the pair for the next
 * sweep.
 */
async function recheckRecentBankPaid(supabase: SupabaseClient): Promise<number> {
  const recheckCutoff = staleCutoffIso(BANK_PAID_RECHECK_DAYS * 24 * 60);
  const { data: rows, error } = await supabase
    .from('payouts')
    .select('cleaner_id, stripe_payout_id')
    .eq('status', 'bank_paid')
    .not('stripe_payout_id', 'is', null)
    .gte('bank_paid_at', recheckCutoff)
    .order('bank_paid_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error('recheckRecentBankPaid: select failed:', error);
    return 0;
  }

  // Distinct (cleaner, payout) pairs, capped.
  const pairs = new Map<string, { cleanerId: string; payoutId: string }>();
  for (const r of (rows ?? []) as Array<{ cleaner_id: string; stripe_payout_id: string }>) {
    const key = `${r.cleaner_id}:${r.stripe_payout_id}`;
    if (!pairs.has(key)) pairs.set(key, { cleanerId: r.cleaner_id, payoutId: r.stripe_payout_id });
    if (pairs.size >= BANK_PAID_RECHECK_BATCH) break;
  }

  const acctByCleaner = new Map<string, string | null>();
  let rechecked = 0;
  for (const { cleanerId, payoutId } of pairs.values()) {
    if (!acctByCleaner.has(cleanerId)) {
      const { data: cleaner } = await supabase
        .from('cleaner_profiles')
        .select('stripe_connect_account_id')
        .eq('id', cleanerId)
        .maybeSingle();
      acctByCleaner.set(
        cleanerId,
        (cleaner as { stripe_connect_account_id: string | null } | null)
          ?.stripe_connect_account_id ?? null,
      );
    }
    const acct = acctByCleaner.get(cleanerId);
    if (!acct) continue;

    let po: Stripe.Payout;
    try {
      po = await retrieveConnectedAccountPayout(acct, payoutId);
    } catch (err) {
      console.error('recheckRecentBankPaid: could not retrieve payout', payoutId, err);
      continue;
    }
    rechecked++;
    if (po.status !== 'failed' && po.status !== 'canceled') continue;

    const synthetic = {
      id: `reconcile_${po.id}_${po.status}_recheck`,
      object: 'event',
      type: 'payout.failed',
      data: { object: po },
      account: acct,
    } as unknown as Stripe.Event;
    try {
      await dispatchStripeEvent(supabase, synthetic);
    } catch (err) {
      console.error('recheckRecentBankPaid: replay failed for payout', po.id, err);
    }
  }
  return rechecked;
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

    // A refund legitimately makes the recorded payout SMALLER than the gross split: a held cleaner
    // slice settled after a refund is paid its refund-shrunk share (audit T1-13), and a transfer-
    // based partial refund reverses the transfer at Stripe while the row's amount stays put. Neither
    // is a platform loss, and netting refunds here can't fit both shapes at once, so on a refunded
    // appointment flag only an OVERPAY (recorded MORE than the gross split, drift > tolerance). The
    // strict two-sided check still guards the common no-refund case.
    const { data: refundRow } = await supabase
      .from('refunds')
      .select('id')
      .eq('appointment_id', row.appointment_id)
      .in('status', ['pending', 'succeeded'])
      .limit(1);
    const hasRefund = ((refundRow ?? []) as Array<{ id: string }>).length > 0;
    const isViolation = !result || (hasRefund ? result.driftCents > 1 : !result.ok);

    if (isViolation) {
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
  /**
   * Routed to a terminal manual-review marker + critical alert instead of auto-reversing —
   * either an unsafe unwind shape (the three guards) or preflight stalls exhausted (T1-15a).
   */
  manualReview: number;
  /**
   * Skipped this round (retry backoff, a refund landed too recently, a stale target at the
   * pre-reversal recheck, or a bounded preflight stall). Still a candidate.
   */
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
export const REFUND_UNWIND_PREFLIGHT_STALLED_EVENT = 'refund_unwind_preflight_stalled';

/**
 * T1-15(a): a preflight `continue` (no PaymentIntent, unreadable charge/refunds/transfers) writes
 * no marker and no fresh failure event, so a permanently-unreadable appointment would hold a slot
 * of the oldest-first candidate batch every sweep, forever, starving younger stranded ones. Each
 * stall appends a forensic `refund_unwind_preflight_stalled` event; once an appointment
 * accumulates this many in one candidacy episode (since its newest failure event) the stall
 * budget is exhausted. 12 stalls at the 15-minute cron cadence is ~3h of grace.
 *
 * What exhaustion does depends on the stall CLASS:
 *   - DB-shape reasons (no PI to re-derive from, refund state inconsistent) are per-appointment
 *     and cannot self-heal → terminalize to manual review (critical alert, leaves the sweep).
 *   - Stripe-READ reasons (charge/refunds/transfers/recheck unreadable) are usually a transport
 *     outage hitting every candidate at once. Terminalizing would end auto-recovery for money
 *     that recovers by itself the moment Stripe heals ("money is never abandoned"), so instead
 *     the appointment STAYS a candidate, stops accruing stall events (bounding ledger growth),
 *     and raises a deduped per-appointment critical alert so a human sees a persistently
 *     unreadable job while the sweep keeps trying.
 */
const UNWIND_PREFLIGHT_MAX_STALLS = 12;
const TERMINAL_STALL_REASONS = new Set(['no_payment_intent', 'no_live_refunds']);

type PreflightStallOutcome = 'stalled' | 'terminalized';

async function noteUnwindPreflightStall(
  supabase: SupabaseClient,
  c: StrandedUnwindCandidate,
  reason: string,
  ctx: { paymentId?: string | null; organizationId?: string | null; amountCents?: number },
): Promise<PreflightStallOutcome> {
  const common = {
    paymentId: ctx.paymentId ?? c.payment_id ?? undefined,
    appointmentId: c.appointment_id,
    organizationId: ctx.organizationId ?? c.organization_id,
    actor: 'reconciler',
    amount: ctx.amountCents ?? 0,
  };

  const { data: stalls, error: stallError } = await supabase
    .from('payment_events')
    .select('id')
    .eq('appointment_id', c.appointment_id)
    .eq('event_type', REFUND_UNWIND_PREFLIGHT_STALLED_EVENT)
    .gte('created_at', c.failed_at)
    .limit(UNWIND_PREFLIGHT_MAX_STALLS);
  if (stallError) {
    // Unknown stall history: record this stall best-effort and keep the candidate — never
    // terminalize money recovery on unknown state.
    console.error('noteUnwindPreflightStall: stall-count read failed:', stallError);
    await recordPaymentEvent(supabase, {
      ...common,
      eventType: REFUND_UNWIND_PREFLIGHT_STALLED_EVENT,
      payload: { source: 'retry-stranded-refund-unwinds', stall_reason: reason },
    });
    return 'stalled';
  }

  const priorStalls = (stalls ?? []).length;
  if (priorStalls >= UNWIND_PREFLIGHT_MAX_STALLS - 1) {
    if (TERMINAL_STALL_REASONS.has(reason)) {
      await recordPaymentEvent(supabase, {
        ...common,
        eventType: REFUND_UNWIND_MANUAL_REVIEW_EVENT,
        payload: {
          source: 'retry-stranded-refund-unwinds',
          preflight_exhausted: true,
          stall_reason: reason,
          stalls: priorStalls + 1,
        },
      });
      return 'terminalized';
    }
    // Stripe-read stall past the budget: keep candidacy, page a human, append nothing more
    // (the open-incident dedupe folds this into one alert per appointment).
    await recordPlatformAlert(supabase, {
      alert_type: `refund_unwind_preflight_blocked:${c.appointment_id}`,
      severity: 'critical',
      summary: `Stranded refund unwind cannot read Stripe state (${reason}); still retrying every sweep`,
      details: {
        appointment_id: c.appointment_id,
        organization_id: common.organizationId ?? null,
        stall_reason: reason,
        stalls: priorStalls,
      },
    });
    return 'stalled';
  }

  await recordPaymentEvent(supabase, {
    ...common,
    eventType: REFUND_UNWIND_PREFLIGHT_STALLED_EVENT,
    payload: { source: 'retry-stranded-refund-unwinds', stall_reason: reason },
  });
  return 'stalled';
}

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
 * the FULL charge and belongs to THIS charge, so three guards route anything else to a terminal
 * `refund_unwind_manual_review` marker (critical alert, no money moved) instead of auto-reversing:
 *   - another Stripe-charged payment shares the appointment (e.g. a cancellation fee) — the
 *     transfer group mixes charges, and a group-wide reversal would claw back the fee the tenant
 *     is owed;
 *   - a transfer was created at/after the earliest (money-moving) refund — settlement splits net
 *     of refunds (settleCleanerPayout), so that refund is already absorbed in the transfer sizes
 *     and reversing proportional-to-gross would double-deduct it from the tenant and cleaner;
 *   - a cleaner slice is still owed (held 'pending' / 'failed' with no transfer) — it can't be
 *     reversed here, and settleCleanerPayout later pays the carved snapshot amount without
 *     subtracting this refund, so auto-recovering now would mask that future overpay (T1-2/T1-12).
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
    // The candidate query IS the T1-1 backstop. If it fails (migration 112 not applied, grant
    // drift, transient DB error) the sweep can recover nothing, so a silent zero-result would let
    // stranded refunds rot while the cron reports a clean run. Raise a critical platform alert that
    // the backstop itself is down (deduped by alert_type, so a persistent failure is one incident),
    // and no-op this round rather than fall back to a selection shape with the starvation bug.
    console.error('retryStrandedRefundUnwinds: candidate RPC failed:', rpcError.message);
    try {
      await recordPlatformAlert(supabase, {
        alert_type: 'refund_unwind_sweep_disabled',
        severity: 'critical',
        summary: 'Stranded refund-unwind sweep is disabled: candidate query failed',
        details: { error: rpcError.message },
      });
    } catch (alertErr) {
      console.error('retryStrandedRefundUnwinds: failed to raise sweep-disabled alert:', alertErr);
    }
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
      if (!payment?.stripe_payment_intent_id) {
        // Nothing to re-derive from. Bounded stall (T1-15a): terminalizes to manual review
        // after UNWIND_PREFLIGHT_MAX_STALLS fruitless touches.
        const outcome = await noteUnwindPreflightStall(supabase, c, 'no_payment_intent', {
          paymentId: payment?.id,
          organizationId: payment?.organization_id,
        });
        if (outcome === 'terminalized') manualReview++;
        else deferred++;
        continue;
      }

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
        // Stripe unreadable — leave for the next sweep (bounded stall, T1-15a).
      }
      if (!charge) {
        const outcome = await noteUnwindPreflightStall(supabase, c, 'charge_unreadable', {
          paymentId: payment.id,
          organizationId: payment.organization_id,
        });
        if (outcome === 'terminalized') manualReview++;
        else deferred++;
        continue;
      }

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
        // Stripe unreadable — leave for the next sweep (bounded stall, T1-15a).
        const outcome = await noteUnwindPreflightStall(supabase, c, 'refunds_unreadable', {
          paymentId: payment.id,
          organizationId: orgId,
          amountCents: totalRefundedCents,
        });
        if (outcome === 'terminalized') manualReview++;
        else deferred++;
        continue;
      }
      // A 'failed'/'canceled' refund returned no money: it never shrank a transfer and settlement
      // never netted it out, so its `created` time must not drive the guards below (an old failed
      // refund would otherwise mis-classify a later transfer as settlement-absorbed, or its recency
      // would wrongly defer the sweep). `charge.amount_refunded` already counts only money that
      // actually moved. Mirrors the refund route's own status filter.
      refunds = refunds.filter((r) => r.status !== 'failed' && r.status !== 'canceled');
      if (refunds.length === 0) {
        // amount_refunded > 0 but no live refunds listed — inconsistent Stripe state; bounded
        // stall (T1-15a) so it can't occupy a batch slot forever.
        const outcome = await noteUnwindPreflightStall(supabase, c, 'no_live_refunds', {
          paymentId: payment.id,
          organizationId: orgId,
          amountCents: totalRefundedCents,
        });
        if (outcome === 'terminalized') manualReview++;
        else deferred++;
        continue;
      }

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
        // Stripe unreadable — leave for the next sweep (bounded stall, T1-15a).
        const outcome = await noteUnwindPreflightStall(supabase, c, 'transfers_unreadable', {
          paymentId: payment.id,
          organizationId: orgId,
          amountCents: totalRefundedCents,
        });
        if (outcome === 'terminalized') manualReview++;
        else deferred++;
        continue;
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

      // Guard 2: a transfer created at or after the earliest refund was split NET of that refund
      // (settleCleanerPayout subtracts already-refunded cents), so proportional-to-gross would
      // deduct it a second time. Stripe `created` is 1-second resolution, so a refund and a
      // net-of-refund settlement in the SAME second must count as absorbed — hence `>=`, not `>`.
      const earliestRefundSec = Math.min(...refunds.map((r) => r.created ?? 0));
      const refundAbsorbedAtSettlement = transfers.some((t) => (t.created ?? 0) >= earliestRefundSec);

      // Guard 3: a still-owed cleaner slice — carved at settlement but HELD ('pending') or 'failed'
      // with no transfer yet — can't be reversed here (no transfer exists to reverse). settleCleaner-
      // Payout later pays that carved SNAPSHOT amount, which does NOT subtract this refund, so
      // silently recovering now would mask a future overpay (the platform pays the cleaner the
      // pre-refund share). Route to manual review until the held slice is reconciled against the
      // refund. The real fix (shrink the carved slice by the refund) lives in settleCleanerPayout;
      // see audit T1-2/T1-12. A slice that already has a transfer id is handled by the reversal below.
      const { data: heldPayout } = await supabase
        .from('payouts')
        .select('id')
        .eq('appointment_id', c.appointment_id)
        .in('status', ['pending', 'failed'])
        .is('stripe_transfer_id', null)
        .limit(1);
      const cleanerSliceStillOwed = ((heldPayout ?? []) as Array<{ id: string }>).length > 0;

      if (mixedCharges || refundAbsorbedAtSettlement || cleanerSliceStillOwed) {
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
            cleaner_slice_still_owed: cleanerSliceStillOwed,
            gross_cents: grossCents,
          },
        });
        manualReview++;
        continue;
      }

      // T1-15(b): several Stripe/DB reads have happened since totalRefundedCents was derived at
      // the top of this iteration. If a NEW refund landed meanwhile, the live unwind path (route /
      // charge.refunded webhook) owns the fresh cumulative target, and running our stale target
      // concurrently could over-reverse (the reversal idempotency key only dedupes EQUAL targets).
      // Re-read the authoritative total immediately before moving money; any change defers to the
      // next sweep, which re-derives from scratch.
      let freshRefundedCents: number;
      try {
        freshRefundedCents = (await retrieveCharge(charge.id)).amount_refunded ?? 0;
      } catch {
        const outcome = await noteUnwindPreflightStall(supabase, c, 'refund_recheck_unreadable', {
          paymentId: payment.id,
          organizationId: orgId,
          amountCents: totalRefundedCents,
        });
        if (outcome === 'terminalized') manualReview++;
        else deferred++;
        continue;
      }
      if (freshRefundedCents !== totalRefundedCents) {
        deferred++;
        continue;
      }

      const result = await reverseJobTransfersForRefund(supabase, {
        appointmentId: c.appointment_id,
        totalRefundedCents,
        grossCents,
        actor: 'reconciler',
        paymentId: payment.id,
        organizationId: orgId,
        sourceChargeId: charge.id,
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
