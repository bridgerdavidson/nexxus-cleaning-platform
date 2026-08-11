/**
 * Email drain for homeowner money receipts (audit T2-1b, MASTER-TODO 3.5).
 *
 * Reads the `notification_events` outbox that the T2-1 emits already fill
 * (homeownerMoneyEvents.ts) and delivers the three homeowner money event types
 * as org-branded emails. Everything else in the outbox (admin/cleaner events,
 * job messages) is untouched: email is opt-in per event type via
 * RECEIPT_EMAIL_EVENT_TYPES, never a blanket channel.
 *
 * Delivery contract:
 *   - A row is due when email_dispatched_at IS NULL, send_after <= now(), and
 *     failed_attempts < MAX_EMAIL_ATTEMPTS.
 *   - Each row is CLAIMED first (conditional update on email_dispatched_at IS
 *     NULL), then sent. Two overlapping drains can't double-send; the tradeoff
 *     is that a crash between claim and send loses that one email (the in-app
 *     bell row still exists, and money state is never involved).
 *   - A failed send un-claims the row and bumps failed_attempts/last_error, so
 *     the next run retries. A row that exhausts its attempts raises a platform
 *     alert (pg_cron discards the route's response, so the drain must self-alert
 *     — the T1-8 lesson).
 *   - With SMTP unconfigured the drain claims nothing and bumps nothing: rows
 *     wait, fully deliverable, until the vars appear.
 *
 * ⚠ Receipts are delivered from the outbox ONLY. Never via `receipt_email` on
 * the PaymentIntent — that mutates the request body under an unchanged Stripe
 * idempotency key and the cancellation-fee path double-charges undetected
 * (see the backlog under T2-1b).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, emailConfigured } from '@/lib/email/sendEmail';
import { receiptEmail, type ReceiptEmailKind } from '@/lib/email/templates/receiptEmail';
import { recordPlatformAlert } from '@/lib/monitoring/platformAlert';

export const RECEIPT_EMAIL_EVENT_TYPES: ReceiptEmailKind[] = [
  'charge_succeeded',
  'refund_issued',
  'cancellation_fee_charged',
];

/** After this many failed sends a row stops retrying (and has alerted). */
export const MAX_EMAIL_ATTEMPTS = 5;

/** Per-run cap. At the 5-minute cron cadence this clears any realistic backlog. */
export const EMAIL_BATCH_SIZE = 25;

interface OutboxRow {
  id: string;
  organization_id: string;
  recipient_user_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  failed_attempts: number;
}

export interface ReceiptEmailDrainResult {
  /** SMTP vars missing: nothing claimed, rows wait. */
  skipped?: 'smtp_unconfigured';
  sent: number;
  failed: number;
  /** Rows whose latest failure hit MAX_EMAIL_ATTEMPTS this run (already alerted). */
  exhausted: number;
}

