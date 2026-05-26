import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { listSavedCards } from '@/lib/stripe/customers/homeowner';
import { homeownerBelongsToOrg } from '@/lib/payments/orgHomeowner';

/**
 * GET /api/stripe/saved-payment-methods?homeowner_id=&organization_id=
 *
 * Lists a homeowner's saved cards (masked metadata only) for the admin saved-card
 * picker. Org staff only; caller's org must be associated with the homeowner.
 */
export async function GET(request: NextRequest) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const homeownerId = searchParams.get('homeowner_id');
    const organizationId = searchParams.get('organization_id');

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    if (!homeownerId) {
      return NextResponse.json({ error: 'homeowner_id is required' }, { status: 400 });
    }

    const belongs = await homeownerBelongsToOrg(supabaseAdmin, homeownerId, organizationId!);
    if (!belongs) {
      return NextResponse.json({ error: 'Homeowner not found' }, { status: 404 });
    }

    const { data: ho } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', homeownerId)
      .maybeSingle();
    const customerId = (ho as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;
    if (!customerId) {
      return NextResponse.json({ cards: [] });
    }

    const cards = await listSavedCards(customerId);
    return NextResponse.json({ cards });
  } catch (error) {
    console.error('Error listing saved payment methods:', error);
    return NextResponse.json(
      { error: 'Failed to list payment methods', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
