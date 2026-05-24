import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { retrieveSetupIntent } from '@/lib/stripe/setup-intents';

/**
 * GET /api/billing/card-links/:token
 *
 * Public, token-scoped (the unguessable token is the auth). Returns the SetupIntent
 * client secret + the homeowner's first name for the hosted /billing/add-card page.
 * 410 for used/expired/revoked links (and lazily expires past-due ones).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }

  try {
    const { token } = await params;
    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }

    const { data: linkRow } = await supabaseAdmin
      .from('homeowner_payment_links')
      .select('homeowner_id, setup_intent_id, status, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (!linkRow) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    }
    const link = linkRow as {
      homeowner_id: string;
      setup_intent_id: string | null;
      status: string;
      expires_at: string;
    };

    if (link.status !== 'pending') {
      return NextResponse.json({ status: link.status, error: 'Link is no longer active' }, { status: 410 });
    }
    if (new Date(link.expires_at) < new Date()) {
      await supabaseAdmin
        .from('homeowner_payment_links')
        .update({ status: 'expired' })
        .eq('token', token)
        .eq('status', 'pending');
      return NextResponse.json({ status: 'expired', error: 'Link has expired' }, { status: 410 });
    }

    if (!link.setup_intent_id) {
      return NextResponse.json({ error: 'Link is not ready' }, { status: 409 });
    }

    const { data: ho } = await supabaseAdmin
      .from('user_profiles')
      .select('first_name')
      .eq('id', link.homeowner_id)
      .maybeSingle();

    const setupIntent = await retrieveSetupIntent(link.setup_intent_id);

    return NextResponse.json({
      status: 'pending',
      client_secret: setupIntent.client_secret,
      homeowner_first_name: (ho as { first_name: string | null } | null)?.first_name ?? 'there',
    });
  } catch (error) {
    console.error('Error resolving card link:', error);
    return NextResponse.json(
      { error: 'Failed to resolve link', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
