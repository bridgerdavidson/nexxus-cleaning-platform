import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { stripeEnabled } from '@/lib/stripe/flags';
import { startOrgSubscription } from '@/lib/payments/orgBilling';

export const runtime = 'nodejs';

/**
 * POST /api/stripe/billing/subscriptions/start  (Scenario 3 scaffolding — no UI in v1)
 *
 * Owner/admin starts a SaaS subscription for THEIR org (the org pays Nexxus). Ensures the
 * org's billing Customer exists, creates an incomplete subscription for the given Price, and
 * returns the first-invoice PaymentIntent client secret to confirm payment. Subscription
 * state is mirrored onto `organizations` by the customer.subscription.* webhooks.
 *
 * Body: { organization_id, price_id }
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe is not enabled' }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { organization_id, price_id } = body as { organization_id?: string; price_id?: string };

    // Auth before body validation (401 wins over 400).
    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin'],
    });
    if (!auth.ok) return auth.response;

    if (!price_id) {
      return NextResponse.json({ error: 'price_id is required' }, { status: 400 });
    }

    const result = await startOrgSubscription(supabaseAdmin, organization_id!, price_id);
    return NextResponse.json({
      success: true,
      subscription_id: result.subscriptionId,
      status: result.status,
      client_secret: result.clientSecret,
    });
  } catch (error) {
    console.error('Error starting subscription:', error);
    return NextResponse.json(
      { error: 'Failed to start subscription', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
