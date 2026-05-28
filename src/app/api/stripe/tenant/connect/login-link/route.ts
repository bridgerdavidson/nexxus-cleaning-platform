import { NextRequest, NextResponse } from 'next/server';
import { createExpressDashboardLoginLink } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * Returns a one-time Stripe Express dashboard login link for the tenant's
 * connected account. Powers the "Open Stripe dashboard ↗" CTA in the
 * /settings/payments hero — replaces the deleted `<ConnectAccountManagement />`
 * inline edits.
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe disabled' }, { status: 404 });
  }

  try {
    const { organizationId } = await request.json().catch(() => ({}));
    if (!organizationId) {
      return NextResponse.json(
        { error: 'Missing required field: organizationId' },
        { status: 400 },
      );
    }

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('stripe_connect_account_id')
      .eq('id', organizationId)
      .maybeSingle();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const row = org as { stripe_connect_account_id: string | null };
    if (!row.stripe_connect_account_id) {
      return NextResponse.json(
        { error: 'No Stripe Connect account on this organization yet' },
        { status: 400 },
      );
    }

    const origin =
      request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const loginLink = await createExpressDashboardLoginLink(
      row.stripe_connect_account_id,
      `${origin}/settings/payments`,
    );

    return NextResponse.json({ success: true, url: loginLink.url });
  } catch (error) {
    console.error('Error creating tenant Stripe login link:', error);
    return NextResponse.json(
      {
        error: 'Failed to create Stripe dashboard login link',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
