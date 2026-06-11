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
  it('returns a pill for money problems', () => {
    expect(paymentProblemPill(null, 'failed')?.label).toBe('Auth failed');
    expect(paymentProblemPill('failed', 'none')?.label).toBe('Failed');
    expect(paymentProblemPill(null, 'none')?.label).toBe('Unpaid');
    expect(paymentProblemPill(null, 'requires_action')?.label).toBe('Action needed');
  });

  it('stays quiet for healthy/in-flight states', () => {
    expect(paymentProblemPill('paid', 'captured')).toBeNull();
    expect(paymentProblemPill(null, 'authorized')).toBeNull(); // Card held is fine
    expect(paymentProblemPill('processing', 'none')).toBeNull(); // Clearing
    expect(paymentProblemPill('refunded', 'none')).toBeNull();
  });
});
