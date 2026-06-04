import { NextRequest, NextResponse } from 'next/server';
import { getConnectedAccountBalance, getLatestConnectedAccountPayout } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAccessToken } from '@/lib/auth/verifyToken';

/**
 * Returns live Stripe balance + latest bank payout for a cleaner's connected
 * account.  Used by the cleaner dashboard summary cards so the "In Stripe"
 * and "Last Bank Payout" values are always fresh from Stripe rather than
 * depending on DB sync.
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

    const verified = await verifyAccessToken(supabaseAdmin, token);
    if (!verified) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const { cleaner_id } = await request.json();
    if (!cleaner_id) {
      return NextResponse.json({ error: 'Missing required field: cleaner_id' }, { status: 400 });
    }
    if (verified.userId !== cleaner_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: cleanerProfile, error: profileError } = await supabaseAdmin
      .from('cleaner_profiles')
      .select('stripe_connect_account_id, stripe_connect_onboarding_complete')
      .eq('id', cleaner_id)
      .single();

    if (profileError || !cleanerProfile) {
      return NextResponse.json({ error: 'Cleaner profile not found' }, { status: 404 });
    }

    if (!cleanerProfile.stripe_connect_account_id || !cleanerProfile.stripe_connect_onboarding_complete) {
      return NextResponse.json({
        success: true,
        connected: false,
        availableBalance: 0,
        pendingBalance: 0,
        latestPayout: null,
      });
    }

    const connectedAccountId = cleanerProfile.stripe_connect_account_id;

    const [balance, latestPayout] = await Promise.all([
      getConnectedAccountBalance(connectedAccountId),
      getLatestConnectedAccountPayout(connectedAccountId),
    ]);

    return NextResponse.json({
      success: true,
      connected: true,
      availableBalance: balance.available / 100,
      pendingBalance: balance.pending / 100,
      latestPayout: latestPayout
        ? {
            amount: latestPayout.amount / 100,
            date: latestPayout.arrivalDate,
          }
        : null,
    });
  } catch (error) {
    console.error('Error fetching balance summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch balance summary', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
