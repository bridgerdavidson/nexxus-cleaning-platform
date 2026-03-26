import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAccountOnboardingLink } from '@/lib/stripe';
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
      .select('stripe_connect_account_id')
      .eq('id', cleaner_id)
      .single();

    if (cleanerError || !cleaner) {
      return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 });
    }

    if (!cleaner.stripe_connect_account_id) {
      return NextResponse.json({ error: 'No Stripe Connect account found. Create one first.' }, { status: 400 });
    }

    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const returnUrl = `${origin}/cleaner-dashboard?stripe_return=true`;
    const refreshUrl = `${origin}/cleaner-dashboard?stripe_refresh=true`;

    const link = await createAccountOnboardingLink(
      cleaner.stripe_connect_account_id,
      returnUrl,
      refreshUrl
    );

    return NextResponse.json({ success: true, url: link.url });
  } catch (error) {
    console.error('Error creating onboarding link:', error);
    return NextResponse.json(
      { error: 'Failed to create onboarding link', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
