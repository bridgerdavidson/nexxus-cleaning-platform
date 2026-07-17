import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { stripeEnabled } from '@/lib/stripe/flags';
import {
  retryDeadLetterWebhooks,
  reconcileStuckPayments,
  recoverStuckCharging,
  chargeUncollectedCompletions,
  settleUnsettledCaptures,
  retryFailedPayouts,
  retryStrandedClawbacks,
  checkMoneyMathInvariants,
} from '@/lib/payments/reconcile';
import { raiseReconcileSweepAlerts } from '@/lib/payments/reconcileAlerts';
import { recordPlatformAlert } from '@/lib/monitoring/platformAlert';

// Needs the service-role admin client; nothing edge-specific here.
export const runtime = 'nodejs';

/**
 * POST /api/cron/reconcile-payments  (CRON_SECRET-guarded; pg_cron calls it — migration 067)
 *
 * The reliability backstop (Phase 4d). Webhooks are an optimization; this sweep is what makes
 * DB correctness independent of any single delivery:
 *   1) dead-letter retry        — re-dispatch webhook_events stuck in received/failed
 *   2) stuck-payment reconcile   — replay the true Stripe PI status for pending payments past SLA
 *   2a-pre) stuck-charging heal  : release appointments orphaned in the transient 'charging' claim
 *   2a) uncollected completions  — charge completed jobs whose completion charge never ran
 *   2b) unsettled-capture heal   — re-run settlement for captured charges whose funds never moved
 *   3) failed-payout retry       — re-run cleaner settlement for payouts left 'failed'
 *   3b) stranded-clawback retry  — re-attempt cleaner clawbacks that failed (cleaner_clawback_failed)
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

  // Fail closed and stay robust to refactors: a missing secret is a 500 (misconfig),
  // and the comparison is direct rather than through a nullable sentinel that a later
  // edit could accidentally turn fail-open.
  if (!process.env.CRON_SECRET) {
    console.error('CRON_SECRET is not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const deadLetter = await retryDeadLetterWebhooks(supabaseAdmin);
    const stuckPayments = await reconcileStuckPayments(supabaseAdmin);
    // Release orphaned 'charging' claims BEFORE the uncollected sweep so the freed rows are back on
    // the normal NULL recovery path (the reset bumps updated_at, so they clear on a later cycle).
    const stuckCharging = await recoverStuckCharging(supabaseAdmin);
    const uncollectedCompletions = await chargeUncollectedCompletions(supabaseAdmin);
    const unsettledCaptures = await settleUnsettledCaptures(supabaseAdmin);
    const failedPayouts = await retryFailedPayouts(supabaseAdmin);
    const strandedClawbacks = await retryStrandedClawbacks(supabaseAdmin);
    const moneyMath = await checkMoneyMathInvariants(supabaseAdmin);

    // T1-8: pg_cron discards this response, so the sweep alerts on its own results
    // (a dead-letter queue that won't drain). Money-math violations + failed
    // transfers/clawbacks already alert per-incident via recordPaymentEvent.
    await raiseReconcileSweepAlerts(supabaseAdmin, { deadLetter });

    return NextResponse.json({
      success: true,
      deadLetter,
      stuckPayments,
      stuckCharging,
      uncollectedCompletions,
      unsettledCaptures,
      failedPayouts,
      strandedClawbacks,
      moneyMath,
    });
  } catch (error) {
    console.error('reconcile-payments sweep failed:', error);
    // The reliability backstop itself broke — no payment_event captures this, so alert
    // directly. Best-effort: recordPlatformAlert never throws.
    await recordPlatformAlert(supabaseAdmin, {
      alert_type: 'reconcile_sweep_failed',
      severity: 'critical',
      summary: 'The payments reconciliation sweep threw and did not complete',
      details: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json(
      { error: 'Reconciliation sweep failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
