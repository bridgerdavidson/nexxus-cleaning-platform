import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import {
  createCleanerConnectAccount,
  createCleanerAccountSession,
} from '@/lib/stripe/connect/cleaner';
import { getStripe } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  claimConnectAccountSlot,
  commitConnectAccountSlot,
  releaseConnectAccountSlot,
  isPendingToken,
  isStripeAccountId,
  type ConnectSlotSubject,
} from '@/lib/stripe/connect/accountSlot';

/**
 * POST /api/stripe/connect/cleaner/start
 *
 * Cleaner-self only. Ensures the cleaner has an Express connected account
 * (creating one on first call) and returns an Account Session client secret
 * for embedded onboarding.
 *
 * Race-safety (incident 2026-05-28, shared shape with tenant /start):
 *   • DB-side claim/commit slot via migration-072 RPCs.
 *   • Stripe-side idempotency key `cleaner-connect-${cleaner_id}-${env}`.
 *
 * Body: { cleaner_id: string }
 * Returns: { success, account_id, client_secret }
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe disabled' }, { status: 404 });
  }

  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const {
      data: { user: authUser },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUser) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const { cleaner_id } = await request.json().catch(() => ({}));
    if (!cleaner_id) {
      return NextResponse.json({ error: 'Missing required field: cleaner_id' }, { status: 400 });
    }

    if (authUser.id !== cleaner_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const subject: ConnectSlotSubject = { kind: 'cleaner', id: cleaner_id };

    let claim;
    try {
      claim = await claimConnectAccountSlot(supabaseAdmin, subject);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) {
        return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 });
      }
      throw err;
    }

    let accountId: string;

    if (isStripeAccountId(claim.accountId)) {
      accountId = claim.accountId;
    } else if (claim.claimed && claim.pendingToken) {
      accountId = await createAndCommit(subject, claim.pendingToken, authUser.email ?? null);
    } else if (isPendingToken(claim.accountId) && !claim.claimed) {
      const resolved = await waitForCommit(cleaner_id);
      if (!resolved) {
        return NextResponse.json(
          { error: 'Stripe Connect onboarding is in progress — please retry in a moment' },
          { status: 409 },
        );
      }
      accountId = resolved;
    } else {
      console.error('Unexpected claimConnectAccountSlot result (cleaner):', claim);
      return NextResponse.json({ error: 'Unexpected Connect slot state' }, { status: 500 });
    }

    const session = await createCleanerAccountSession(accountId);

    return NextResponse.json({
      success: true,
      account_id: accountId,
      client_secret: session.client_secret,
    });
  } catch (error) {
    console.error('Error starting cleaner Connect onboarding:', error);
    return NextResponse.json(
      {
        error: 'Failed to start onboarding',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

async function createAndCommit(
  subject: ConnectSlotSubject,
  pendingToken: string,
  authEmail: string | null,
): Promise<string> {
  const { data: userProfile } = await supabaseAdmin
    .from('user_profiles')
    .select('email, first_name, last_name')
    .eq('id', subject.id)
    .maybeSingle();

  const email = (userProfile?.email as string | null) || authEmail || '';
  const name =
    `${(userProfile?.first_name as string | null) ?? ''} ${(userProfile?.last_name as string | null) ?? ''}`.trim() ||
    'Cleaner';
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'unknown';

  let account: Stripe.Account;
  try {
    account = await createCleanerConnectAccount(email, name, {
      idempotencyKey: `cleaner-connect-${subject.id}-${env}`,
    });
  } catch (err) {
    await releaseConnectAccountSlot(supabaseAdmin, subject, pendingToken).catch((e) =>
      console.error('Failed to release cleaner Connect slot after Stripe error:', e),
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

  const { data: reread } = await supabaseAdmin
    .from('cleaner_profiles')
    .select('stripe_connect_account_id')
    .eq('id', subject.id)
    .maybeSingle();
  const stored = (reread?.stripe_connect_account_id as string | null) ?? null;

  if (stored && isStripeAccountId(stored) && stored !== account.id) {
    try {
      await getStripe().accounts.del(account.id);
    } catch (delErr) {
      console.error('Failed to delete orphan Stripe account', account.id, delErr);
    }
    return stored;
  }
  return account.id;
}

async function waitForCommit(cleanerId: string): Promise<string | null> {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const { data } = await supabaseAdmin
      .from('cleaner_profiles')
      .select('stripe_connect_account_id')
      .eq('id', cleanerId)
      .maybeSingle();
    const stored = (data?.stripe_connect_account_id as string | null) ?? null;
    if (stored && isStripeAccountId(stored)) return stored;
    if (stored === null) return null;
  }
  return null;
}
