import { describe, it, expect } from 'vitest';
import { reconcileSweepAlerts } from './reconcileAlerts';

describe('reconcileSweepAlerts', () => {
  it('raises nothing on a clean sweep', () => {
    expect(reconcileSweepAlerts({ deadLetter: { retried: 3, recovered: 3, stillFailed: 0 } })).toEqual([]);
    expect(reconcileSweepAlerts({})).toEqual([]);
  });

  it('warns when webhook events are still failing after the dead-letter retry', () => {
    const alerts = reconcileSweepAlerts({ deadLetter: { retried: 5, recovered: 3, stillFailed: 2 } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_type).toBe('reconcile_dead_letter_stuck');
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].summary).toContain('2');
    expect(alerts[0].details).toEqual({ deadLetter: { retried: 5, recovered: 3, stillFailed: 2 } });
  });

  it('does not re-alert money-math violations (already alerted per-incident)', () => {
    // A sweep that found violations but drained its dead letters raises no sweep-level alert;
    // the per-event path (paymentEventAlerts) owns those.
    const alerts = reconcileSweepAlerts({
      deadLetter: { retried: 0, recovered: 0, stillFailed: 0 },
      moneyMath: { checked: 10, violations: 3 },
    });
    expect(alerts).toEqual([]);
  });
});
