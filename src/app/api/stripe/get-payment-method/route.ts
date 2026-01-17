import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPaymentMethodDetails } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return new NextResponse('Stripe disabled', { status: 404 });
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
    const { homeowner_id } = body;

    // Validate required fields
    if (!homeowner_id) {
      return NextResponse.json(
        { error: 'Missing required field: homeowner_id' },
        { status: 400 }
      );
    }

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