function moneyLabel(payload: Record<string, unknown> | null): string | null {
  const cents = Number(payload?.amount_cents);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** "2026-06-24" -> "June 24" without timezone drift (plain date column). */
function dateLabel(payload: Record<string, unknown> | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(payload?.scheduled_date ?? ''));
  if (!m) return null;
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const month = monthNames[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : null;
}

function str(payload: Record<string, unknown> | null, key: string): string | null {
  const v = payload?.[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

/** Emailed links come from APP_URL only (never a request Host — same rule as card links). */
function receiptsUrl(): string | null {
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  return base ? `${base.replace(/\/+$/, '')}/homeowner/account/receipts` : null;
}

export async function dispatchReceiptEmails(
  supabaseAdmin: SupabaseClient,
): Promise<ReceiptEmailDrainResult> {
  if (!emailConfigured()) {
    return { skipped: 'smtp_unconfigured', sent: 0, failed: 0, exhausted: 0 };
  }

  const { data, error } = await supabaseAdmin
    .from('notification_events')
    .select('id, organization_id, recipient_user_id, event_type, payload, failed_attempts')
    .in('event_type', RECEIPT_EMAIL_EVENT_TYPES)
    .is('email_dispatched_at', null)
    .lte('send_after', new Date().toISOString())
    .lt('failed_attempts', MAX_EMAIL_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(EMAIL_BATCH_SIZE);
  if (error) throw new Error(`receipt email drain select failed: ${error.message}`);

  const rows = (data ?? []) as OutboxRow[];
  const result: ReceiptEmailDrainResult = { sent: 0, failed: 0, exhausted: 0 };
  if (rows.length === 0) return result;

  // Per-run caches: a batch usually repeats the same org and often the same recipient.
  const orgCache = new Map<
    string,
    { name: string; brand_color: string | null; logo_icon_url: string | null } | null
  >();
  const profileCache = new Map<string, { email: string; name: string | null } | null>();

  for (const row of rows) {
    if (!row.recipient_user_id) continue; // homeowner events always carry one; skip malformed rows

    // Atomic claim: only one drain run gets each row.
    const { data: claimed } = await supabaseAdmin
      .from('notification_events')
      .update({ email_dispatched_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('email_dispatched_at', null)
      .select('id');
    if (!claimed || claimed.length === 0) continue;

    try {
      let profile = profileCache.get(row.recipient_user_id);
      if (profile === undefined) {
        const { data: p } = await supabaseAdmin
          .from('user_profiles')
          .select('email, first_name, last_name')
          .eq('id', row.recipient_user_id)
          .maybeSingle();
        const pr = p as { email?: string; first_name?: string | null; last_name?: string | null } | null;
        profile = pr?.email
          ? {
              email: pr.email,
              name: `${pr.first_name ?? ''} ${pr.last_name ?? ''}`.trim() || null,
            }
          : null;
        profileCache.set(row.recipient_user_id, profile);
      }
      if (!profile) throw new Error('recipient profile has no email');

      let org = orgCache.get(row.organization_id);
      if (org === undefined) {
        const { data: o } = await supabaseAdmin
          .from('organizations')
          .select('name, brand_color, logo_icon_url')
          .eq('id', row.organization_id)
          .maybeSingle();
        org = (o as { name: string; brand_color: string | null; logo_icon_url: string | null } | null) ?? null;
        orgCache.set(row.organization_id, org);
      }

      const reason = str(row.payload, 'reason');
      const email = receiptEmail({
        kind: row.event_type as ReceiptEmailKind,
        homeownerName: profile.name,
        orgName: org?.name ?? 'Your cleaning company',
        amountLabel: moneyLabel(row.payload),
        dateLabel: dateLabel(row.payload),
        propertyLabel: str(row.payload, 'property_label'),
        feeReason: reason === 'no_show' || reason === 'cancellation' ? reason : null,
        receiptsUrl: receiptsUrl(),
        brandColor: org?.brand_color ?? null,
        logoUrl: org?.logo_icon_url ?? null,
      });

      await sendEmail({ to: profile.email, ...email });
      result.sent += 1;
    } catch (err) {
      // Un-claim so the next run retries, and record why.
      const attempts = row.failed_attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      await supabaseAdmin
        .from('notification_events')
        .update({
          email_dispatched_at: null,
          failed_attempts: attempts,
          last_error: message.slice(0, 500),
        })
        .eq('id', row.id);
      result.failed += 1;

      if (attempts >= MAX_EMAIL_ATTEMPTS) {
        result.exhausted += 1;
        await recordPlatformAlert(supabaseAdmin, {
          alert_type: 'receipt_email_send_failure',
          severity: 'warning',
          summary: `A homeowner receipt email exhausted its ${MAX_EMAIL_ATTEMPTS} send attempts`,
          details: { notification_event_id: row.id, event_type: row.event_type, last_error: message },
        });
      }
    }
  }

  return result;
}
