import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAccessToken } from '@/lib/auth/verifyToken';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import {
  getOrCreateStripeCustomer,
  createHomeownerCustomerSession,
} from '@/lib/stripe/customers/homeowner';

/**
 * POST /api/stripe/customer-session
 *
 * Creates a CustomerSession for the AUTHENTICATED caller's own platform Customer,
 * powering the homeowner-facing Payment Element (self-request booking + dashboard
 * card management). A caller can only ever get a session for their own Customer —
 * the customer id is derived from the verified bearer token, never the request body.
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }

  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const verified = await verifyAccessToken(supabaseAdmin, token);
    if (!verified) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const { data: profileRow } = await supabaseAdmin
      .from('user_profiles')
      .select('email, first_name, last_name, stripe_customer_id')
      .eq('id', verified.userId)
      .maybeSingle();
    if (!profileRow) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    const profile = profileRow as {
      email: string;
      first_name: string | null;
      last_name: string | null;
      stripe_customer_id: string | null;
    };

    const name = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Customer';
    const customer = await getOrCreateStripeCustomer(profile.email, name, profile.stripe_customer_id);
    if (customer.id !== profile.stripe_customer_id) {
      await supabaseAdmin.from('user_profiles').update({ stripe_customer_id: customer.id }).eq('id', verified.userId);
    }

    const session = await createHomeownerCustomerSession(customer.id);

    return NextResponse.json({
      success: true,
      customer_session_client_secret: session.client_secret,
      customer_id: customer.id,
    });
  } catch (error) {
    console.error('Error creating customer session:', error);
    return NextResponse.json(
      { error: 'Failed to create customer session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
