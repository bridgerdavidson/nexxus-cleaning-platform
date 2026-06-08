import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { stripeEnabled } from '@/lib/stripe/flags';
import {
  retryDeadLetterWebhooks,
  reconcileStuckPayments,
  settleUnsettledCaptures,
  retryFailedPayouts,
  retryHeldCleanerPayouts,
  retryStrandedClawbacks,
  checkMoneyMathInvariants,
} from '@/lib/payments/reconcile';

// Needs the service-role admin client; nothing edge-specific here.
export const runtime = 'nodejs';

/**
 * POST /api/cron/reconcile-payments  (CRON_SECRET-guarded; pg_cron calls it — migration 067)
 *
 * The reliability backstop (Phase 4d). Webhooks are an optimization; this sweep is what makes
 * DB correctness independent of any single delivery:
 *   1) dead-letter retry        — re-dispatch webhook_events stuck in received/failed
 *   2) stuck-payment reconcile   — replay the true Stripe PI status for pending payments past SLA
 *   2b) unsettled-capture heal   — re-run settlement for captured charges whose funds never moved
 *   3) failed-payout retry       — re-run cleaner settlement for payouts left 'failed'
 *   3b) held-cleaner-slice retry — pay HELD cleaner slices (snapshot) once the cleaner onboards
 *   3c) stranded-clawback retry  — re-attempt cleaner clawbacks that failed (cleaner_clawback_failed)
 *   4) money-math invariant      — flag any paid cleaner payout that doesn't match the locked split
 *
 * Jobs run sequentially (so a dead-letter replay and a stuck-payment replay can't race on the
 * same row) and each swallows per-item errors. Safe to schedule on a heartbeat: with
 * STRIPE_ENABLED off it 404s and does nothing.
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe is not enabled' }, { status: 404 });
  }

  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || request.headers.get('Authorization') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const deadLetter = await retryDeadLetterWebhooks(supabaseAdmin);
    const stuckPayments = await reconcileStuckPayments(supabaseAdmin);
    const unsettledCaptures = await settleUnsettledCaptures(supabaseAdmin);
    const failedPayouts = await retryFailedPayouts(supabaseAdmin);
    const heldPayouts = await retryHeldCleanerPayouts(supabaseAdmin);
    const strandedClawbacks = await retryStrandedClawbacks(supabaseAdmin);
    const moneyMath = await checkMoneyMathInvariants(supabaseAdmin);

    return NextResponse.json({
      success: true,
      deadLetter,
      stuckPayments,
      unsettledCaptures,
      failedPayouts,
      heldPayouts,
      strandedClawbacks,
      moneyMath,
    });
  } catch (error) {
    console.error('reconcile-payments sweep failed:', error);
    return NextResponse.json(
      { error: 'Reconciliation sweep failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
