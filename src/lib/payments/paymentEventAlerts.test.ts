import { describe, it, expect } from 'vitest';
import {
  ALERTABLE_PAYMENT_EVENTS,
  alertInputForPaymentEvent,
} from './paymentEventAlerts';

describe('alertInputForPaymentEvent', () => {
  it('returns null for a non-alertable (success / expected) event', () => {
    expect(alertInputForPaymentEvent({ eventType: 'drift_repaired' })).toBeNull();
    expect(alertInputForPaymentEvent({ eventType: 'cleaner_paid' })).toBeNull();
    expect(alertInputForPaymentEvent({ eventType: 'cleaner_payout_held' })).toBeNull();
    // dispute lifecycle events already have their own admin bell notifications.
    expect(alertInputForPaymentEvent({ eventType: 'dispute_lost' })).toBeNull();
    // T1-4: the fee-race deferral self-heals within one sweep, so it is a silent forensic marker.
    expect(alertInputForPaymentEvent({ eventType: 'settlement_deferred_no_row' })).toBeNull();
  });

  it('T1-9: a failed tenant remainder transfer (org not paid) is a critical, org-scoped alert', () => {
    const input = alertInputForPaymentEvent({
      eventType: 'tenant_transfer_failed',
      organizationId: 'org-7',
      appointmentId: 'appt-3',
      amount: 3900,
      actor: 'webhook',
    });
    expect(input).not.toBeNull();
    expect(input!.severity).toBe('critical');
    expect(input!.alert_type).toBe('payment_tenant_transfer_failed:org-7');
    expect(ALERTABLE_PAYMENT_EVENTS.tenant_transfer_failed?.severity).toBe('critical');
  });

  it('maps a critical money-loss event with the right severity and namespaced type', () => {
    const input = alertInputForPaymentEvent({
      eventType: 'transfer_reversal_failed',
      organizationId: 'org-1',
      appointmentId: 'appt-9',
      amount: 15800, // cents
      actor: 'user:admin-1',
    });
    expect(input).not.toBeNull();
    expect(input!.severity).toBe('critical');
    // alert_type is namespaced + org-scoped so the 6h dedupe folds sweep re-emits
    // per org, not across the whole platform.
    expect(input!.alert_type).toBe('payment_transfer_reversal_failed:org-1');
    expect(input!.summary).toContain('org org-1');
    expect(input!.summary).toContain('appt appt-9');
    expect(input!.summary).toContain('$158.00'); // amount is cents -> dollars
    expect(input!.details).toMatchObject({
      event_type: 'transfer_reversal_failed',
      organization_id: 'org-1',
      appointment_id: 'appt-9',
      amount_cents: 15800,
      actor: 'user:admin-1',
    });
  });

  it('falls back to a platform-scoped dedupe key when there is no org', () => {
    const input = alertInputForPaymentEvent({ eventType: 'money_math_violation' });
    expect(input!.alert_type).toBe('payment_money_math_violation:platform');
    expect(input!.severity).toBe('critical');
  });

  it('classifies retryable / risk-signal events as warning, not critical', () => {
    expect(alertInputForPaymentEvent({ eventType: 'cleaner_transfer_failed' })!.severity).toBe('warning');
    expect(alertInputForPaymentEvent({ eventType: 'cleaner_payout_bank_failed' })!.severity).toBe('warning');
    expect(alertInputForPaymentEvent({ eventType: 'unmatched_dispute' })!.severity).toBe('warning');
    expect(alertInputForPaymentEvent({ eventType: 'early_fraud_warning' })!.severity).toBe('warning');
    expect(alertInputForPaymentEvent({ eventType: 'radar_review_opened' })!.severity).toBe('warning');
  });

  it('excludes events that are not platform-owner-actionable', () => {
    // Homeowner card-save failure (Tier 2), and the ACH-only duplicate guard (Tier 3 / T3-1).
    expect(alertInputForPaymentEvent({ eventType: 'setup_intent_failed' })).toBeNull();
    expect(alertInputForPaymentEvent({ eventType: 'duplicate_charge_detected' })).toBeNull();
    // review.closed maps to a benign event that must not page.
    expect(alertInputForPaymentEvent({ eventType: 'radar_review_closed' })).toBeNull();
    // T3-12 forensic marker: our own partial-refund unwind emits it routinely.
    expect(alertInputForPaymentEvent({ eventType: 'transfer_partially_reversed' })).toBeNull();
  });

  it('every alertable key produces a non-empty summary', () => {
    for (const eventType of Object.keys(ALERTABLE_PAYMENT_EVENTS)) {
      const input = alertInputForPaymentEvent({ eventType });
      expect(input, eventType).not.toBeNull();
      expect(input!.summary.length, eventType).toBeGreaterThan(0);
    }
  });

  it('omits the amount fragment when amount is absent', () => {
    const input = alertInputForPaymentEvent({ eventType: 'tenant_transfer_failed', organizationId: 'org-2' });
    expect(input!.summary).not.toContain('$');
  });

  it('T1-14a: refund_ledger_write_failed is a critical, org-scoped alert', () => {
    const input = alertInputForPaymentEvent({
      eventType: 'refund_ledger_write_failed',
      organizationId: 'org-4',
      appointmentId: 'appt-1',
      amount: 5000,
      actor: 'user:admin-1',
    });
    expect(input).not.toBeNull();
    expect(input!.severity).toBe('critical');
    expect(input!.alert_type).toBe('payment_refund_ledger_write_failed:org-4');
  });

  it('T1-14a: late_payment_failure (settled ACH returned after payout) is critical', () => {
    const input = alertInputForPaymentEvent({
      eventType: 'late_payment_failure',
      organizationId: 'org-4',
      appointmentId: 'appt-2',
      amount: 12000,
      actor: 'webhook',
    });
    expect(input).not.toBeNull();
    expect(input!.severity).toBe('critical');
    expect(input!.alert_type).toBe('payment_late_payment_failure:org-4');
  });

  it('T1-15d: refund_unwind_manual_review keys per APPOINTMENT so two jobs cannot fold into one incident', () => {
    const a = alertInputForPaymentEvent({
      eventType: 'refund_unwind_manual_review',
      organizationId: 'org-9',
      appointmentId: 'appt-a',
      amount: 4000,
    });
    const b = alertInputForPaymentEvent({
      eventType: 'refund_unwind_manual_review',
      organizationId: 'org-9',
      appointmentId: 'appt-b',
      amount: 4000,
    });
    expect(a!.alert_type).toBe('payment_refund_unwind_manual_review:org-9:appt_appt-a');
    expect(b!.alert_type).toBe('payment_refund_unwind_manual_review:org-9:appt_appt-b');
    expect(a!.alert_type).not.toBe(b!.alert_type);
    // Same appointment re-emitted by the sweep still folds into one incident.
    const aAgain = alertInputForPaymentEvent({
      eventType: 'refund_unwind_manual_review',
      organizationId: 'org-9',
      appointmentId: 'appt-a',
      amount: 4000,
    });
    expect(aAgain!.alert_type).toBe(a!.alert_type);
  });

  it('T1-15d: non-keyByAppointment events keep the org-scoped key even with an appointment', () => {
    const input = alertInputForPaymentEvent({
      eventType: 'tenant_transfer_failed',
      organizationId: 'org-9',
      appointmentId: 'appt-a',
    });
    expect(input!.alert_type).toBe('payment_tenant_transfer_failed:org-9');
  });
});
