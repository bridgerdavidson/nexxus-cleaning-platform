import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import { stripeEnabled } from '@/lib/stripe/flags';

/**
 * POST /api/platform/cleaners/:id/connect/reset
 *
 * Platform-admin only. Recovery action for a cleaner whose Stripe Connect state
 * is stuck (e.g. the prod incident where the cleaner is looped on Stripe's
 * "Select an account for payouts" screen because a partial bank-attach left
 * Stripe's account in a state that won't progress). Mirrors the tenant reset
 * at /api/platform/organizations/:id/connect/reset.
 *
 * Steps:
 *   1) Snapshot the currently-stored stripe_connect_account_id + attempt counter.
 *   2) Count in-flight payouts (status IN ('pending','approved')). If any exist
 *      and force !== true, return 409 — resetting would orphan those payouts
 *      from the deleted Stripe account. The UI re-posts with force:true after
 *      a second confirmation.
 *   3) Best-effort stripe.accounts.del(stored). Failure is non-fatal — the
 *      local clear must succeed regardless. Common failure: account has a
 *      non-zero balance (operator must finish manually in Stripe).
 *   4) NULL stripe_connect_account_id + stripe_connect_onboarding_complete on
 *      cleaner_profiles (the only Stripe-Connect-related columns the table
 *      actually has — see migration 000_baseline.sql; capability flags like
 *      *_enabled / requirements_due / onboarded_at live on `organizations`,
 *      NOT on `cleaner_profiles`). Bump stripe_connect_attempt_number so the
 *      next /api/stripe/connect/cleaner/start uses a fresh Stripe idempotency
 *      key (Stripe's 24h dedup cache can't replay the just-deleted account).
 *   5) Resolve any open connect_account_drift_events for this cleaner.
 *   6) Insert a platform_audit_log row tagged 'reset_cleaner_connect'.
 *
 * Body: { confirm: true, force?: boolean }
 * Returns 200: { success, before_account_id, stripe_delete_status,
 *                stripe_delete_error?, payout_count }
 * Returns 409 (in-flight payouts, force omitted):
 *                { error: 'in_flight_payouts', payout_count, before_account_id }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (!auth.ok) return auth.response;

  const { id: cleanerId } = await params;

  const body = (await request.json().catch(() => ({}))) as {
    confirm?: unknown;
    force?: unknown;
  };
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'Missing confirm: true' }, { status: 400 });
  }
  const force = body.force === true;

  // cleaner_profiles.id IS the user's auth.users.id (per CLAUDE.md domain notes).
  const { data: cleaner, error: cleanerErr } = await supabaseAdmin
    .from('cleaner_profiles')
    .select(
      'id, organization_id, stripe_connect_account_id, stripe_connect_attempt_number',
    )
    .eq('id', cleanerId)
    .maybeSingle();
  if (cleanerErr) {
    return NextResponse.json(
      { error: 'Failed to load cleaner', details: cleanerErr.message },
      { status: 500 },
    );
  }
  if (!cleaner) {
    return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 });
  }
  const row = cleaner as {
    id: string;
    organization_id: string | null;
    stripe_connect_account_id: string | null;
    stripe_connect_attempt_number: number | null;
  };
  const before = row.stripe_connect_account_id;
  const previousAttempt = row.stripe_connect_attempt_number ?? 0;

  // In-flight payout guard. Resetting (and best-effort-deleting the Stripe
  // account) orphans any payout whose transfer hasn't fully landed yet:
  //   - 'pending' / 'approved'        — transfer not even created yet
  //   - 'paid'                        — Stripe transfer succeeded but the
  //                                     bank payout from the connected account
  //                                     hasn't arrived; handlePayoutPaid in
  //                                     dispatchStripeEvent looks up the cleaner
  //                                     by stripe_connect_account_id, which we
  //                                     null below — without this guard the
  //                                     later payout.paid webhook can't find
  //                                     the cleaner and the row stays at
  //                                     'paid' until manual reconcile.
  //   - 'failed'                      — a create may have LANDED at Stripe with
  //                                     the response lost (row has no transfer
  //                                     id); settlement's adopt-existing scan
  //                                     matches by the CURRENT account id, so
  //                                     re-provisioning the account here would
  //                                     defeat adoption and let a rotated
  //                                     retry (T1-11) pay the cut twice.
  // Block unless the caller explicitly accepts the risk via force:true.
  const { count: inFlightPayoutCount, error: payoutErr } = await supabaseAdmin
    .from('payouts')
    .select('id', { count: 'exact', head: true })
    .eq('cleaner_id', cleanerId)
    .in('status', ['pending', 'approved', 'paid', 'failed']);
  if (payoutErr) {
    return NextResponse.json(
      { error: 'Failed to check in-flight payouts', details: payoutErr.message },
      { status: 500 },
    );
  }
  const payoutCount = inFlightPayoutCount ?? 0;
  if (payoutCount > 0 && !force) {
    return NextResponse.json(
      {
        error: 'in_flight_payouts',
        payout_count: payoutCount,
        before_account_id: before,
      },
      { status: 409 },
    );
  }

  // Best-effort Stripe-side delete. Skip if no stored ID, if Stripe is disabled,
  // or if the stored value is still a `pending:` placeholder (no real account
  // exists upstream).
  let stripeStatus: 'skipped' | 'deleted' | 'error' = 'skipped';
  let stripeError: string | null = null;
  if (before && before.startsWith('acct_') && stripeEnabled()) {
    try {
      const { getStripe } = await import('@/lib/stripe');
      const stripe = getStripe();
      await stripe.accounts.del(before);
      stripeStatus = 'deleted';
    } catch (e) {
      stripeStatus = 'error';
      stripeError = e instanceof Error ? e.message : String(e);
      console.error('[cleaner-connect-reset] stripe.accounts.del failed:', stripeError);
    }
  }

  // Clear local state regardless of Stripe outcome — operator can finish the
  // Stripe-side delete manually if needed; what matters is that the cleaner
  // can start over. Bump the attempt counter so the next /start uses a fresh
  // Stripe idempotency key.
  const nextAttempt = previousAttempt + 1;
  const { error: clearErr } = await supabaseAdmin
    .from('cleaner_profiles')
    .update({
      stripe_connect_account_id: null,
      stripe_connect_onboarding_complete: false,
      stripe_connect_attempt_number: nextAttempt,
    })
    .eq('id', cleanerId);
  if (clearErr) {
    return NextResponse.json(
      { error: 'Failed to clear Connect state', details: clearErr.message },
      { status: 500 },
    );
  }

  // Resolve open drift events for this cleaner so any embedded UI banner
  // clears on next mount.
  const { error: driftErr } = await supabaseAdmin
    .from('connect_account_drift_events')
    .update({ resolved_at: new Date().toISOString() })
    .eq('cleaner_id', cleanerId)
    .is('resolved_at', null);
  if (driftErr) {
    console.error('[cleaner-connect-reset] failed to resolve drift events:', driftErr.message);
  }

  // platform_audit_log has target_org_id but no target_cleaner_id column;
  // attribute the action to the cleaner's primary org and carry the
  // cleaner_id in metadata. Mirrors how other platform actions on
  // org-scoped child rows attribute themselves.
  const auditMetadata = {
    cleaner_id: cleanerId,
    organization_id: row.organization_id,
    before_account_id: before,
    stripe_delete_status: stripeStatus,
    stripe_delete_error: stripeError,
    previous_attempt_number: previousAttempt,
    new_attempt_number: nextAttempt,
    in_flight_payout_count: payoutCount,
    force,
  };
  const { error: auditErr } = await supabaseAdmin.from('platform_audit_log').insert({
    actor_user_id: auth.userId,
    action: 'reset_cleaner_connect',
    target_org_id: row.organization_id,
    metadata: auditMetadata,
  });
  if (auditErr) {
    console.error('[cleaner-connect-reset] audit insert failed:', auditErr.message);
  }

  return NextResponse.json({
    success: true,
    before_account_id: before,
    stripe_delete_status: stripeStatus,
    stripe_delete_error: stripeError,
    payout_count: payoutCount,
  });
}
