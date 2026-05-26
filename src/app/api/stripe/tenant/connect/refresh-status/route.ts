import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeTenantConnectEnabled } from '@/lib/stripe/flags';
import { getTenantConnectStatus } from '@/lib/stripe/connect/tenant';

/**
 * POST /api/stripe/tenant/connect/refresh-status
 *
 * Owner/admin. Re-fetches the tenant's connected account from Stripe and mirrors
 * its capability + requirements state into `organizations`. Called from the
 * embedded onboarding component's onExit, and as a manual refresh. The
 * `account.updated` webhook keeps this current between calls.
 *
 * Body: { organization_id: string }
 * Returns: { success, status }
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled() || !stripeTenantConnectEnabled()) {
    return NextResponse.json({ error: 'Tenant Connect is not enabled' }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { organization_id } = body as { organization_id?: string };

    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, stripe_connect_account_id, stripe_connect_onboarded_at')
      .eq('id', organization_id)
      .single();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (!org.stripe_connect_account_id) {
      return NextResponse.json(
        { error: 'No connected account for this organization' },
        { status: 400 },
      );
    }

    const status = await getTenantConnectStatus(org.stripe_connect_account_id);

    const update: Record<string, unknown> = {
      stripe_connect_charges_enabled: status.chargesEnabled,
      stripe_connect_payouts_enabled: status.payoutsEnabled,
      stripe_connect_details_submitted: status.detailsSubmitted,
      stripe_connect_requirements_due: status.requirementsDue,
    };
    if (status.detailsSubmitted && !org.stripe_connect_onboarded_at) {
      update.stripe_connect_onboarded_at = new Date().toISOString();
    }

    const { error: updateError } = await supabaseAdmin
      .from('organizations')
      .update(update)
      .eq('id', org.id);

    if (updateError) {
      console.error('Error mirroring tenant Connect status:', updateError);
      return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
    }

    return NextResponse.json({ success: true, status });
  } catch (error) {
    console.error('Error refreshing tenant Connect status:', error);
    return NextResponse.json(
      {
        error: 'Failed to refresh status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
