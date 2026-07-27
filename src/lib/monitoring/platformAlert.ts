import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Operational alerts for the PLATFORM OWNER (Nexxus staff) — NOT tenants or org
 * admins. Use this for things only the platform operator can fix (provider/SMTP
 * outage, etc.). For tenant-facing notifications use recordNotificationEvent.
 *
 * Channels today:
 *   - always:    console.error('[platform-alert] ...')  -> shows in Vercel logs
 *   - persisted: ONE OPEN incident row per alert_type in public.platform_alerts
 *                (migration 085; unique partial index in 115). Repeat occurrences bump
 *                `occurrences`/`last_seen_at` on the open row; resolving it via
 *                /platform/alerts lets the next occurrence open a fresh row.
 *   - optional:  POST to process.env.ALERT_WEBHOOK_URL (Slack/Discord/generic JSON)
 *                when set — best-effort, never throws, fired once per NEW incident
 *                (not per occurrence; the open row carries the occurrence count).
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

// This can run inline on money paths (webhook handlers, sweeps) — a hung sink must never
// stall a Stripe webhook past its delivery deadline (T1-14).
const WEBHOOK_TIMEOUT_MS = 5_000;

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface PlatformAlertInput {
  alert_type: string; // stable key, e.g. 'auth_email_send_failure'
  summary: string; // one-line human summary
  severity?: AlertSeverity; // default 'critical'
  details?: Record<string, unknown>;
}

type PersistOutcome = 'inserted' | 'deduped' | 'error';

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

  let outcome: PersistOutcome = 'error';
  try {
    outcome = await upsertAlertRow(supabaseAdmin, input, severity);
  } catch (err) {
    console.error('[platform-alert] failed to persist alert row:', err);
  }

  // Webhook only for a NEW incident — firing on every occurrence spammed the sink while the
  // open row already folds the occurrence count (T1-14). A failed persist means we can't know
  // whether the incident is new, so send for visibility rather than stay silent.
  if (outcome !== 'deduped') await dispatchWebhook(input, severity);
}

/**
 * One OPEN incident per alert_type: bump the open row if it exists, else insert. The unique
 * partial index (migration 115) closes the select-then-insert race — a concurrent loser gets
 * 23505 and folds its occurrence into the winner's row. Every persistence error is surfaced
 * loudly (T1-14: they used to be silently ignored, so a failed persist looked like a recorded
 * alert).
 */
async function upsertAlertRow(
  supabaseAdmin: SupabaseClient,
  input: PlatformAlertInput,
  severity: AlertSeverity,
): Promise<PersistOutcome> {
  if (await bumpOpenIncident(supabaseAdmin, input)) return 'deduped';

  const { error: insertError } = await supabaseAdmin.from('platform_alerts').insert({
    alert_type: input.alert_type,
    severity,
    summary: input.summary,
    details: input.details ?? {},
  });
  if (!insertError) return 'inserted';

  if (insertError.code === '23505') {
    // Lost a concurrent-insert race on the open-incident index — the other writer's row IS the
    // incident; fold this occurrence into it.
    if (await bumpOpenIncident(supabaseAdmin, input)) return 'deduped';
  }
  console.error('[platform-alert] alert row insert failed:', insertError);
  return 'error';
}

/** Bump the open incident row for this alert_type; false when none exists or the read/write failed. */
async function bumpOpenIncident(
  supabaseAdmin: SupabaseClient,
  input: PlatformAlertInput,
): Promise<boolean> {
  const { data: existing, error: selectError } = await supabaseAdmin
    .from('platform_alerts')
    .select('id, occurrences')
    .eq('alert_type', input.alert_type)
    .is('resolved_at', null)
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selectError) {
    console.error('[platform-alert] open-incident lookup failed:', selectError);
    return false;
  }
  if (!existing) return false;

  const row = existing as { id: string; occurrences: number };
  const { error: updateError } = await supabaseAdmin
    .from('platform_alerts')
    .update({
      occurrences: (row.occurrences ?? 1) + 1,
      last_seen_at: new Date().toISOString(),
      summary: input.summary,
      details: input.details ?? {},
    })
    .eq('id', row.id);
  if (updateError) {
    console.error('[platform-alert] occurrence bump failed:', updateError);
    return false;
  }
  return true;
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
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `[${severity.toUpperCase()}] ${input.alert_type}: ${input.summary}`,
        alert_type: input.alert_type,
        severity,
        details: input.details ?? {},
      }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('[platform-alert] webhook sink returned', res.status);
    }
  } catch (err) {
    console.error('[platform-alert] webhook dispatch failed:', err);
  }
}
