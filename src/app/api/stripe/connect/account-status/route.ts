import { NextRequest, NextResponse } from 'next/server';
import { getConnectAccountStatus } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAccessToken } from '@/lib/auth/verifyToken';
import { isStripeAccountId } from '@/lib/stripe/connect/accountSlot';

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

    const { data: cleaner, error: cleanerError } = await supabaseAdmin
      .from('cleaner_profiles')
      .select('stripe_connect_account_id, stripe_connect_onboarding_complete')
      .eq('id', cleaner_id)
      .single();

    if (cleanerError || !cleaner) {
      return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 });
    }

    // A `pending:` slot-claim token can be stored for the second or so between
    // /start claiming the slot and committing the real acct_ id. It is not a
    // Stripe account id; passing it to Stripe 500s the status poll that races
    // the commit. Treat any non-acct_ value as "no account yet".
    if (!isStripeAccountId(cleaner.stripe_connect_account_id)) {
      return NextResponse.json({
        success: true,
        has_account: false,
        onboarding_complete: false,
        payouts_enabled: false,
      });
    }

    const status = await getConnectAccountStatus(cleaner.stripe_connect_account_id);
    const onboardingComplete = status.detailsSubmitted && status.payoutsEnabled;

    if (onboardingComplete !== cleaner.stripe_connect_onboarding_complete) {
      await supabaseAdmin
        .from('cleaner_profiles')
        .update({ stripe_connect_onboarding_complete: onboardingComplete })
        .eq('id', cleaner_id);
    }

    return NextResponse.json({
      success: true,
      has_account: true,
      onboarding_complete: onboardingComplete,
      charges_enabled: status.chargesEnabled,
      payouts_enabled: status.payoutsEnabled,
      details_submitted: status.detailsSubmitted,
    });
  } catch (error) {
    console.error('Error checking Connect account status:', error);
    return NextResponse.json(
      { error: 'Failed to check account status', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
