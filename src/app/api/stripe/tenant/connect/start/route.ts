import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth, type OrgRole } from '@/lib/auth/requireOrgAuth';
import { getStripe } from '@/lib/stripe';
import { stripeEnabled, stripeTenantConnectEnabled } from '@/lib/stripe/flags';
import {
  createTenantConnectAccount,
  createTenantAccountSession,
} from '@/lib/stripe/connect/tenant';
import {
  claimConnectAccountSlot,
  commitConnectAccountSlot,
  releaseConnectAccountSlot,
  isPendingToken,
  isStripeAccountId,
  type ConnectSlotSubject,
} from '@/lib/stripe/connect/accountSlot';

/**
 * POST /api/stripe/tenant/connect/start
 *
 * Owner/admin. Ensures the organization has an Express connected account
 * (creating one on first call) and returns an Account Session client secret
 * for embedded onboarding. Idempotent: re-calling reuses the existing account.
 *
 * Race-safety (incident 2026-05-28):
 *   • DB-side claim/commit slot via migration-072 RPCs — concurrent /start
 *     callers see a `pending:<uuid>` placeholder and back off instead of both
 *     calling stripe.accounts.create().
 *   • Stripe-side idempotency key `tenant-connect-${org_id}-${env}` so any
 *     retry within Stripe's 24h dedup window returns the same account.
 *
 * Body: { organization_id: string }
 * Returns: { success, account_id, client_secret }
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled() || !stripeTenantConnectEnabled()) {
    return NextResponse.json({ error: 'Tenant Connect is not enabled' }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { organization_id } = body as { organization_id?: string };

    // Only the org OWNER runs Stripe setup (creating the merchant-of-record
    // account + onboarding + bank-account connection). Non-owner admins and
    // managers-with-can_manage_payments get a read-only "viewer" session so they
    // can see the org's balance / payouts / payments without touching setup or
    // needing their own Stripe login.
    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    const scope = await resolveSessionScope(auth, organization_id as string);
    if (!scope) {
      return NextResponse.json({ error: 'Insufficient role for this action' }, { status: 403 });
    }

    // Viewers never create or onboard — they only read an already-connected
    // account. If the owner hasn't connected the business yet there's nothing to
    // show; tell the client so it can render a "being set up" state instead.
    if (scope === 'viewer') {
      const { data: org } = await supabaseAdmin
        .from('organizations')
        .select('stripe_connect_account_id')
        .eq('id', organization_id as string)
        .maybeSingle();
      const stored = (org?.stripe_connect_account_id as string | null) ?? null;
      if (!stored || !isStripeAccountId(stored)) {
        return NextResponse.json({ success: true, not_connected: true });
      }
      const session = await createTenantAccountSession(stored, 'viewer');
      return NextResponse.json({
        success: true,
        account_id: stored,
        client_secret: session.client_secret,
      });
    }

    // Owner path: ensure the account exists (create on first call), then a full
    // setup-capable session.
    const subject: ConnectSlotSubject = { kind: 'org', id: organization_id as string };

    // 1) Atomically claim the slot. Returns either an existing acct_*, a
    //    pending:<uuid> we just placed, or a pending:<uuid> someone else holds.
    let claim;
    try {
      claim = await claimConnectAccountSlot(supabaseAdmin, subject);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
      }
      throw err;
    }

    let accountId: string;

    if (isStripeAccountId(claim.accountId)) {
      // Slot already filled with a real account — reuse it.
      accountId = claim.accountId;
    } else if (claim.claimed && claim.pendingToken) {
      // We hold the slot. Create the Stripe account and commit.
      accountId = await createAndCommit(subject, claim.pendingToken, auth.email);
    } else if (isPendingToken(claim.accountId) && !claim.claimed) {
      // Another in-flight request holds the slot. Poll briefly for the commit.
      const resolved = await waitForCommit(organization_id as string);
      if (!resolved) {
        return NextResponse.json(
          { error: 'Stripe Connect onboarding is in progress, please retry in a moment' },
          { status: 409 },
        );
      }
      accountId = resolved;
    } else {
      // Defensive — claim returned no token.
      console.error('Unexpected claimConnectAccountSlot result:', claim);
      return NextResponse.json({ error: 'Unexpected Connect slot state' }, { status: 500 });
    }

    const session = await createTenantAccountSession(accountId, 'owner');

    return NextResponse.json({
      success: true,
      account_id: accountId,
      client_secret: session.client_secret,
    });
  } catch (error) {
    console.error('Error starting tenant Connect onboarding:', error);
    return NextResponse.json(
      {
        error: 'Failed to start onboarding',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

/**
 * Maps the authenticated caller to an Account Session scope, or null if they may
 * not view tenant financials at all.
 *  - owner   → 'owner'  (full setup)
 *  - admin   → 'viewer' (read-only; non-owner admins never run setup)
 *  - manager → 'viewer' only if manager_permissions.can_manage_payments is set
 */
