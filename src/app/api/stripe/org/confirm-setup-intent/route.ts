import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getStripe, attachPaymentMethodToCustomer } from '@/lib/stripe';
import { stripeEnabled, stripeSelfPayEnabled } from '@/lib/stripe/flags';
import { requireOrgPaymentsAuth } from '@/lib/auth/requireOrgPaymentsAuth';

/**
 * POST /api/stripe/org/confirm-setup-intent
 *
 * Finalize saving the org's company card: verify the SetupIntent succeeded, attach the
 * PaymentMethod to the org's self-pay Customer (and make it the default), and persist
 * organizations.stripe_self_pay_customer_id. Owner/admin or manager with can_manage_payments.
 *
 * Verifies the SetupIntent's customer matches the org's stored self-pay Customer so a caller
 * can't attach a card to a Customer that isn't theirs.
 *
 * Body: { organization_id, setup_intent_id }
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled() || !stripeSelfPayEnabled()) {
    return NextResponse.json({ error: 'Self-pay is not enabled' }, { status: 404 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const { organization_id, setup_intent_id } = body as {
      organization_id?: string;
      setup_intent_id?: string;
    };
    if (!setup_intent_id) {
      return NextResponse.json({ error: 'Missing required field: setup_intent_id' }, { status: 400 });
    }

    const auth = await requireOrgPaymentsAuth(request, organization_id, supabaseAdmin);
    if (!auth.ok) return auth.response;

    const { data: orgRow } = await supabaseAdmin
      .from('organizations')
      .select('id, stripe_self_pay_customer_id')
      .eq('id', organization_id)
      .maybeSingle();
    const org = orgRow as { id: string; stripe_self_pay_customer_id: string | null } | null;
    if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

    const stripe = getStripe();
    const setupIntent = await stripe.setupIntents.retrieve(setup_intent_id);
    if (setupIntent.status !== 'succeeded') {
      return NextResponse.json(
        { error: 'SetupIntent not successful', status: setupIntent.status },
        { status: 400 },
      );
    }

    const paymentMethodId = setupIntent.payment_method as string;
    const customerId = setupIntent.customer as string;
    if (!paymentMethodId || !customerId) {
      return NextResponse.json({ error: 'SetupIntent missing payment method or customer' }, { status: 400 });
    }
    // The SetupIntent's Customer must be this org's self-pay Customer (block cross-org attaches).
    if (org.stripe_self_pay_customer_id && org.stripe_self_pay_customer_id !== customerId) {
      return NextResponse.json({ error: 'SetupIntent does not belong to this organization' }, { status: 403 });
    }

    await attachPaymentMethodToCustomer(paymentMethodId, customerId);

    if (org.stripe_self_pay_customer_id !== customerId) {
      await supabaseAdmin
        .from('organizations')
        .update({ stripe_self_pay_customer_id: customerId })
        .eq('id', org.id);
    }

    return NextResponse.json({
      success: true,
      customer_id: customerId,
      payment_method_id: paymentMethodId,
    });
  } catch (error) {
    console.error('Error confirming org SetupIntent:', error);
    return NextResponse.json(
      { error: 'Failed to confirm SetupIntent', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
