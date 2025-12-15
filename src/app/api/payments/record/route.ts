import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    const {
      organization_id,
      homeowner_id,
      appointment_id,
      amount,
      payment_method,
      payment_type,
      notes,
      reference,
    } = body;

    // Validate required fields
    if (!organization_id || !amount || !payment_method) {
      return NextResponse.json(
        { error: 'Missing required fields: organization_id, amount, payment_method' },
        { status: 400 }
      );
    }

    // If appointment_id is provided, verify it exists
    if (appointment_id) {
      const { data: appointment, error: appointmentError } = await supabaseAdmin
        .from('appointments')
        .select('id, homeowner_id')
        .eq('id', appointment_id)
        .single();

      if (appointmentError || !appointment) {
        return NextResponse.json(
          { error: 'Appointment not found' },
          { status: 404 }
        );
      }

      // If homeowner_id not provided, use appointment's homeowner
      if (!homeowner_id && appointment.homeowner_id) {
        body.homeowner_id = appointment.homeowner_id;
      }
    }

    // Create payment record
    const paymentData: any = {
      organization_id,
      amount: Number(amount),
      payment_method: payment_method || 'manual',
      payment_type: payment_type || 'revenue',
      status: 'paid', // Default to paid for manual recordings
      paid_at: new Date().toISOString(),
      notes,
      reference,
    };

    // Only add appointment_id if it's provided and valid
    if (appointment_id) {
      paymentData.appointment_id = appointment_id;
    }

    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert([paymentData])
      .select()
      .single();

    if (paymentError) {
      console.error('Error creating payment:', paymentError);
      return NextResponse.json(
        { error: 'Failed to create payment', details: paymentError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      payment,
      message: 'Payment recorded successfully',
    });
  } catch (error) {
    console.error('Error in record payment API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
