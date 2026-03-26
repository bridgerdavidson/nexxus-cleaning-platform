import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getConnectAccountStatus } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe disabled' }, { status: 404 });
  }

  try {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { cleaner_id } = await request.json();

    if (!cleaner_id) {
      return NextResponse.json({ error: 'Missing required field: cleaner_id' }, { status: 400 });
    }

    const { data: cleaner, error: cleanerError } = await supabaseAdmin
      .from('cleaner_profiles')
      .select('stripe_connect_account_id, stripe_connect_onboarding_complete')
      .eq('id', cleaner_id)
      .single();

    if (cleanerError || !cleaner) {
      return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 });
    }

    if (!cleaner.stripe_connect_account_id) {
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
