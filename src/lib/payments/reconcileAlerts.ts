/**
 * Turn a reconcile sweep's own results into platform-owner alerts.
 *
 * Audit v4 / T1-8: the cron sweep returned violation / dead-letter counts as JSON, but
 * pg_cron invokes it via `net.http_post` and discards the response (migration 067) — so a
 * sweep that fails every cycle or a dead-letter queue that never drains alerted nobody.
 * The route now inspects its own results and, separately, alerts when the whole sweep
 * throws.
 *
 * Note: money-math violations and failed transfers/clawbacks are NOT re-alerted here —
 * they already raise a per-incident alert through `recordPaymentEvent` (see
 * paymentEventAlerts.ts). This module only covers signals with no per-event emit site.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordPlatformAlert, type PlatformAlertInput } from '@/lib/monitoring/platformAlert';

export interface ReconcileSweepResults {
  deadLetter?: { retried: number; recovered: number; stillFailed: number };
  [key: string]: unknown;
}

/** Pure: which alerts a completed sweep's results warrant. */
export function reconcileSweepAlerts(results: ReconcileSweepResults): PlatformAlertInput[] {
  const alerts: PlatformAlertInput[] = [];

  const stillFailed = results.deadLetter?.stillFailed ?? 0;
  if (stillFailed > 0) {
    alerts.push({
      alert_type: 'reconcile_dead_letter_stuck',
      severity: 'warning',
      summary: `${stillFailed} webhook event(s) still failing after the dead-letter retry sweep`,
      details: { deadLetter: results.deadLetter },
    });
  }

  return alerts;
}

/** Best-effort: raise every alert a completed sweep warrants. */
export async function raiseReconcileSweepAlerts(
  supabase: SupabaseClient,
  results: ReconcileSweepResults,
): Promise<void> {
  for (const alert of reconcileSweepAlerts(results)) {
    await recordPlatformAlert(supabase, alert);
  }
}
