import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { stripeEnabled, stripeSelfPayEnabled } from '@/lib/stripe/flags';
import { requireOrgPaymentsAuth } from '@/lib/auth/requireOrgPaymentsAuth';
import { listSavedCards, detachPaymentMethod } from '@/lib/stripe/customers/homeowner';

/**
 * GET    /api/stripe/org/saved-payment-methods?organization_id=...   → list the org's company cards
 * DELETE /api/stripe/org/saved-payment-methods?organization_id=...&payment_method_id=...  → remove one
 *
 * The org's self-pay company card(s). Owner/admin or manager with can_manage_payments. Returns
 * masked metadata only (never the PAN). An org with no self-pay Customer yet returns [].
 */
async function loadOrgCustomerId(organizationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('stripe_self_pay_customer_id')
    .eq('id', organizationId)
    .maybeSingle();
  return (data as { stripe_self_pay_customer_id: string | null } | null)?.stripe_self_pay_customer_id ?? null;
}

export async function GET(request: NextRequest) {
  if (!stripeEnabled() || !stripeSelfPayEnabled()) {
    return NextResponse.json({ error: 'Self-pay is not enabled' }, { status: 404 });
  }
  try {
    const organizationId = new URL(request.url).searchParams.get('organization_id');
    const auth = await requireOrgPaymentsAuth(request, organizationId, supabaseAdmin);
    if (!auth.ok) return auth.response;

    const customerId = await loadOrgCustomerId(organizationId!);
    if (!customerId) return NextResponse.json({ cards: [] });

    const cards = await listSavedCards(customerId);
    return NextResponse.json({ cards });
  } catch (error) {
    console.error('Error listing org saved cards:', error);
    return NextResponse.json(
      { error: 'Failed to list saved cards', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!stripeEnabled() || !stripeSelfPayEnabled()) {
    return NextResponse.json({ error: 'Self-pay is not enabled' }, { status: 404 });
  }
  try {
    const url = new URL(request.url);
    const organizationId = url.searchParams.get('organization_id');
    const paymentMethodId = url.searchParams.get('payment_method_id');
    if (!paymentMethodId) {
      return NextResponse.json({ error: 'Missing payment_method_id' }, { status: 400 });
    }

    const auth = await requireOrgPaymentsAuth(request, organizationId, supabaseAdmin);
    if (!auth.ok) return auth.response;

    const customerId = await loadOrgCustomerId(organizationId!);
    if (!customerId) return NextResponse.json({ error: 'No company card on file' }, { status: 404 });

    // detachPaymentMethod verifies the card belongs to this Customer first (no id-guessing).
    const removed = await detachPaymentMethod(customerId, paymentMethodId);
    if (!removed) return NextResponse.json({ error: 'Card not found on this organization' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing org saved card:', error);
    return NextResponse.json(
      { error: 'Failed to remove saved card', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
