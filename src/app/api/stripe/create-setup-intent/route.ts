import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getOrCreateStripeCustomer, createSetupIntent } from '@/lib/stripe';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
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

    // Fetch homeowner profile
    const { data: homeowner, error: homeownerError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, email, first_name, last_name, stripe_customer_id')
      .eq('id', homeowner_id)
      .single();

    if (homeownerError || !homeowner) {
      console.error('Error fetching homeowner:', homeownerError);
      return NextResponse.json(
        { error: 'Homeowner not found' },
        { status: 404 }
      );
    }

    // Get or create Stripe customer
    const customerName = `${homeowner.first_name || ''} ${homeowner.last_name || ''}`.trim() || 'Customer';
    const stripeCustomer = await getOrCreateStripeCustomer(
      homeowner.email,
      customerName,
      homeowner.stripe_customer_id
    );

    // Update user profile with Stripe customer ID if it's new
    if (homeowner.stripe_customer_id !== stripeCustomer.id) {
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update({ stripe_customer_id: stripeCustomer.id })
        .eq('id', homeowner_id);

      if (updateError) {
        console.error('Error updating stripe_customer_id:', updateError);
        // Don't fail the request, just log the error
      }
    }

    // Create SetupIntent
    const setupIntent = await createSetupIntent(stripeCustomer.id);

    return NextResponse.json({
      success: true,
      client_secret: setupIntent.client_secret,
      setup_intent_id: setupIntent.id,
      customer_id: stripeCustomer.id,
    });
  } catch (error) {
    console.error('Error creating SetupIntent:', error);
    return NextResponse.json(
      { 
        error: 'Failed to create SetupIntent', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

