import { NextRequest, NextResponse } from 'next/server';
import { getConnectedAccountPayouts, getPayoutTransferIds } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe disabled' }, { status: 404 });
  }

  try {
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
    }

    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUser) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const { cleaner_id } = await request.json();
    if (!cleaner_id) {
      return NextResponse.json({ error: 'Missing required field: cleaner_id' }, { status: 400 });
    }
    if (authUser.id !== cleaner_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: cleanerProfile, error: profileError } = await supabaseAdmin
      .from('cleaner_profiles')
      .select('id, stripe_connect_account_id, stripe_connect_onboarding_complete')
      .eq('id', cleaner_id)
      .single();

    if (profileError || !cleanerProfile) {
      return NextResponse.json({ error: 'Cleaner profile not found' }, { status: 404 });
    }

    if (!cleanerProfile.stripe_connect_account_id || !cleanerProfile.stripe_connect_onboarding_complete) {
      // Not connected yet — nothing to reconcile
      return NextResponse.json({ success: true, reconciled: 0, message: 'No connected Stripe account' });
    }

    const connectedAccountId = cleanerProfile.stripe_connect_account_id;

    // Fetch all completed (paid) bank payouts for this connected account
    const stripePayouts = await getConnectedAccountPayouts(connectedAccountId);

    if (stripePayouts.length === 0) {
      return NextResponse.json({ success: true, reconciled: 0, message: 'No paid payouts on Stripe yet' });
    }

    let totalReconciled = 0;

    for (const stripePayout of stripePayouts) {
      // Get the transfer IDs that were batched into this Stripe bank payout
      const transferIds = await getPayoutTransferIds(connectedAccountId, stripePayout.id);

      if (transferIds.length > 0) {
        // Precise: update rows whose transfer IDs are in this bank payout
        const { data: updatedRows, error: updateError } = await supabaseAdmin
          .from('payouts')
          .update({
            status: 'bank_paid',
            stripe_payout_id: stripePayout.id,
            bank_paid_at: stripePayout.arrivalDate,
          })
          .eq('cleaner_id', cleaner_id)
          .eq('status', 'paid')
          .in('stripe_transfer_id', transferIds)
          .select('id');

        if (updateError) {
          console.error('Reconcile: error updating payout rows for Stripe payout', stripePayout.id, updateError);
        } else {
          const updated = (updatedRows ?? []).length;
          totalReconciled += updated;
          if (updated > 0) {
            console.log(`Reconcile: marked ${updated} rows as bank_paid for Stripe payout ${stripePayout.id}`);
          } else {
            console.log(`Reconcile: 0 rows matched transfer IDs for Stripe payout ${stripePayout.id} — rows may already be bank_paid`);
          }
        }
      } else {
        // Fallback: transfer ID lookup returned nothing. Only mark rows whose
        // paid_at is before the payout arrival_date — rows newer than the payout
        // cannot have been included in it, so we leave those untouched.
        console.warn(`Reconcile: no transfer IDs resolved for Stripe payout ${stripePayout.id}, using date-guarded fallback`);

        const { data: updatedRows, error: updateError } = await supabaseAdmin
          .from('payouts')
          .update({
            status: 'bank_paid',
            stripe_payout_id: stripePayout.id,
            bank_paid_at: stripePayout.arrivalDate,
          })
          .eq('cleaner_id', cleaner_id)
          .eq('status', 'paid')
          .is('stripe_payout_id', null)
          .lte('paid_at', stripePayout.arrivalDate)
          .select('id');

        if (updateError) {
          console.error('Reconcile fallback: error updating payout rows for Stripe payout', stripePayout.id, updateError);
        } else {
          const updated = (updatedRows ?? []).length;
          totalReconciled += updated;
          if (updated > 0) {
            console.log(`Reconcile fallback: marked ${updated} rows as bank_paid for Stripe payout ${stripePayout.id}`);
          } else {
            console.log(`Reconcile fallback: no eligible paid rows to update for Stripe payout ${stripePayout.id}`);
          }
        }
      }
    }

    // --- Reset: correct any rows incorrectly promoted to bank_paid ---
    // A row is a false positive if its paid_at is AFTER the bank_paid_at on
    // the same row (meaning the job was paid after the Stripe payout settled).
    // This is the signature left by the old blind backfill logic.
    const { data: falseBankPaid, error: resetQueryError } = await supabaseAdmin
      .from('payouts')
      .select('id, paid_at, bank_paid_at')
      .eq('cleaner_id', cleaner_id)
      .eq('status', 'bank_paid')
      .not('bank_paid_at', 'is', null);

    if (!resetQueryError && falseBankPaid && falseBankPaid.length > 0) {
      const badIds = falseBankPaid
        .filter(r => r.paid_at && r.bank_paid_at && r.paid_at > r.bank_paid_at)
        .map(r => r.id);

      if (badIds.length > 0) {
        const { error: resetError } = await supabaseAdmin
          .from('payouts')
          .update({ status: 'paid', stripe_payout_id: null, bank_paid_at: null })
          .in('id', badIds);

        if (resetError) {
          console.error('Reconcile reset: error resetting incorrectly bank_paid rows:', resetError);
        } else {
          console.log(`Reconcile reset: restored ${badIds.length} incorrectly bank_paid row(s) to paid status`);
        }
      }
    }

    return NextResponse.json({
      success: true,
      reconciled: totalReconciled,
      message: `Reconciled ${totalReconciled} payout row(s) to bank_paid`,
    });
  } catch (error) {
    console.error('Error in reconcile-payouts:', error);
    return NextResponse.json(
      { error: 'Reconciliation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
