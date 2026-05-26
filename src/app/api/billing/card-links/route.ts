import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { getOrCreateStripeCustomer } from '@/lib/stripe/customers/homeowner';
import { createCardSetupIntent } from '@/lib/stripe/setup-intents';
import { homeownerBelongsToOrg } from '@/lib/payments/orgHomeowner';

const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * POST /api/billing/card-links
 *
 * Org staff: create a single-use, 7-day hosted card-collection link for a homeowner.
 * Ensures the homeowner has a platform Customer + a fresh SetupIntent, then stores a
 * `homeowner_payment_links` row and returns the shareable URL. (SMS/email delivery is a
 * follow-up; for now the URL is returned for the admin to send.)
 *
 * Body: { organization_id, homeowner_id }
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { organization_id, homeowner_id } = body as { organization_id?: string; homeowner_id?: string };

    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    if (!homeowner_id) {
      return NextResponse.json({ error: 'homeowner_id is required' }, { status: 400 });
    }

    const belongs = await homeownerBelongsToOrg(supabaseAdmin, homeowner_id, organization_id!);
    if (!belongs) {
      return NextResponse.json({ error: 'Homeowner not found' }, { status: 404 });
    }

    const { data: ho } = await supabaseAdmin
      .from('user_profiles')
      .select('email, first_name, last_name, stripe_customer_id')
      .eq('id', homeowner_id)
      .maybeSingle();
    if (!ho) {
      return NextResponse.json({ error: 'Homeowner not found' }, { status: 404 });
    }
    const profile = ho as {
      email: string;
      first_name: string | null;
      last_name: string | null;
      stripe_customer_id: string | null;
    };

    const name = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Customer';
    const customer = await getOrCreateStripeCustomer(profile.email, name, profile.stripe_customer_id);
    if (customer.id !== profile.stripe_customer_id) {
      await supabaseAdmin.from('user_profiles').update({ stripe_customer_id: customer.id }).eq('id', homeowner_id);
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();
    const setupIntent = await createCardSetupIntent(customer.id, {
      token,
      organization_id: organization_id!,
      homeowner_id,
    });

    const { error: insertError } = await supabaseAdmin.from('homeowner_payment_links').insert({
      homeowner_id,
      organization_id,
      token,
      setup_intent_id: setupIntent.id,
      status: 'pending',
      created_by: auth.userId,
      expires_at: expiresAt,
    });
    if (insertError) {
      console.error('Error inserting homeowner_payment_links row:', insertError);
      return NextResponse.json({ error: 'Failed to create card link' }, { status: 500 });
    }

    const url = `${request.nextUrl.origin}/billing/add-card?t=${token}`;
    return NextResponse.json({ success: true, token, url, expires_at: expiresAt });
  } catch (error) {
    console.error('Error creating card link:', error);
    return NextResponse.json(
      { error: 'Failed to create card link', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
