import { NextRequest, NextResponse } from 'next/server';
import { createExpressDashboardLoginLink } from '@/lib/stripe';
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
      .select('stripe_connect_account_id')
      .eq('id', cleaner_id)
      .single();

    if (cleanerError || !cleaner) {
      return NextResponse.json({ error: 'Cleaner not found' }, { status: 404 });
    }

    if (!cleaner.stripe_connect_account_id) {
      return NextResponse.json({ error: 'No Stripe Connect account found. Create one first.' }, { status: 400 });
    }

    const loginLink = await createExpressDashboardLoginLink(
      cleaner.stripe_connect_account_id
    );

    return NextResponse.json({ success: true, url: loginLink.url });
  } catch (error) {
    console.error('Error creating login link:', error);
    return NextResponse.json(
      { error: 'Failed to create Stripe dashboard link', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
