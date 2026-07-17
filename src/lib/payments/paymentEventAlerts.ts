/**
 * Route money-correctness `payment_events` to the platform-owner alert outbox.
 *
 * Audit v4 / T1-8: `payment_events` was a write-only forensic table — money-math
 * violations, failed tenant transfers, failed clawbacks/reversals, unmatched
 * disputes, and fraud warnings were all *detected and recorded* but alerted nobody
 * (`recordPlatformAlert` was wired only to forgot-password). This maps the subset of
 * event types that represent a failure only the platform owner can act on to a
 * `platform_alerts` row (+ optional webhook sink), so detection now implies an alert.
 *
 * Success / expected transitions (drift_repaired, cleaner_paid, cleaner_payout_held,
 * clawback_blocked_bank_paid, the dispute lifecycle events that already fire their own
 * admin bell, etc.) are deliberately absent — they are not owner-actionable failures.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordPlatformAlert, type AlertSeverity } from '@/lib/monitoring/platformAlert';
import type { PaymentEventInput } from './events';

interface AlertableSpec {
  severity: AlertSeverity;
  label: string;
}

export const ALERTABLE_PAYMENT_EVENTS: Record<string, AlertableSpec> = {
  // Critical: the platform is (or may be) out real money, or a locked invariant broke.
  money_math_violation: { severity: 'critical', label: 'Paid cleaner payout does not match the locked split' },
  tenant_transfer_failed: { severity: 'critical', label: 'Tenant remainder transfer failed, the org was not paid' },
  transfer_reversal_failed: { severity: 'critical', label: 'Transfer reversal failed during a refund, platform out the money' },
  refund_clawback_failed: { severity: 'critical', label: 'Cleaner clawback failed during a refund, platform out the money' },
  transfer_list_failed: { severity: 'critical', label: 'Could not list transfers to reverse for a refund' },
  cleaner_clawback_failed: { severity: 'critical', label: 'Cleaner payout clawback failed' },
  // Warning: money is stuck or a platform-account risk signal fired, but it is retryable or non-loss.
  cleaner_transfer_failed: { severity: 'warning', label: 'Cleaner payout transfer failed' },
  unmatched_dispute: { severity: 'warning', label: 'A dispute could not be matched to a payment' },
  early_fraud_warning: { severity: 'warning', label: 'Stripe early fraud warning' },
  radar_review_opened: { severity: 'warning', label: 'Stripe Radar opened a review' },
  // Deliberately excluded: setup_intent_failed (a homeowner card-save issue → Tier 2, not
  // owner-actionable) and duplicate_charge_detected (ACH-only + semantics reworked by T3-1;
  // ACH alerting is handled in the Tier 3 ACH block, not here).
};

export interface PaymentEventAlert {
  alert_type: string;
  severity: AlertSeverity;
  summary: string;
  details: Record<string, unknown>;
}

/**
 * Pure decision: given a payment event, return the platform-alert to raise, or null if
 * the event is not owner-actionable. `alert_type` is namespaced and org-scoped so the
 * 6h de-dupe window in recordPlatformAlert folds the reconciler's 15-minute re-emits of
 * the *same* incident into one row, while keeping two different orgs distinct.
 */
export function alertInputForPaymentEvent(ev: PaymentEventInput): PaymentEventAlert | null {
  const spec = ALERTABLE_PAYMENT_EVENTS[ev.eventType];
  if (!spec) return null;

  const scope: string[] = [];
  if (ev.organizationId) scope.push(`org ${ev.organizationId}`);
  if (ev.appointmentId) scope.push(`appt ${ev.appointmentId}`);
  // Every alertable event records `amount` in cents (verified at each emit site).
  if (typeof ev.amount === 'number') scope.push(`$${(ev.amount / 100).toFixed(2)}`);
  const suffix = scope.length ? ` (${scope.join(', ')})` : '';

  return {
    alert_type: `payment_${ev.eventType}:${ev.organizationId ?? 'platform'}`,
    severity: spec.severity,
    summary: `${spec.label}${suffix}`,
    details: {
      event_type: ev.eventType,
      payment_id: ev.paymentId ?? null,
      appointment_id: ev.appointmentId ?? null,
      organization_id: ev.organizationId ?? null,
      amount_cents: ev.amount ?? null,
      actor: ev.actor ?? null,
      ...(ev.payload ?? {}),
    },
  };
}

/**
 * Best-effort: raise a platform alert for an owner-actionable payment event. Never
 * throws (same posture as recordPaymentEvent / recordPlatformAlert) so it cannot break
 * the money flow that emitted the event.
 */
export async function maybeAlertForPaymentEvent(
  supabase: SupabaseClient,
  ev: PaymentEventInput,
): Promise<void> {
  const input = alertInputForPaymentEvent(ev);
  if (!input) return;
  try {
    await recordPlatformAlert(supabase, input);
  } catch (err) {
    console.error('maybeAlertForPaymentEvent: alert routing failed:', err);
  }
}
