import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getOrCreateStripeCustomer, createSetupIntent } from '@/lib/stripe';
import { stripeEnabled, stripeSelfPayEnabled } from '@/lib/stripe/flags';
import { requireOrgPaymentsAuth } from '@/lib/auth/requireOrgPaymentsAuth';

/**
 * POST /api/stripe/org/create-setup-intent
 *
 * Begin saving the ORG's company card (used to fund self-pay cleanings). Owner/admin, or a
 * manager with can_manage_payments. Ensures the org's platform self-pay Customer exists
 * (organizations.stripe_self_pay_customer_id) and returns a SetupIntent client secret for the
 * Payment Element. Card details never touch our servers.
 *
 * Body: { organization_id }
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled() || !stripeSelfPayEnabled()) {
    return NextResponse.json({ error: 'Self-pay is not enabled' }, { status: 404 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const { organization_id } = body as { organization_id?: string };

    const auth = await requireOrgPaymentsAuth(request, organization_id, supabaseAdmin);
    if (!auth.ok) return auth.response;

    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('id, name, billing_email, stripe_self_pay_customer_id')
      .eq('id', organization_id)
      .maybeSingle();
    const org = orgRow as
      | { id: string; name: string | null; billing_email: string | null; stripe_self_pay_customer_id: string | null }
      | null;
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

    const customer = await getOrCreateStripeCustomer(
      org.billing_email || auth.email || `org-${org.id}@nexxuscleaning.com`,
      org.name || 'Organization',
      org.stripe_self_pay_customer_id,
    );

    if (org.stripe_self_pay_customer_id !== customer.id) {
      await supabaseAdmin
        .from('organizations')
        .update({ stripe_self_pay_customer_id: customer.id })
        .eq('id', org.id);
    }

    const setupIntent = await createSetupIntent(customer.id);

    return NextResponse.json({
      success: true,
      client_secret: setupIntent.client_secret,
      setup_intent_id: setupIntent.id,
      customer_id: customer.id,
    });
  } catch (error) {
    console.error('Error creating org SetupIntent:', error);
    return NextResponse.json(
      { error: 'Failed to create SetupIntent', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
