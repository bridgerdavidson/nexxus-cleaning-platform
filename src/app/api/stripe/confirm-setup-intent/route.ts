import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getStripe, attachPaymentMethodToCustomer } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { requireSelfOrOrgStaff } from '@/lib/auth/requireSelfOrOrgStaff';

/**
 * POST /api/stripe/confirm-setup-intent
 *
 * Finish saving a card: attach the confirmed SetupIntent's payment method to its
 * Customer and record the Customer on the homeowner's profile. Caller must be the
 * homeowner themselves, or org staff (owner/admin/manager, with organization_id
 * in the body) acting on a homeowner of their org.
 *
 * The SetupIntent's customer must match the homeowner's saved stripe_customer_id
 * (when one exists) — a profile's payment identity is never repointed here.
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe disabled' }, { status: 404 });
  }
  try {
    const body = await request.json();
    const { setup_intent_id, homeowner_id, organization_id } = body as {
      setup_intent_id?: string;
      homeowner_id?: string;
      organization_id?: string;
    };

    if (!setup_intent_id || !homeowner_id) {
      return NextResponse.json(
        { error: 'Missing required fields: setup_intent_id, homeowner_id' },
        { status: 400 }
      );
    }

    const auth = await requireSelfOrOrgStaff(request, supabaseAdmin, homeowner_id, organization_id);
    if (!auth.ok) return auth.response;

    // Retrieve the SetupIntent from Stripe
    const stripe = getStripe();
    const setupIntent = await stripe.setupIntents.retrieve(setup_intent_id);

    if (!setupIntent) {
      return NextResponse.json(
        { error: 'SetupIntent not found' },
        { status: 404 }
      );
    }

    // Check if SetupIntent was successful
    if (setupIntent.status !== 'succeeded') {
      return NextResponse.json(
        {
          error: 'SetupIntent not successful',
          status: setupIntent.status,
          last_setup_error: setupIntent.last_setup_error?.message
        },
        { status: 400 }
      );
    }

    const paymentMethodId = setupIntent.payment_method as string;
    const customerId = setupIntent.customer as string;

    if (!paymentMethodId || !customerId) {
      return NextResponse.json(
        { error: 'SetupIntent missing payment method or customer' },
        { status: 400 }
      );
    }

    // The SetupIntent must belong to the homeowner's own Customer. A profile with a
    // customer on file is never repointed to a different one.
    const { data: profileRow } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', homeowner_id)
      .maybeSingle();
    if (!profileRow) {
      return NextResponse.json({ error: 'Homeowner not found' }, { status: 404 });
    }
    const existingCustomerId =
      (profileRow as { stripe_customer_id: string | null }).stripe_customer_id ?? null;
    if (existingCustomerId && existingCustomerId !== customerId) {
      return NextResponse.json(
        { error: 'SetupIntent does not belong to this customer' },
        { status: 409 }
      );
    }

    // Attach payment method to customer and set as default
    await attachPaymentMethodToCustomer(paymentMethodId, customerId);

    // Record the Stripe customer ID on the profile (first save only — it matches thereafter)
    if (!existingCustomerId) {
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', homeowner_id);

      if (updateError) {
        console.error('Error updating stripe_customer_id:', updateError);
        // Don't fail the request, just log the error
      }
    }

    return NextResponse.json({
      success: true,
      customer_id: customerId,
      payment_method_id: paymentMethodId,
      message: 'Payment method attached successfully',
    });
  } catch (error) {
    console.error('Error confirming SetupIntent:', error);
    return NextResponse.json(
      {
        error: 'Failed to confirm SetupIntent',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