async function resolveSessionScope(
  auth: { role: OrgRole; userId: string },
  organizationId: string,
): Promise<'owner' | 'viewer' | null> {
  if (auth.role === 'owner') return 'owner';
  if (auth.role === 'admin') return 'viewer';
  if (auth.role === 'manager') {
    const { data: perm } = await supabaseAdmin
      .from('manager_permissions')
      .select('can_manage_payments')
      .eq('manager_id', auth.userId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    return (perm as { can_manage_payments?: boolean } | null)?.can_manage_payments
      ? 'viewer'
      : null;
  }
  return null;
}

/**
 * Reads org info, calls stripe.accounts.create with an idempotency key, commits
 * the slot. On Stripe error, releases the slot so retries can succeed. On a
 * lost-commit race (theoretically impossible after a successful claim, but
 * defended against), deletes the orphan we just created and returns the winner.
 */
async function createAndCommit(
  subject: ConnectSlotSubject,
  pendingToken: string,
  authEmail: string | null,
): Promise<string> {
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, name, billing_email, stripe_connect_attempt_number')
    .eq('id', subject.id)
    .maybeSingle();

  if (!org) {
    await releaseConnectAccountSlot(supabaseAdmin, subject, pendingToken).catch(() => {});
    throw new Error('Organization disappeared between claim and account create');
  }

  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown';
  const email = ((org as { billing_email: string | null }).billing_email) || authEmail || '';
  const orgName = (org as { name: string }).name;
  // Bumped by /api/platform/organizations/[id]/connect/reset so a retry within
  // Stripe's 24h idempotency window doesn't replay the cached create response
  // for the just-deleted account. Defaults to 0 for first-ever onboarding.
  const attemptNumber =
    ((org as { stripe_connect_attempt_number: number | null }).stripe_connect_attempt_number) ?? 0;

  let account: Stripe.Account;
  try {
    account = await createTenantConnectAccount(subject.id, email, orgName, {
      idempotencyKey: `tenant-connect-${subject.id}-${env}-${attemptNumber}`,
    });
  } catch (err) {
    await releaseConnectAccountSlot(supabaseAdmin, subject, pendingToken).catch((e) =>
      console.error('Failed to release tenant Connect slot after Stripe error:', e),
    );
    throw err;
  }

  const committed = await commitConnectAccountSlot(
    supabaseAdmin,
    subject,
    pendingToken,
    account.id,
  );

  if (committed) return account.id;

  // Defensive: re-read and resolve the conflict.
  const { data: reread } = await supabaseAdmin
    .from('organizations')
    .select('stripe_connect_account_id')
    .eq('id', subject.id)
    .maybeSingle();
  const stored = (reread?.stripe_connect_account_id as string | null) ?? null;

  if (stored && isStripeAccountId(stored) && stored !== account.id) {
    // Different account won — delete the orphan we just created.
    try {
      await getStripe().accounts.del(account.id);
    } catch (delErr) {
      console.error('Failed to delete orphan Stripe account', account.id, delErr);
    }
    return stored;
  }
  return account.id;
}

/** Polls for the other in-flight request to commit a real acct_*. ~1s max. */
async function waitForCommit(organizationId: string): Promise<string | null> {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const { data } = await supabaseAdmin
      .from('organizations')
      .select('stripe_connect_account_id')
      .eq('id', organizationId)
      .maybeSingle();
    const stored = (data?.stripe_connect_account_id as string | null) ?? null;
    if (stored && isStripeAccountId(stored)) return stored;
    if (stored === null) return null; // other request released — caller should retry
  }
  return null;
}
