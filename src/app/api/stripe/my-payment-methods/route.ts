import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifyAccessToken } from '@/lib/auth/verifyToken';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { listSavedCards, detachPaymentMethod, setDefaultPaymentMethod } from '@/lib/stripe/customers/homeowner';

/**
 * Self-scoped saved-card management for the authenticated homeowner. The customer id is
 * always derived from the verified bearer token's profile — never the request — so a caller
 * can only ever see/remove/promote their OWN cards.
 *
 *   GET    → list the caller's saved cards (masked metadata only)
 *   DELETE → detach one of the caller's saved cards ({ payment_method_id })
 *   PATCH  → make one of the caller's saved cards the default ({ payment_method_id })
 */
async function resolveCustomerId(token: string): Promise<{ customerId: string | null; userId: string } | null> {
  const verified = await verifyAccessToken(supabaseAdmin, token);
  if (!verified) return null;
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', verified.userId)
    .maybeSingle();
  return {
    customerId: (profile as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null,
    userId: verified.userId,
  };
}

function bearer(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization');
  return authHeader?.replace(/^Bearer\s+/i, '').trim() || null;
}

export async function GET(request: NextRequest) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }
  try {
    const token = bearer(request);
    if (!token) return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });

    const resolved = await resolveCustomerId(token);
    if (!resolved) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    if (!resolved.customerId) return NextResponse.json({ success: true, cards: [] });

    const cards = await listSavedCards(resolved.customerId);
    return NextResponse.json({ success: true, cards });
  } catch (error) {
    console.error('Error listing payment methods:', error);
    return NextResponse.json(
      { error: 'Failed to list payment methods', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }
  try {
    const token = bearer(request);
    if (!token) return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });

    const resolved = await resolveCustomerId(token);
    if (!resolved) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { payment_method_id } = body as { payment_method_id?: string };
    if (!payment_method_id) {
      return NextResponse.json({ error: 'payment_method_id is required' }, { status: 400 });
    }
    if (!resolved.customerId) {
      return NextResponse.json({ error: 'No saved cards' }, { status: 404 });
    }

    const removed = await detachPaymentMethod(resolved.customerId, payment_method_id);
    if (!removed) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing payment method:', error);
    return NextResponse.json(
      { error: 'Failed to remove payment method', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }
  try {
    const token = bearer(request);
    if (!token) return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });

    const resolved = await resolveCustomerId(token);
    if (!resolved) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { payment_method_id } = body as { payment_method_id?: string };
    if (!payment_method_id) {
      return NextResponse.json({ error: 'payment_method_id is required' }, { status: 400 });
    }
    if (!resolved.customerId) {
      return NextResponse.json({ error: 'No saved cards' }, { status: 404 });
    }

    const updated = await setDefaultPaymentMethod(resolved.customerId, payment_method_id);
    if (!updated) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error setting default payment method:', error);
    return NextResponse.json(
      { error: 'Failed to set default payment method', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
