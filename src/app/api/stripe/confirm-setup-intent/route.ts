import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripe, attachPaymentMethodToCustomer } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe disabled' }, { status: 404 });
  }
  try {
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get request body
    const body = await request.json();
    const { setup_intent_id, homeowner_id } = body;

    // Validate required fields
    if (!setup_intent_id || !homeowner_id) {
      return NextResponse.json(
        { error: 'Missing required fields: setup_intent_id, homeowner_id' },
        { status: 400 }
      );
    }

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

    // Attach payment method to customer and set as default
    await attachPaymentMethodToCustomer(paymentMethodId, customerId);

    // Update user profile with Stripe customer ID (if not already set)
    const { error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', homeowner_id);

    if (updateError) {
      console.error('Error updating stripe_customer_id:', updateError);
      // Don't fail the request, just log the error
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

