import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled, stripeTenantConnectEnabled } from '@/lib/stripe/flags';
import {
  createTenantConnectAccount,
  createTenantAccountSession,
} from '@/lib/stripe/connect/tenant';

/**
 * POST /api/stripe/tenant/connect/start
 *
 * Owner-only. Ensures the organization has an Express connected account (creating
 * one on first call) and returns an Account Session client secret for embedded
 * onboarding. Idempotent: re-calling reuses the existing account.
 *
 * Body: { organization_id: string }
 * Returns: { success, account_id, client_secret }
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled() || !stripeTenantConnectEnabled()) {
    return NextResponse.json({ error: 'Tenant Connect is not enabled' }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { organization_id } = body as { organization_id?: string };

    // Owner + admin: both manage org settings. Owner-only is operationally fragile
    // (owner unavailable ⇒ nobody can onboard payments). Creating the merchant-of-record
    // account is still gated to trusted org staff (not managers/cleaners/homeowners).
    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    const { data: org, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select('id, name, billing_email, stripe_connect_account_id')
      .eq('id', organization_id)
      .single();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    let accountId = org.stripe_connect_account_id as string | null;

    if (!accountId) {
      const email = (org.billing_email as string | null) || auth.email || '';
      const account = await createTenantConnectAccount(org.id, email, org.name);
      accountId = account.id;

      const { error: updateError } = await supabaseAdmin
        .from('organizations')
        .update({ stripe_connect_account_id: accountId })
        .eq('id', org.id);

      if (updateError) {
        console.error('Error saving organization stripe_connect_account_id:', updateError);
        return NextResponse.json(
          { error: 'Failed to persist connected account' },
          { status: 500 },
        );
      }
    }

    const session = await createTenantAccountSession(accountId);

    return NextResponse.json({
      success: true,
      account_id: accountId,
      client_secret: session.client_secret,
    });
  } catch (error) {
    console.error('Error starting tenant Connect onboarding:', error);
    return NextResponse.json(
      {
        error: 'Failed to start onboarding',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
