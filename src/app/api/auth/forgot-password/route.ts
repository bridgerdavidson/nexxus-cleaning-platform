import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { deliverRecoveryEmail } from '@/lib/auth/recoveryDelivery';
import { recordPlatformAlert } from '@/lib/monitoring/platformAlert';

// Records platform alerts via the service-role admin client — server runtime required.
export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/forgot-password  { email, redirectTo }
 *
 * Server-side trigger for the password-recovery email. We run the reset here (rather
 * than directly from the browser) so we can observe a send failure — e.g. the email
 * provider rejecting GoTrue's SMTP login — and page the PLATFORM OWNER, who is the
 * only one who can fix it. See migration 085 (platform_alerts), authEmailHealth.ts,
 * and platformAlert.ts. Delivery is org-branded when SMTP is configured
 * (recoveryDelivery.ts): the sender shows the user's org, GoTrue's mailer is the
 * fallback.
 *
 * Anti-enumeration: this ALWAYS returns { ok: true } regardless of whether the email
 * exists or the send succeeded. The end user can't act on a provider outage, and the
 * owner is alerted out-of-band, so the page renders the same generic "check your
 * email" view either way.
 *
 * Public + unauthenticated by necessity (a logged-out user is resetting). GoTrue's
 * own /recover rate-limit is the abuse backstop, same as the previous direct call.
 */
export async function POST(request: NextRequest) {
  let email: unknown;
  let redirectTo: unknown;
  try {
    const body = await request.json();
    email = body?.email;
    redirectTo = body?.redirectTo;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }
  const trimmedEmail = email.trim();
  const safeRedirect =
    typeof redirectTo === 'string' && redirectTo.length > 0 ? redirectTo : undefined;

  const result = await deliverRecoveryEmail({ email: trimmedEmail, redirectTo: safeRedirect });

  if (!result.ok) {
    await recordPlatformAlert(supabaseAdmin, {
      alert_type: 'auth_email_send_failure',
      severity: 'critical',
      summary: 'Password-recovery email failed to send (provider/SMTP error).',
      details: {
        email: trimmedEmail,
        status: result.failure.status,
        code: result.failure.code,
        message: result.failure.message,
        path: '/recover',
      },
    });
  }

  // Generic success always — never leak the send outcome (anti-enumeration).
  return NextResponse.json({ ok: true });
}
