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
    const { payout_id, amount, notes } = body;

    // Validate required fields
    if (!payout_id) {
      return NextResponse.json(
        { error: 'Missing required field: payout_id' },
        { status: 400 }
      );
    }

    // Get existing payout
    const { data: existingPayout, error: fetchError } = await supabaseAdmin
      .from('payouts')
      .select('*')
      .eq('id', payout_id)
      .single();

    if (fetchError || !existingPayout) {
      return NextResponse.json(
        { error: 'Payout not found' },
        { status: 404 }
      );
    }

    // Check if payout is already approved or paid
    if (existingPayout.status !== 'pending') {
      return NextResponse.json(
        { error: `Payout is already ${existingPayout.status}` },
        { status: 400 }
      );
    }

    // Mock Stripe Connect transfer
    // TODO: Replace with actual Stripe Connect API call when ready
    const mockTransferId = `tr_mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log('🔄 Mock Stripe Connect Transfer:', {
      payout_id,
      amount: amount || existingPayout.amount,
      cleaner_id: existingPayout.cleaner_id,
      transfer_id: mockTransferId,
      timestamp: new Date().toISOString(),
    });

    // Update payout status to 'approved' (or 'paid' if simulating immediate transfer)
    const updateData: any = {
      status: 'approved',
      approved_at: new Date().toISOString(),
      stripe_transfer_id: mockTransferId,
    };

    // If amount override is provided
    if (amount && amount !== existingPayout.amount) {
      updateData.amount = Number(amount);
    }

    // If notes are provided
    if (notes) {
      updateData.notes = notes;
    }

    const { data: updatedPayout, error: updateError } = await supabaseAdmin
      .from('payouts')
      .update(updateData)
      .eq('id', payout_id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating payout:', updateError);
      return NextResponse.json(
        { error: 'Failed to approve payout', details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      payout: updatedPayout,
      transfer_id: mockTransferId,
      message: 'Payout approved successfully',
    });
  } catch (error) {
    console.error('Error in approve payout API:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
