import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled } from '@/lib/stripe/flags';
import { getOrgPortalLink } from '@/lib/payments/orgBilling';

export const runtime = 'nodejs';

/**
 * GET /api/stripe/billing/portal-link?organization_id=...&return_url=...  (Scenario 3 scaffolding)
 *
 * Owner/admin gets a Stripe Customer Portal URL for their org's billing Customer (manage
 * payment method, view invoices, cancel). Ensures the billing Customer exists first.
 */
export async function GET(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe is not enabled' }, { status: 404 });
  }

  try {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get('organization_id') ?? undefined;

    const auth = await requireOrgAuth(request, organizationId, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    const returnUrl =
      url.searchParams.get('return_url') ||
      `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.nexxus'}/admin-dashboard`;

    const link = await getOrgPortalLink(supabaseAdmin, organizationId!, returnUrl);
    return NextResponse.json({ success: true, url: link });
  } catch (error) {
    console.error('Error creating billing portal link:', error);
    return NextResponse.json(
      { error: 'Failed to create portal link', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
