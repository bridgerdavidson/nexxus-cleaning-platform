import { NextRequest, NextResponse } from 'next/server';
import { createConnectAccount } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAccessToken } from '@/lib/auth/verifyToken';

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
      .select('id, stripe_connect_account_id')
      .eq('id', cleaner_id)
      .single();

    if (cleanerError || !cleaner) {
      return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 });
    }

    if (cleaner.stripe_connect_account_id) {
      return NextResponse.json({
        success: true,
        account_id: cleaner.stripe_connect_account_id,
        already_exists: true,
      });
    }

    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('email, first_name, last_name')
      .eq('id', cleaner_id)
      .single();

    const email = userProfile?.email ?? '';
    const name = `${userProfile?.first_name ?? ''} ${userProfile?.last_name ?? ''}`.trim() || 'Cleaner';

    const account = await createConnectAccount(email, name);

    const { error: updateError } = await supabaseAdmin
      .from('cleaner_profiles')
      .update({ stripe_connect_account_id: account.id })
      .eq('id', cleaner_id);

    if (updateError) {
      console.error('Error saving stripe_connect_account_id:', updateError);
    }

    return NextResponse.json({ success: true, account_id: account.id });
  } catch (error) {
    console.error('Error creating Connect account:', error);
    return NextResponse.json(
      { error: 'Failed to create Connect account', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
