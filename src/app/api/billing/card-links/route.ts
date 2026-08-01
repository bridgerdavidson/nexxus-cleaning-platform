import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { requireOrgPaymentsAuth } from '@/lib/auth/requireOrgPaymentsAuth';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { getOrCreateStripeCustomer } from '@/lib/stripe/customers/homeowner';
import { createCardSetupIntent } from '@/lib/stripe/setup-intents';
import { homeownerBelongsToOrg } from '@/lib/payments/orgHomeowner';
import { emailConfigured, sendEmail } from '@/lib/email/sendEmail';
import { cardLinkEmail, type FailedPaymentContext } from '@/lib/email/templates/cardLinkEmail';

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

/** "2026-06-24" -> "June 24" without timezone drift (the column is a plain date). */
function scheduledDateLabel(scheduledDate: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(scheduledDate ?? '');
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Optional email context: when the caller names an appointment whose charge
 * failed (or needs bank verification), the email switches to the urgent
 * "your payment did not go through" wording with the server-derived amount and
 * date. The appointment must belong to this org AND this homeowner; anything
 * else (missing, mismatched, not actually failed) silently degrades to the
 * generic email rather than failing link creation, and the identical response
 * shape means a mismatched id leaks nothing.
 */
async function failedPaymentContext(
  appointmentId: string | undefined,
  organizationId: string,
  homeownerId: string,
): Promise<FailedPaymentContext | null> {
  if (!appointmentId) return null;
  const { data } = await supabaseAdmin
    .from('appointments')
    .select('organization_id, homeowner_id, authorization_status, is_self_pay, total_price, scheduled_date, payment_method_id')
    .eq('id', appointmentId)
    .maybeSingle();
  const appt = data as {
    organization_id: string | null;
    homeowner_id: string | null;
    authorization_status: string | null;
    is_self_pay: boolean | null;
    total_price: number | null;
    scheduled_date: string | null;
    payment_method_id: string | null;
  } | null;
  if (!appt || appt.organization_id !== organizationId || appt.homeowner_id !== homeownerId) return null;
  // A comped self-pay booking keeps homeowner_id, but its failed charge is the
  // COMPANY card's failure. Telling the homeowner THEIR card was declined (with
  // an amount they don't owe) would be false; send the routine email instead.
  if (appt.is_self_pay) return null;
  if (appt.authorization_status !== 'failed' && appt.authorization_status !== 'requires_action') return null;
  // 'failed' with NO payment method is the T1-7 no-card bail (the bail clears the dead id):
  // nothing was declined, so the email must say "no card on file", not a false decline.
  const failedReason = appt.payment_method_id ? 'declined' : 'no_card';
  return {
    reason: appt.authorization_status === 'failed' ? failedReason : 'verification',
    amountLabel: appt.total_price != null ? `$${Number(appt.total_price).toFixed(2)}` : null,
    dateLabel: scheduledDateLabel(appt.scheduled_date),
  };
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
    const { organization_id, homeowner_id, deliver, appointment_id } = body as {
      organization_id?: string;
      homeowner_id?: string;
      deliver?: 'email' | 'copy';
      /** Optional: the failed appointment this link is fixing (urgent email wording). */
      appointment_id?: string;
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
          .select('name, brand_color, logo_icon_url')
          .eq('id', organization_id!)
          .maybeSingle();
        const orgRow = org as { name?: string; brand_color?: string | null; logo_icon_url?: string | null } | null;
        const orgName = orgRow?.name?.trim() || 'Your cleaning company';
        const message = cardLinkEmail({
          homeownerName: profile.first_name?.trim() || null,
          orgName,
          url: `${appBase}/billing/add-card?t=${token}`,
          // Signed-in alternative for recipients wary of email payment links.
          accountUrl: `${appBase}/homeowner/account/payment-methods`,
          failedPayment: await failedPaymentContext(appointment_id, organization_id!, homeowner_id),
          expiresInDays: LINK_TTL_DAYS,
          // White-label: the org's own color and icon; the template falls back
          // to the Nexxus look when either is unset.
          brandColor: orgRow?.brand_color ?? null,
          logoUrl: orgRow?.logo_icon_url ?? null,
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
