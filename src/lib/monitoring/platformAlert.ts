import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Operational alerts for the PLATFORM OWNER (Nexxus staff) — NOT tenants or org
 * admins. Use this for things only the platform operator can fix (provider/SMTP
 * outage, etc.). For tenant-facing notifications use recordNotificationEvent.
 *
 * Channels today:
 *   - always:    console.error('[platform-alert] ...')  -> shows in Vercel logs
 *   - persisted: one row in public.platform_alerts (migration 085), de-duped per
 *                incident so a future channel can pick it up
 *   - optional:  POST to process.env.ALERT_WEBHOOK_URL (Slack/Discord/generic JSON)
 *                when set — best-effort, never throws
 *
 * TODO(SMS, later — do NOT build until asked): a dispatcher cron will
 *   SELECT * FROM platform_alerts WHERE sms_dispatched_at IS NULL AND severity = 'critical',
 *   text PLATFORM_OWNER_PHONE via the SMS provider, then stamp sms_dispatched_at.
 *   The row + column already exist (migration 085); wiring the provider is all
 *   that's left. This is how the owner gets a text when, e.g., password-reset email
 *   breaks.
 *
 * Optional env (all unset = log + DB row only, no external calls):
 *   ALERT_WEBHOOK_URL    - external alert sink usable today (Slack/Discord webhook)
 *   PLATFORM_OWNER_PHONE - future SMS recipient (not read yet)
 */

const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000; // 6h: one row per incident, not per retry

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface PlatformAlertInput {
  alert_type: string; // stable key, e.g. 'auth_email_send_failure'
  summary: string; // one-line human summary
  severity?: AlertSeverity; // default 'critical'
  details?: Record<string, unknown>;
}

/**
 * Record a platform-owner alert. Best-effort: never throws, so a broken alert path
 * can't crash the request that triggered it (same posture as recordNotificationEvent).
 */
export async function recordPlatformAlert(
  supabaseAdmin: SupabaseClient,
  input: PlatformAlertInput,
): Promise<void> {
  const severity = input.severity ?? 'critical';

  // Always log first — the one channel guaranteed to work even if DB + webhook fail.
  console.error(
    `[platform-alert] ${input.alert_type} (${severity}): ${input.summary}`,
    input.details ?? {},
  );

  try {
    await upsertAlertRow(supabaseAdmin, input, severity);
  } catch (err) {
    console.error('[platform-alert] failed to persist alert row:', err);
  }

  await dispatchWebhook(input, severity);
}

/**
 * Fold repeated occurrences of the same open incident into a single row (so an
 * outage where many users retry produces one alert, not hundreds — and a future
 * SMS dispatcher texts once per incident). Inserts a fresh row otherwise.
 */
async function upsertAlertRow(
  supabaseAdmin: SupabaseClient,
  input: PlatformAlertInput,
  severity: AlertSeverity,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();

  const { data: existing } = await supabaseAdmin
    .from('platform_alerts')
    .select('id, occurrences')
    .eq('alert_type', input.alert_type)
    .is('resolved_at', null)
    .gte('last_seen_at', since)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; occurrences: number };
    await supabaseAdmin
      .from('platform_alerts')
      .update({
        occurrences: (row.occurrences ?? 1) + 1,
        last_seen_at: nowIso,
        summary: input.summary,
        details: input.details ?? {},
      })
      .eq('id', row.id);
    return;
  }

  await supabaseAdmin.from('platform_alerts').insert({
    alert_type: input.alert_type,
    severity,
    summary: input.summary,
    details: input.details ?? {},
  });
}

/**
 * Optional external sink. Slack, Discord, and most generic webhooks accept a JSON
 * body with a `text` field. No-op when ALERT_WEBHOOK_URL is unset.
 */
async function dispatchWebhook(
  input: PlatformAlertInput,
  severity: AlertSeverity,
): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `[${severity.toUpperCase()}] ${input.alert_type}: ${input.summary}`,
        alert_type: input.alert_type,
        severity,
        details: input.details ?? {},
      }),
    });
  } catch (err) {
    console.error('[platform-alert] webhook dispatch failed:', err);
  }
}
