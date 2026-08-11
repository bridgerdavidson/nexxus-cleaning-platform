import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { dispatchReceiptEmails } from '@/lib/notifications/dispatchReceiptEmails';

// Needs the service-role admin client + nodemailer; nothing edge-compatible here.
export const runtime = 'nodejs';

/**
 * POST /api/cron/notification-emails  (CRON_SECRET-guarded; pg_cron calls it every
 * 5 minutes — migration 20260811_notification_emails_cron)
 *
 * Drains the notification_events outbox to email. Today that is exactly the three
 * homeowner money receipts (audit T2-1b); future channels (SMS, more event types)
 * belong in this same route so there is one dispatcher heartbeat.
 *
 * Deliberately NOT gated on STRIPE_ENABLED: the drain only reads the outbox, and
 * rows only exist if a money path already ran. With SMTP unconfigured it reports
 * `skipped` and touches nothing.
 */
export async function POST(request: NextRequest) {
  // Fail closed (same posture as reconcile-payments): a missing secret is a 500
  // misconfig, and the comparison never routes through a nullable sentinel.
  if (!process.env.CRON_SECRET) {
    console.error('CRON_SECRET is not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  if (request.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const receipts = await dispatchReceiptEmails(supabaseAdmin);
    return NextResponse.json({ ok: true, receipts });
  } catch (err) {
    console.error('notification email drain failed:', err);
    return NextResponse.json({ error: 'Drain failed' }, { status: 500 });
  }
}
