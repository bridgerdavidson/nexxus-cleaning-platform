/**
 * Reconciliation sweep (Phase 4d) — the reliability backstop that makes DB correctness
 * independent of any single webhook delivery. Four independent, batch-capped jobs:
 *
 *   1. retryDeadLetterWebhooks   — re-dispatch webhook_events stuck in received/failed
 *   2. reconcileStuckPayments    — replay the true Stripe PI status for pending payments past SLA
 *   3. retryFailedPayouts        — re-run cleaner settlement for payouts left 'failed'
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
import { recordPaymentEvent } from './events';
import { checkSplitInvariant, type SplitInvariantResult } from './moneyMath';
import { retrieveStripeEvent, retrievePaymentIntent } from '@/lib/stripe/reconcile';

const DEFAULT_BATCH = 100;
const DEFAULT_STALE_MINUTES = 15;

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
  opts: { batch?: number; staleMinutes?: number } = {},
): Promise<StuckPaymentResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;
  const cutoff = staleCutoffIso(opts.staleMinutes ?? DEFAULT_STALE_MINUTES);

  // Payments we still believe are in-flight ('pending') that carry a PI and have sat past the
  // SLA — prime candidates for a webhook we never received. Authorized-but-uncaptured holds
  // (payment_intent_status='requires_capture') are intentionally NOT swept: they are valid
  // in-flight states owned by the JIT authorizer / capture flow.
  const { data: rows } = await supabase
    .from('payments')
    .select('id, appointment_id, organization_id, status, stripe_payment_intent_id, payment_intent_status')
    .eq('status', 'pending')
    .not('stripe_payment_intent_id', 'is', null)
    // Exclude live authorization holds (requires_capture): they legitimately stay pending for
    // days and are owned by the JIT authorizer / auth-expiry watchdog, not this sweep. Without
    // this filter the batch fills with normal holds, wasting Stripe calls and starving real
    // drift. Keep null (PI status never recorded) and any non-hold status.
    .or('payment_intent_status.is.null,payment_intent_status.neq.requires_capture')
    .lte('created_at', cutoff)
    .limit(batch);

  const list = (rows ?? []) as Array<{
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
