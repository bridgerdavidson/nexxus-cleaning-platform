import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled } from '@/lib/stripe/flags';
import { getOrgPortalLink } from '@/lib/payments/orgBilling';
import { requireAppUrl } from '@/lib/billing/appUrl';

export const runtime = 'nodejs';

/**
 * GET /api/stripe/billing/portal-link?organization_id=...&return_url=...  (Scenario 3 scaffolding)
 *
 * Owner/admin gets a Stripe Customer Portal URL for their org's billing Customer.
 * Ensures the billing Customer exists first.
 *
 * WHICH portal they get is decided by `auth.role`, which requireOrgAuth read
 * from `organization_members` (ruling R24): an owner gets the full portal, an
 * admin gets the remediation portal, where the card and the invoices are
 * reachable and Cancel subscription is not. That role is the ONLY input to the
 * choice. Nothing about the portal variant may ever be read from the query
 * string or the body: a client-supplied variant would hand an admin the owner
 * portal for the asking, and this route is the only thing standing between an
 * admin and cancelling the agreement.
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

    const returnUrl = url.searchParams.get('return_url') || `${requireAppUrl()}/admin`;

    const link = await getOrgPortalLink(supabaseAdmin, organizationId!, returnUrl, auth.role);
    return NextResponse.json({ success: true, url: link });
  } catch (error) {
    console.error('Error creating billing portal link:', error);
    return NextResponse.json(
      { error: 'Failed to create portal link', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
