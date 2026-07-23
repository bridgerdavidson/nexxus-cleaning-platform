import { describe, expect, it } from 'vitest';
import { previewCancelFee, feeLine, cancelToast, type CancelPolicy } from './deriveCancelBooking';

// Distinct late-cancel ($25) and no-show ($40) fees so the preview proves it threads the correct,
// independent policy (T1-6 / decision B).
const policy: CancelPolicy = {
  windowHours: 24,
  feeType: 'flat',
  feeValue: 25,
  noShowFeeType: 'flat',
  noShowFeeValue: 40,
};

type CancelAppt = Parameters<typeof previewCancelFee>[0];

function appt(overrides: Partial<CancelAppt> = {}): CancelAppt {
  // Far-future date, outside any window unless a test overrides it.
  const base: CancelAppt = {
    total_price: 100,
    scheduled_date: '2099-01-01',
    scheduled_time: '10:00:00',
    is_self_pay: false,
    status: 'confirmed',
  };
  return { ...base, ...overrides };
}

describe('previewCancelFee', () => {
  it('charges nothing for self-pay regardless of party and timing', () => {
    const r = previewCancelFee(appt({ is_self_pay: true, scheduled_date: '2020-01-01' }), policy, 'homeowner', true);
    expect(r.feeCents).toBe(0);
  });

  it('charges nothing when undoing a completed booking', () => {
    const r = previewCancelFee(appt({ status: 'completed', scheduled_date: '2020-01-01' }), policy, 'homeowner', true);
    expect(r.feeCents).toBe(0);
  });

  it('charges nothing for an on-time customer cancel', () => {
    expect(previewCancelFee(appt(), policy, 'homeowner', false).feeCents).toBe(0);
  });

  it('charges the flat NO-SHOW fee (not the late-cancel fee) for a customer no-show', () => {
    // Uses noShowFeeValue ($40 -> 4000), proving the preview reads the no-show policy, not feeValue.
    expect(previewCancelFee(appt(), policy, 'homeowner', true).feeCents).toBe(4000);
  });

  it('never charges for cleaner- or company-caused cancels', () => {
    const past = appt({ scheduled_date: '2020-01-01' });
    expect(previewCancelFee(past, policy, 'cleaner', false).feeCents).toBe(0);
    expect(previewCancelFee(past, policy, 'org', false).feeCents).toBe(0);
  });
});

describe('feeLine', () => {
  it('says no fee when zero', () => {
    expect(feeLine(0, 24, false)).toBe('No fee applies to this cancellation.');
  });

  it('names the no-show fee', () => {
    expect(feeLine(2500, 24, true)).toBe(
      "A $25.00 no-show fee will be charged to the customer's card on file.",
    );
  });

  it('explains the late-cancel window fee', () => {
    expect(feeLine(2500, 24, false)).toBe(
      "Cancelling within 24 hours of the appointment charges the customer a $25.00 fee on their card on file.",
    );
  });
});

describe('cancelToast', () => {
  it('plain cancel', () => {
    expect(cancelToast({ fee_captured_cents: 0 })).toEqual({ tone: 'success', message: 'Booking cancelled' });
  });

  it('fee charged', () => {
    expect(cancelToast({ fee_captured_cents: 2500, fee_outcome: 'charged' })).toEqual({
      tone: 'success',
      message: 'Booking cancelled. $25.00 fee charged.',
    });
  });

  it('fee declined keeps the cancel but warns with the card message', () => {
    expect(cancelToast({ fee_captured_cents: 0, fee_outcome: 'failed', fee_message: 'Card declined' })).toEqual({
      tone: 'warning',
      message: 'Booking cancelled, but the fee was not collected',
      description: 'Card declined',
    });
  });

  it('no card on file warns as uncollectable', () => {
    expect(cancelToast({ fee_captured_cents: 0, fee_outcome: 'uncollectable' })).toEqual({
      tone: 'warning',
      message: 'Booking cancelled, but the fee was not collected',
      description: 'No chargeable card on file for this customer.',
    });
  });

  it('in-flight bank debit explains the auto-refund', () => {
    expect(cancelToast({ fee_captured_cents: 0, inflight_debit: true, inflight_message: 'The bank payment in progress will be refunded when it settles.' })).toEqual({
      tone: 'success',
      message: 'Booking cancelled',
      description: 'The bank payment in progress will be refunded when it settles.',
    });
  });
});
