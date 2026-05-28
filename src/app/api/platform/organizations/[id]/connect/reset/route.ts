import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import { stripeEnabled } from '@/lib/stripe/flags';

/**
 * POST /api/platform/organizations/:id/connect/reset
 *
 * Platform-admin only. Recovery action for an org whose Stripe Connect state is
 * stuck (e.g. drift detected — the "use existing Stripe account" path from the
 * 2026-05-28 incident, or a tenant whose onboarding never completed).
 *
 * Steps:
 *   1) Snapshot the currently-stored stripe_connect_account_id.
 *   2) Best-effort stripe.accounts.del(stored). Failure is non-fatal —
 *      the local clear must succeed regardless. Common failure: account has
 *      a non-zero balance or undisputed charges (operator must finish manually).
 *   3) NULL the four stripe_connect_* columns on the org row so the next
 *      tenant /start call creates a fresh account.
 *   4) Mark any open connect_account_drift_events for this org resolved.
 *   5) Insert a platform_audit_log row tagged 'reset_tenant_connect'.
 *
 * Does NOT touch observed drift accounts (the *other* account in a drift case)
 * — those are managed via the Stripe Dashboard or one-off cleanup scripts.
 *
 * Body: { confirm: true }
 * Returns: { success, stripe_delete_status, before_account_id }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePlatformAdmin(request, supabaseAdmin);
  if (!auth.ok) return auth.response;

  const { id: orgId } = await params;

  const body = await request.json().catch(() => ({}));
  if (!body || (body as { confirm?: unknown }).confirm !== true) {
    return NextResponse.json({ error: 'Missing confirm: true' }, { status: 400 });
  }

  const { data: org, error: orgErr } = await supabaseAdmin
    .from('organizations')
    .select('id, name, stripe_connect_account_id, stripe_connect_attempt_number')
    .eq('id', orgId)
    .maybeSingle();
  if (orgErr) {
    return NextResponse.json(
      { error: 'Failed to load organization', details: orgErr.message },
      { status: 500 },
    );
  }
  if (!org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
  }
  const orgRow = org as {
    id: string;
    name: string;
    stripe_connect_account_id: string | null;
    stripe_connect_attempt_number: number | null;
  };
  const before = orgRow.stripe_connect_account_id;
  const previousAttempt = orgRow.stripe_connect_attempt_number ?? 0;

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
      console.error('[connect-reset] stripe.accounts.del failed:', stripeError);
    }
  }

  // Clear local state regardless of Stripe outcome — operator can finish the
  // Stripe-side delete manually if needed; what matters is that the tenant can
  // start over. Bump the attempt counter so the next /start uses a fresh Stripe
  // idempotency key and Stripe's 24h dedup cache can't replay the just-deleted
  // account.
  const nextAttempt = previousAttempt + 1;
  const { error: clearErr } = await supabaseAdmin
    .from('organizations')
    .update({
      stripe_connect_account_id: null,
      stripe_connect_charges_enabled: false,
      stripe_connect_payouts_enabled: false,
      stripe_connect_details_submitted: false,
      stripe_connect_requirements_due: [],
      stripe_connect_onboarded_at: null,
      stripe_connect_attempt_number: nextAttempt,
    })
    .eq('id', orgId);
  if (clearErr) {
    return NextResponse.json(
      { error: 'Failed to clear Connect state', details: clearErr.message },
      { status: 500 },
    );
  }

  // Resolve open drift events so the embedded UI banner clears on next mount.
  const { error: driftErr } = await supabaseAdmin
    .from('connect_account_drift_events')
    .update({ resolved_at: new Date().toISOString() })
    .eq('organization_id', orgId)
    .is('resolved_at', null);
  if (driftErr) {
    console.error('[connect-reset] failed to resolve drift events:', driftErr.message);
  }

  const auditMetadata = {
    org_id: orgId,
    org_name: orgRow.name,
    before_account_id: before,
    stripe_delete_status: stripeStatus,
    stripe_delete_error: stripeError,
    previous_attempt_number: previousAttempt,
    new_attempt_number: nextAttempt,
  };
  const { error: auditErr } = await supabaseAdmin.from('platform_audit_log').insert({
    actor_user_id: auth.userId,
    action: 'reset_tenant_connect',
    target_org_id: orgId,
    metadata: auditMetadata,
  });
  if (auditErr) {
    console.error('[connect-reset] audit insert failed:', auditErr.message);
  }

  return NextResponse.json({
    success: true,
    before_account_id: before,
    stripe_delete_status: stripeStatus,
    stripe_delete_error: stripeError,
  });
}
