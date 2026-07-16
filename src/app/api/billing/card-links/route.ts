import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgPaymentsAuth } from '@/lib/auth/requireOrgPaymentsAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { getOrCreateStripeCustomer } from '@/lib/stripe/customers/homeowner';
import { createCardSetupIntent } from '@/lib/stripe/setup-intents';
import { homeownerBelongsToOrg } from '@/lib/payments/orgHomeowner';
import { emailConfigured, sendEmail } from '@/lib/email/sendEmail';
import { cardLinkEmail } from '@/lib/email/templates/cardLinkEmail';

// nodemailer needs the Node runtime.
export const runtime = 'nodejs';

const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_TTL_DAYS = 7;

/**
 * The emailed URL is built from a pinned server base (matching the invite-email
 * convention), NEVER from the request Host: a Host-derived origin in an auto-sent
 * email is a phishing / token-exfiltration vector. `request.nextUrl.origin` is only
 * used for the copy-link URL returned to the operator's own browser.
 */
function trustedAppBase(): string | null {
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  return base ? base.replace(/\/+$/, '') : null;
}

/**
 * POST /api/billing/card-links
 *
 * Org staff: create a single-use, 7-day hosted card-collection link for a homeowner.
 * Ensures the homeowner has a platform Customer + a fresh SetupIntent, stores a
 * `homeowner_payment_links` row, and emails the link to the homeowner when SMTP is
 * configured (falling back to returning the URL for the operator to share manually).
 *
 * Body: { organization_id, homeowner_id, deliver?: 'email' | 'copy' }
 * Response: { success, token, url, expires_at, delivered: 'email' | 'copy' }
 * An email-send failure never fails the request; it degrades to delivered: 'copy'.
 */
export async function POST(request: NextRequest) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { organization_id, homeowner_id, deliver } = body as {
      organization_id?: string;
      homeowner_id?: string;
      deliver?: 'email' | 'copy';
    };

    // Creating a card-collection link precedes a payment-spending action, so a manager
    // additionally needs can_manage_payments.
    const auth = await requireOrgPaymentsAuth(request, organization_id, supabaseAdmin);
    if (!auth.ok) return auth.response;

    if (!homeowner_id) {
      return NextResponse.json({ error: 'homeowner_id is required' }, { status: 400 });
    }

    const belongs = await homeownerBelongsToOrg(supabaseAdmin, homeowner_id, organization_id!);
    if (!belongs) {
      return NextResponse.json({ error: 'Homeowner not found' }, { status: 404 });
    }

    const { data: ho } = await supabaseAdmin
      .from('user_profiles')
      .select('email, first_name, last_name, stripe_customer_id')
      .eq('id', homeowner_id)
      .maybeSingle();
    if (!ho) {
      return NextResponse.json({ error: 'Homeowner not found' }, { status: 404 });
    }
    const profile = ho as {
      email: string;
      first_name: string | null;
      last_name: string | null;
      stripe_customer_id: string | null;
    };

    const name = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim() || 'Customer';
    const customer = await getOrCreateStripeCustomer(profile.email, name, profile.stripe_customer_id);
    if (customer.id !== profile.stripe_customer_id) {
      await supabaseAdmin.from('user_profiles').update({ stripe_customer_id: customer.id }).eq('id', homeowner_id);
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();
    const setupIntent = await createCardSetupIntent(customer.id, {
      token,
      organization_id: organization_id!,
      homeowner_id,
    });

    const { error: insertError } = await supabaseAdmin.from('homeowner_payment_links').insert({
      homeowner_id,
      organization_id,
      token,
      setup_intent_id: setupIntent.id,
      status: 'pending',
      created_by: auth.userId,
      expires_at: expiresAt,
    });
    if (insertError) {
      console.error('Error inserting homeowner_payment_links row:', insertError);
      return NextResponse.json({ error: 'Failed to create card link' }, { status: 500 });
    }

    const url = `${request.nextUrl.origin}/billing/add-card?t=${token}`;

    // Deliver by email when SMTP + a trusted base URL are configured (unless the
    // caller explicitly asked for copy). Failure degrades to copy, never a 500:
    // the link row already exists and the operator can still share it manually.
    const appBase = trustedAppBase();
    let delivered: 'email' | 'copy' = 'copy';
    if (deliver !== 'copy' && emailConfigured() && appBase) {
      try {
        const { data: org } = await supabaseAdmin
          .from('organizations')
          .select('name')
          .eq('id', organization_id!)
          .maybeSingle();
        const orgName = (org as { name?: string } | null)?.name?.trim() || 'Your cleaning company';
        const message = cardLinkEmail({
          homeownerName: profile.first_name?.trim() || null,
          orgName,
          url: `${appBase}/billing/add-card?t=${token}`,
          // Signed-in alternative for recipients wary of email payment links.
          accountUrl: `${appBase}/app/homeowner-dashboard/account/payment-methods`,
          expiresInDays: LINK_TTL_DAYS,
        });
        await sendEmail({ to: profile.email, ...message });
        delivered = 'email';
      } catch (emailError) {
        console.error('Card link email failed; falling back to copy:', emailError);
      }
    }

    return NextResponse.json({ success: true, token, url, expires_at: expiresAt, delivered });
  } catch (error) {
    console.error('Error creating card link:', error);
    return NextResponse.json(
      { error: 'Failed to create card link', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
