import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPaymentIntent, getDefaultPaymentMethod } from '@/lib/stripe';
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
    const { appointment_id, organization_id } = body;

    // Validate required fields
    if (!appointment_id) {
      return NextResponse.json(
        { error: 'Missing required field: appointment_id' },
        { status: 400 }
      );
    }

    // Fetch appointment details
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .select('id, homeowner_id, total_price, status')
      .eq('id', appointment_id)
      .single();

    if (appointmentError || !appointment) {
      console.error('Error fetching appointment:', appointmentError);
      return NextResponse.json(
        { error: 'Appointment not found' },
        { status: 404 }
      );
    }

    // Fetch homeowner's Stripe customer ID
    const { data: homeowner, error: homeownerError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, stripe_customer_id, email, first_name, last_name')
      .eq('id', appointment.homeowner_id)
      .single();

    if (homeownerError || !homeowner) {
      console.error('Error fetching homeowner:', homeownerError);
      return NextResponse.json(
        { error: 'Homeowner not found' },
        { status: 404 }
      );
    }

    if (!homeowner.stripe_customer_id) {
      return NextResponse.json(
        { error: 'Homeowner does not have a payment method on file' },
        { status: 400 }
      );
    }

    // Get the default payment method
    const paymentMethodId = await getDefaultPaymentMethod(homeowner.stripe_customer_id);

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: 'No payment method found for customer' },
        { status: 400 }
      );
    }

    // Create PaymentIntent
    const paymentIntent = await createPaymentIntent(
      homeowner.stripe_customer_id,
      appointment.total_price,
      appointment_id,
      paymentMethodId
    );

    // Create or update payment record in database
    const paymentData = {
      organization_id: organization_id || null,
      appointment_id: appointment_id,
      amount: appointment.total_price,
      status: paymentIntent.status === 'succeeded' ? 'paid' : 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: paymentIntent.id,
      paid_at: paymentIntent.status === 'succeeded' ? new Date().toISOString() : null,
    };

    // Check if payment record already exists for this appointment
    const { data: existingPayment } = await supabaseAdmin
      .from('payments')
      .select('id')
      .eq('appointment_id', appointment_id)
      .single();

    let paymentRecord;
    if (existingPayment) {
      // Update existing payment
      const { data, error } = await supabaseAdmin
        .from('payments')
        .update(paymentData)
        .eq('id', existingPayment.id)
        .select()
        .single();
      
      if (error) throw error;
      paymentRecord = data;
    } else {
      // Create new payment
      const { data, error } = await supabaseAdmin
        .from('payments')
        .insert(paymentData)
        .select()
        .single();
      
      if (error) throw error;
      paymentRecord = data;
    }

    return NextResponse.json({
      success: true,
      payment_intent_id: paymentIntent.id,
      payment_intent_status: paymentIntent.status,
      payment_record: paymentRecord,
      amount: appointment.total_price,
    });
  } catch (error) {
    console.error('Error creating PaymentIntent:', error);
    
    // Handle Stripe-specific errors
    if (error instanceof Error) {
      // Check for card decline or other Stripe errors
      const stripeError = error as { type?: string; code?: string; decline_code?: string };
      if (stripeError.type === 'StripeCardError') {
        return NextResponse.json(
          { 
            error: 'Payment failed', 
            details: error.message,
            code: stripeError.code,
            decline_code: stripeError.decline_code,
          },
          { status: 402 }
        );
      }
    }

    return NextResponse.json(
      { 
        error: 'Failed to process payment', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

