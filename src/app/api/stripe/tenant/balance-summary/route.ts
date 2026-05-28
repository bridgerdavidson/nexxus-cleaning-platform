import { NextRequest, NextResponse } from 'next/server';
import { getConnectedAccountBalance, getLatestConnectedAccountPayout } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

/**
 * Returns live Stripe balance + latest scheduled payout for an organization's
 * connected account (the tenant — merchant of record). Powers the 3-cell
 * balance row on /settings/payments so the UI shows fresh numbers without
 * mounting Stripe's embedded ConnectBalances component (which used to render
 * a second balance card on top of ConnectPayouts).
 *
 * Mirrors `/api/stripe/connect/balance-summary` (the cleaner-side equivalent)
 * but auths against `organization_members.role ∈ {owner, admin, manager}` and
 * reads the account id from `organizations.stripe_connect_account_id`.
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
      .select(
        'stripe_connect_account_id, stripe_connect_charges_enabled, stripe_connect_payouts_enabled',
      )
      .eq('id', organizationId)
      .maybeSingle();

    if (orgError || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const row = org as {
      stripe_connect_account_id: string | null;
      stripe_connect_charges_enabled: boolean | null;
      stripe_connect_payouts_enabled: boolean | null;
    };

    if (!row.stripe_connect_account_id || !row.stripe_connect_charges_enabled) {
      return NextResponse.json({
        success: true,
        connected: false,
        availableBalance: 0,
        pendingBalance: 0,
        latestPayout: null,
      });
    }

    const [balance, latestPayout] = await Promise.all([
      getConnectedAccountBalance(row.stripe_connect_account_id),
      getLatestConnectedAccountPayout(row.stripe_connect_account_id),
    ]);

    return NextResponse.json({
      success: true,
      connected: true,
      availableBalance: balance.available / 100,
      pendingBalance: balance.pending / 100,
      latestPayout: latestPayout
        ? {
            amount: latestPayout.amount / 100,
            date: latestPayout.arrivalDate,
          }
        : null,
    });
  } catch (error) {
    console.error('Error fetching tenant balance summary:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch tenant balance summary',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
