import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getPaymentMethodDetails } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { requireSelfOrOrgStaff } from '@/lib/auth/requireSelfOrOrgStaff';

export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe disabled' }, { status: 404 });
  }
  try {
    // Get request body
    const body = await request.json();
    const { homeowner_id, organization_id } = body;

    // Validate required fields
    if (!homeowner_id) {
      return NextResponse.json(
        { error: 'Missing required field: homeowner_id' },
        { status: 400 }
      );
    }

    // Auth: the homeowner themselves, or org staff acting on a homeowner in their
    // org. Closes the unauthenticated card-detail (brand/last4) disclosure.
    const auth = await requireSelfOrOrgStaff(
      request,
      supabaseAdmin,
      homeowner_id,
      organization_id,
    );
    if (!auth.ok) return auth.response;

    // Fetch homeowner's stripe_customer_id
    const { data: homeowner, error: homeownerError } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('id', homeowner_id)
      .single();

    if (homeownerError) {
      console.error('Error fetching homeowner:', homeownerError);
      return NextResponse.json(
        { error: 'Homeowner not found' },
        { status: 404 }
      );
    }

    // If no Stripe customer ID, there's no card on file
    if (!homeowner?.stripe_customer_id) {
      return NextResponse.json({
        success: true,
        has_card: false,
        payment_method: null,
      });
    }

    // Get payment method details from Stripe
    const paymentMethodDetails = await getPaymentMethodDetails(homeowner.stripe_customer_id);

    if (!paymentMethodDetails) {
      return NextResponse.json({
        success: true,
        has_card: false,
        payment_method: null,
      });
    }

    return NextResponse.json({
      success: true,
      has_card: true,
      payment_method: {
        last4: paymentMethodDetails.last4,
        brand: paymentMethodDetails.brand,
      },
    });
  } catch (error) {
    console.error('Error getting payment method:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get payment method', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

