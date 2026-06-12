import { describe, it, expect } from 'vitest';
import { statusVisual, paymentProblemPill } from './eventColors';

describe('statusVisual', () => {
  it('maps each lifecycle status to its canonical color family', () => {
    expect(statusVisual('pending').key).toBe('amber');
    expect(statusVisual('confirmed').key).toBe('blue');
    expect(statusVisual('completed').key).toBe('emerald');
    expect(statusVisual('cancelled').key).toBe('slate');
  });

  it('keeps in_progress CYAN (guards the old purple drift)', () => {
    const v = statusVisual('in_progress');
    expect(v.key).toBe('cyan');
    expect(v.chipClass).toContain('cyan');
    expect(v.chipClass).not.toContain('purple');
  });

  it('surfaces counter-proposed when a cleaner rejected with suggested times', () => {
    expect(
      statusVisual('confirmed', { cleanerConfirmationStatus: 'rejected', hasSuggestedTimes: true }).key,
    ).toBe('orange');
  });

  it('collapses a hard decline back into pending', () => {
    expect(
      statusVisual('confirmed', { cleanerConfirmationStatus: 'rejected', hasSuggestedTimes: false }).key,
    ).toBe('amber');
  });

  it('falls back gracefully for an unknown status', () => {
    expect(statusVisual('weird_state').key).toBe('gray');
  });
});

describe('paymentProblemPill', () => {
  it('returns a pill only for a failed charge', () => {
    expect(paymentProblemPill('failed')?.label).toBe('Failed');
  });

  it('stays quiet for healthy / in-flight / not-yet-charged states', () => {
    expect(paymentProblemPill('paid')).toBeNull();
    expect(paymentProblemPill('processing')).toBeNull(); // Clearing (ACH in flight)
    expect(paymentProblemPill('refunded')).toBeNull();
    // "Unpaid" is normal for an upcoming job (it is charged at completion), so it is not flagged.
    expect(paymentProblemPill('pending')).toBeNull();
    expect(paymentProblemPill(null)).toBeNull();
  });
});
