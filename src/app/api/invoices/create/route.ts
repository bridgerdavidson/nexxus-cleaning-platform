import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgAuth } from '@/lib/auth/requireOrgAuth';
import { homeownerBelongsToOrg } from '@/lib/payments/orgHomeowner';

// Generate invoice number in format: INV-YYYYMMDD-XXXX
function generateInvoiceNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 9999).toString().padStart(4, '0');
  
  return `INV-${year}${month}${day}-${random}`;
}

export async function POST(request: NextRequest) {
  try {
    // Get request body
    const body = await request.json();
    const {
      organization_id,
      homeowner_id,
      payment_id,
      appointment_id,
      amount,
      due_date,
      notes,
      status,
    } = body;

    // ── Auth first: only org staff may create invoices, and only for their own org.
    const auth = await requireOrgAuth(request, organization_id, supabaseAdmin, {
      allowedRoles: ['owner', 'admin', 'manager'],
    });
    if (!auth.ok) return auth.response;

    // Validate required fields
    if (!homeowner_id || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: organization_id, homeowner_id, amount' },
        { status: 400 }
      );
    }

    // Verify the homeowner is associated with the caller's org (not just that the
    // user id exists somewhere in the system).
    const homeownerBelongs = await homeownerBelongsToOrg(
      supabaseAdmin,
      homeowner_id,
      organization_id,
    );
    if (!homeownerBelongs) {
      return NextResponse.json(
        { error: 'Homeowner not found' },
        { status: 404 }
      );
    }

    // If payment_id is provided, verify it exists *and* belongs to the caller's org.
    if (payment_id) {
      const { data: payment, error: paymentError } = await supabaseAdmin
        .from('payments')
        .select('id')
        .eq('id', payment_id)
        .eq('organization_id', organization_id)
        .single();

      if (paymentError || !payment) {
        return NextResponse.json(
          { error: 'Payment not found' },
          { status: 404 }
        );
      }
    }

    // If appointment_id is provided, verify it exists *and* belongs to the caller's org.
    if (appointment_id) {
      const { data: appointment, error: appointmentError } = await supabaseAdmin
        .from('appointments')
        .select('id')
        .eq('id', appointment_id)
        .eq('organization_id', organization_id)
        .single();

      if (appointmentError || !appointment) {
        return NextResponse.json(
          { error: 'Appointment not found' },
          { status: 404 }
        );
      }
    }

    // Generate unique invoice number
    let invoiceNumber = generateInvoiceNumber();
    let attempts = 0;
    const maxAttempts = 10;

    // Ensure invoice number is unique
    while (attempts < maxAttempts) {
      const { data: existing } = await supabaseAdmin
        .from('invoices')
        .select('id')
        .eq('invoice_number', invoiceNumber)
        .single();

      if (!existing) break;
      
      invoiceNumber = generateInvoiceNumber();
      attempts++;
    }

    if (attempts >= maxAttempts) {
      return NextResponse.json(
        { error: 'Failed to generate unique invoice number' },
        { status: 500 }
      );
    }

    // Create invoice record
    const invoiceData: any = {
      organization_id,
      homeowner_id,
      invoice_number: invoiceNumber,
      amount: Number(amount),
      status: status || 'draft',
      notes,
    };

    // Add optional fields if provided
    if (payment_id) invoiceData.payment_id = payment_id;
    if (appointment_id) invoiceData.appointment_id = appointment_id;
    if (due_date) invoiceData.due_date = due_date;

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('invoices')
      .insert([invoiceData])
      .select()
      .single();

    if (invoiceError) {
      console.error('Error creating invoice:', invoiceError);
      return NextResponse.json(
        { error: 'Failed to create invoice', details: invoiceError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      invoice,
      message: 'Invoice created successfully',
    });
  } catch (error) {
    console.error('Error in create invoice API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
