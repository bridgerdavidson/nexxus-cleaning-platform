import { describe, it, expect } from 'vitest';
import { derivePaymentAlerts } from './derivePaymentAlerts';
import type { Appointment } from '@/hooks/useHomeownerData';

function appt(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'a1',
    status: 'completed',
    scheduled_date: '2026-06-24',
    authorization_status: null,
    ...overrides,
  } as Appointment;
}

describe('derivePaymentAlerts', () => {
  it('creates a critical alert for a failed charge, including on completed cleanings', () => {
    const alerts = derivePaymentAlerts([appt({ authorization_status: 'failed' })]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tone).toBe('critical');
    expect(alerts[0].title).toBe('Payment failed');
    expect(alerts[0].description).toContain('June 24');
    expect(alerts[0].id).toBe('a1');
  });

  it('creates a caution alert for requires_action', () => {
    const alerts = derivePaymentAlerts([appt({ authorization_status: 'requires_action' })]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].tone).toBe('caution');
    expect(alerts[0].title).toBe('Confirm your payment');
  });

  it('ignores cancelled cleanings and healthy statuses', () => {
    const alerts = derivePaymentAlerts([
      appt({ id: 'c', status: 'cancelled', authorization_status: 'failed' }),
      appt({ id: 'ok', authorization_status: null }),
      appt({ id: 'captured', authorization_status: 'captured' }),
      appt({ id: 'charging', authorization_status: 'charging' }),
    ]);
    expect(alerts).toHaveLength(0);
  });

  it('never alarms the homeowner about a failed COMPANY-card (self-pay) charge', () => {
    const alerts = derivePaymentAlerts([
      appt({ id: 'comped', authorization_status: 'failed', is_self_pay: true }),
      appt({ id: 'comped2', authorization_status: 'requires_action', is_self_pay: true }),
    ]);
    expect(alerts).toHaveLength(0);
  });

  it('falls back to generic wording when the date is unparseable', () => {
    const alerts = derivePaymentAlerts([
      appt({ authorization_status: 'failed', scheduled_date: '' as Appointment['scheduled_date'] }),
    ]);
    expect(alerts[0].description).toContain('your recent cleaning');
  });
});
