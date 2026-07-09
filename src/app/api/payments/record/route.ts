import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgPaymentsAuth } from '@/lib/auth/requireOrgPaymentsAuth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      organization_id,
      appointment_id,
      amount,
      payment_method,
      payment_type,
      notes,
      reference,
    } = body;

    // ── Auth first: don't leak validation details to unauthenticated callers. Recording a
    // payment is a payment-spending action, so a manager additionally needs can_manage_payments.
    const auth = await requireOrgPaymentsAuth(request, organization_id, supabaseAdmin);
    if (!auth.ok) return auth.response;

    if (!appointment_id || !amount || !payment_method) {
      return NextResponse.json(
        { error: 'Missing required fields: appointment_id, amount, payment_method' },
        { status: 400 }
      );
    }

    // Verify the appointment exists *and* belongs to caller's org.
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .select('id, organization_id')
      .eq('id', appointment_id)
      .single();

    if (appointmentError || !appointment) {
      return NextResponse.json(
        { error: 'Appointment not found' },
        { status: 404 }
      );
    }

    if ((appointment as { organization_id: string }).organization_id !== organization_id) {
      return NextResponse.json(
        { error: 'Appointment does not belong to the specified organization' },
        { status: 400 }
      );
    }

    const paymentData: Record<string, unknown> = {
      organization_id,
      appointment_id,
      amount: Number(amount),
      payment_method: payment_method || 'manual',
      payment_type: payment_type || 'revenue',
      status: 'paid',
      paid_at: new Date().toISOString(),
      notes,
      reference,
    };

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
