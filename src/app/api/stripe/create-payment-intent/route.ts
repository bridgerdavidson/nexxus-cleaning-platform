import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createPaymentIntent, getDefaultPaymentMethod } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';

export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe disabled' }, { status: 404 });
  }
  try {
    const body = await request.json();
    const { appointment_id, organization_id } = body;

    if (!appointment_id) {
      return NextResponse.json(
        { error: 'Missing required field: appointment_id' },
        { status: 400 }
      );
    }
    if (!organization_id) {
      return NextResponse.json(
        { error: 'Missing required field: organization_id' },
        { status: 400 }
      );
    }

    // ── Auth: caller must be in this org with billing-capable role ─────────
    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    // ── Scope: appointment must live in caller's org ───────────────────────
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .select('id, homeowner_id, total_price, status, organization_id')
      .eq('id', appointment_id)
      .eq('organization_id', organization_id)
      .single();

    if (appointmentError || !appointment) {
      return NextResponse.json(
        { error: 'Appointment not found' },
        { status: 404 }
      );
    }

    const { data: homeowner, error: homeownerError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, stripe_customer_id, email, first_name, last_name')
      .eq('id', appointment.homeowner_id as string)
      .single();

    if (homeownerError || !homeowner) {
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

    const paymentMethodId = await getDefaultPaymentMethod(homeowner.stripe_customer_id as string);

    if (!paymentMethodId) {
      return NextResponse.json(
        { error: 'No payment method found for customer' },
        { status: 400 }
      );
    }

    const paymentIntent = await createPaymentIntent(
      homeowner.stripe_customer_id as string,
      appointment.total_price as number,
      appointment_id,
      paymentMethodId
    );

    const paymentData = {
      organization_id,
      appointment_id,
      amount: appointment.total_price,
      status: paymentIntent.status === 'succeeded' ? 'paid' : 'pending',
      payment_method: 'card',
      payment_type: 'revenue',
      stripe_payment_intent_id: paymentIntent.id,
      paid_at: paymentIntent.status === 'succeeded' ? new Date().toISOString() : null,
    };

    const { data: existingPayment } = await supabaseAdmin
      .from('payments')
      .select('id')
      .eq('appointment_id', appointment_id)
      .single();

    let paymentRecord;
    if (existingPayment) {
      const { data, error } = await supabaseAdmin
        .from('payments')
        .update(paymentData)
        .eq('id', (existingPayment as { id: string }).id)
        .select()
        .single();
      if (error) throw error;
      paymentRecord = data;
    } else {
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

    if (error instanceof Error) {
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
