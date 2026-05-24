import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { stripeEnabled, stripeNewChargeFlowEnabled } from '@/lib/stripe/flags';
import { authorizeAppointment } from '@/lib/payments/authorizeAppointment';
import { cancelAuthorization } from '@/lib/stripe/charges/cancel';

/**
 * POST /api/cron/authorize-due  (CRON_SECRET-guarded; pg_cron calls it — migration 066)
 *
 * The just-in-time authorizer (locked decision #13):
 *   A) Initial authorization — appointments whose `authorize_at` window has arrived and
 *      that have a selected card but aren't yet authorized.
 *   B) Auth-expiry watchdog — re-authorize holds nearing the ~7-day card-hold expiry on
 *      jobs that haven't completed yet (cancel the stale hold, bump reauth_count, re-auth).
 *
 * Idempotent and self-limiting (batch caps). Per-appointment failures are collected, not
 * fatal, so one bad card never stalls the sweep.
 */
const REAUTH_BEFORE_EXPIRY_DAYS = 6;
const BATCH = 200;

export async function POST(request: NextRequest) {
  if (!stripeEnabled() || !stripeNewChargeFlowEnabled()) {
    return NextResponse.json({ error: 'New charge flow is not enabled' }, { status: 404 });
  }

  const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (!expected || request.headers.get('Authorization') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowIso = new Date().toISOString();
  let authorized = 0;
  let reauthorized = 0;
  const errors: Array<{ appointmentId: string; code: string }> = [];

  // ── A) Initial just-in-time authorization ────────────────────────────────────
  const { data: due } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .not('authorize_at', 'is', null)
    .lte('authorize_at', nowIso)
    .not('payment_method_id', 'is', null)
    .not('status', 'in', '(cancelled,completed)')
    .or('authorization_status.is.null,authorization_status.eq.scheduled')
    .limit(BATCH);

  for (const row of due ?? []) {
    const id = (row as { id: string }).id;
    const outcome = await authorizeAppointment(supabaseAdmin, id, 'cron:authorize-due');
    if (outcome.ok) authorized++;
    else errors.push({ appointmentId: id, code: outcome.code });
  }

  // ── B) Auth-expiry watchdog ──────────────────────────────────────────────────
  const cutoff = new Date(Date.now() - REAUTH_BEFORE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: expiring } = await supabaseAdmin
    .from('payments')
    .select('appointment_id, stripe_payment_intent_id')
    .eq('payment_intent_status', 'requires_capture')
    .lt('authorized_at', cutoff)
    .limit(BATCH);

  for (const row of expiring ?? []) {
    const p = row as { appointment_id: string; stripe_payment_intent_id: string | null };

    const { data: apptRow } = await supabaseAdmin
      .from('appointments')
      .select('status, authorization_status, reauth_count')
      .eq('id', p.appointment_id)
      .maybeSingle();
    const appt = apptRow as
      | { status: string; authorization_status: string | null; reauth_count: number | null }
      | null;
    if (
      !appt ||
      appt.status === 'cancelled' ||
      appt.status === 'completed' ||
      appt.authorization_status !== 'authorized'
    ) {
      continue;
    }

    // Release the stale hold (best-effort), bump the attempt, and re-authorize.
    if (p.stripe_payment_intent_id) {
      try {
        await cancelAuthorization(p.stripe_payment_intent_id);
      } catch {
        /* hold may already be released/expired — proceed to re-auth */
      }
    }
    await supabaseAdmin
      .from('appointments')
      .update({ reauth_count: (appt.reauth_count ?? 0) + 1, authorization_status: 'scheduled' })
      .eq('id', p.appointment_id);

    const outcome = await authorizeAppointment(supabaseAdmin, p.appointment_id, 'cron:reauth');
    if (outcome.ok) reauthorized++;
    else errors.push({ appointmentId: p.appointment_id, code: outcome.code });
  }

  return NextResponse.json({ success: true, authorized, reauthorized, errors });
}
