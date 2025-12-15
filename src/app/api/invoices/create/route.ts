import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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
      payment_id,
      appointment_id,
      amount,
      due_date,
      notes,
      status,
    } = body;

    // Validate required fields
    if (!organization_id || !homeowner_id || !amount) {
      return NextResponse.json(
        { error: 'Missing required fields: organization_id, homeowner_id, amount' },
        { status: 400 }
      );
    }

    // Verify homeowner exists
    const { data: homeowner, error: homeownerError } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('id', homeowner_id)
      .single();

    if (homeownerError || !homeowner) {
      return NextResponse.json(
        { error: 'Homeowner not found' },
        { status: 404 }
      );
    }

    // If payment_id is provided, verify it exists
    if (payment_id) {
      const { data: payment, error: paymentError } = await supabaseAdmin
        .from('payments')
        .select('id')
        .eq('id', payment_id)
        .single();

      if (paymentError || !payment) {
        return NextResponse.json(
          { error: 'Payment not found' },
          { status: 404 }
        );
      }
    }

    // If appointment_id is provided, verify it exists
    if (appointment_id) {
      const { data: appointment, error: appointmentError } = await supabaseAdmin
        .from('appointments')
        .select('id')
        .eq('id', appointment_id)
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
