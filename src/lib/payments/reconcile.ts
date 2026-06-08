/**
 * Reconciliation sweep (Phase 4d) — the reliability backstop that makes DB correctness
 * independent of any single webhook delivery. Four independent, batch-capped jobs:
 *
 *   1. retryDeadLetterWebhooks   — re-dispatch webhook_events stuck in received/failed
 *   2. reconcileStuckPayments    — replay the true Stripe PI status for pending/processing payments past SLA
 *   3. retryFailedPayouts        — re-run cleaner settlement for payouts left 'failed'
 *   3b. retryHeldCleanerPayouts  — pay HELD cleaner slices (snapshot amount) once the cleaner onboards
 *   4. checkMoneyMathInvariants  — flag any paid cleaner payout that doesn't match the locked split
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
import { clawbackCleanerPayout } from './clawback';
import { recordPaymentEvent } from './events';
import { checkSplitInvariant, type SplitInvariantResult } from './moneyMath';
import { retrieveStripeEvent, retrievePaymentIntent } from '@/lib/stripe/reconcile';
import { createPlatformTransfer, transferGroupFor } from '@/lib/stripe/transfers';

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

  // 'pending' card/legacy rows past the short SLA — prime candidates for a webhook we never got.
  // Authorized-but-uncaptured holds (payment_intent_status='requires_capture') are intentionally
  // NOT swept: valid in-flight states owned by the JIT authorizer / auth-expiry watchdog. Keep
  // null (PI status never recorded) and any non-hold status.
  const { data: pendingRows } = await supabase
    .from('payments')
    .select(cols)
    .eq('status', 'pending')
    .not('stripe_payment_intent_id', 'is', null)
    .or('payment_intent_status.is.null,payment_intent_status.neq.requires_capture')
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
    .select('id, appointment_id, organization_id')
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
  }>;
  let settled = 0;

  for (const p of list) {
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

  // Only 'failed' transfers here. Re-running settle RECOMPUTES the split, which is correct for a
  // failed transfer (same inputs). HELD ('pending') slices must NOT be recomputed (the cleaner's %
  // may have changed since the hold) — they're retried at their snapshot amount by
  // retryHeldCleanerPayouts below.
  const { data: rows } = await supabase
    .from('payouts')
    .select('id, appointment_id')
    .eq('status', 'failed')
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

// ── 3b) Held-cleaner-slice retry ────────────────────────────────────────────────
export interface HeldPayoutResult {
  checked: number;
  settled: number;
}

/**
 * Pay out cleaner slices HELD at settlement because the cleaner wasn't Connect-onboarded yet
 * (settleCleanerPayout wrote a 'pending' payout; the tenant already received their remainder). Once
 * the cleaner is onboarded, transfer the SNAPSHOT amount recorded on the payout row — NOT a
 * recompute from the cleaner's current payout profile, which could over/underpay if their % changed
 * after the hold. Idempotent via the `cleaner-payout-${appt}` key + the row flipping to 'paid'.
 */
export async function retryHeldCleanerPayouts(
  supabase: SupabaseClient,
  opts: { batch?: number } = {},
): Promise<HeldPayoutResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;

  const { data: rows } = await supabase
    .from('payouts')
    .select('id, appointment_id, organization_id, cleaner_id, amount')
    .eq('status', 'pending')
    .not('appointment_id', 'is', null)
    .not('cleaner_id', 'is', null)
    .limit(batch);

  const list = (rows ?? []) as Array<{
    id: string;
    appointment_id: string;
    organization_id: string | null;
    cleaner_id: string;
    amount: number | string;
  }>;
  let settled = 0;

  for (const row of list) {
    const { data: cleanerRow } = await supabase
      .from('cleaner_profiles')
      .select('stripe_connect_account_id, stripe_connect_onboarding_complete, payout_model')
      .eq('id', row.cleaner_id)
      .maybeSingle();
    const cleaner = cleanerRow as
      | { stripe_connect_account_id: string | null; stripe_connect_onboarding_complete: boolean; payout_model: string | null }
      | null;
    // Pay only once the cleaner is Connect-ready. A cleaner who became hourly_external keeps the
    // slice held (funds stay safe on the platform) for manual resolution — never auto-redirected.
    if (
      !cleaner?.stripe_connect_account_id ||
      !cleaner.stripe_connect_onboarding_complete ||
      cleaner.payout_model === 'hourly_external'
    ) {
      continue;
    }

    const cents = Math.round(Number(row.amount) * 100);
    if (cents <= 0) continue;

    try {
      const transfer = await createPlatformTransfer({
        destinationAccountId: cleaner.stripe_connect_account_id,
        amountCents: cents,
        sourceTransactionId: null,
        transferGroup: transferGroupFor(row.appointment_id),
        idempotencyKey: `cleaner-payout-${row.appointment_id}`,
        appointmentId: row.appointment_id,
      });
      await supabase
        .from('payouts')
        .update({ status: 'paid', stripe_transfer_id: transfer.id, paid_at: new Date().toISOString() })
        .eq('id', row.id);
      await recordPaymentEvent(supabase, {
        appointmentId: row.appointment_id,
        organizationId: row.organization_id,
        eventType: 'cleaner_paid',
        newStatus: 'paid',
        actor: 'reconciler',
        amount: cents,
        payload: { transfer_id: transfer.id, from: 'held_slice' },
      });
      settled++;
    } catch (err) {
      // Leave the row 'pending' so the next sweep retries the SAME snapshot amount.
      await recordPaymentEvent(supabase, {
        appointmentId: row.appointment_id,
        organizationId: row.organization_id,
        eventType: 'cleaner_transfer_failed',
        actor: 'reconciler',
        amount: cents,
        payload: { error: err instanceof Error ? err.message : String(err), from: 'held_slice' },
      });
    }
  }

  return { checked: list.length, settled };
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
