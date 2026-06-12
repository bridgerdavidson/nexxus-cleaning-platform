import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getOrCreateStripeCustomer, createSetupIntent } from '@/lib/stripe';
import { stripeEnabled } from '@/lib/stripe/flags';
import { requireSelfOrOrgStaff } from '@/lib/auth/requireSelfOrOrgStaff';

/**
 * POST /api/stripe/create-setup-intent
 *
 * Begin saving a card for a homeowner's platform Customer. Caller must be the
 * homeowner themselves, or org staff (owner/admin/manager, with organization_id
 * in the body) acting on a homeowner of their org.
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled()) {
    return NextResponse.json({ error: 'Stripe disabled' }, { status: 404 });
  }
  try {
    const body = await request.json();
    const { homeowner_id, organization_id } = body as {
      homeowner_id?: string;
      organization_id?: string;
    };

    const auth = await requireSelfOrOrgStaff(request, supabaseAdmin, homeowner_id, organization_id);
    if (!auth.ok) return auth.response;

    // Fetch homeowner profile
    const { data: homeowner, error: homeownerError } = await supabaseAdmin
      .from('user_profiles')
      .select('id, email, first_name, last_name, stripe_customer_id')
      .eq('id', homeowner_id!)
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
        .eq('id', homeowner_id!);

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
