import { NextRequest, NextResponse } from 'next/server';
import {
  createCleanerConnectAccount,
  createCleanerAccountSession,
} from '@/lib/stripe/connect/cleaner';
import { stripeEnabled } from '@/lib/stripe/flags';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/stripe/connect/cleaner/start
 *
 * Cleaner-self only. Ensures the cleaner has an Express connected account (creating
 * one on first call) and returns an Account Session client secret for EMBEDDED
 * onboarding — so the cleaner finishes payout setup without leaving the app.
 * Idempotent: re-calling reuses the existing account and just mints a fresh session.
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

    // A cleaner can only onboard their own payout account.
    if (authUser.id !== cleaner_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: cleaner, error: cleanerError } = await supabaseAdmin
      .from('cleaner_profiles')
      .select('id, stripe_connect_account_id')
      .eq('id', cleaner_id)
      .single();

    if (cleanerError || !cleaner) {
      return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 });
    }

    let accountId = cleaner.stripe_connect_account_id as string | null;

    if (!accountId) {
      const { data: userProfile } = await supabaseAdmin
        .from('user_profiles')
        .select('email, first_name, last_name')
        .eq('id', cleaner_id)
        .single();

      const email = userProfile?.email ?? '';
      const name =
        `${userProfile?.first_name ?? ''} ${userProfile?.last_name ?? ''}`.trim() || 'Cleaner';

      const account = await createCleanerConnectAccount(email, name);
      accountId = account.id;

      const { error: updateError } = await supabaseAdmin
        .from('cleaner_profiles')
        .update({ stripe_connect_account_id: accountId })
        .eq('id', cleaner_id);

      if (updateError) {
        console.error('Error saving cleaner stripe_connect_account_id:', updateError);
        return NextResponse.json(
          { error: 'Failed to persist connected account' },
          { status: 500 },
        );
      }
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
