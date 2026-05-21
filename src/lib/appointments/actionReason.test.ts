import { describe, it, expect } from 'vitest';
import { deriveActionReason, isActionRequired, type ActionInput } from './actionReason';

const baseInput = (overrides: Partial<ActionInput> = {}): ActionInput => ({
  status: 'pending',
  request_state: null,
  cleaner_confirmation_status: null,
  cleaner_id: null,
  response_deadline: null,
  has_suggestions: false,
  ...overrides,
});

const fixedNow = new Date('2026-05-21T12:00:00Z');

describe('deriveActionReason', () => {
  it('returns null for cancelled appointments', () => {
    expect(
      deriveActionReason(baseInput({ status: 'cancelled', request_state: 'awaiting_admin' }), fixedNow),
    ).toBeNull();
  });

  it('returns null for completed appointments', () => {
    expect(
      deriveActionReason(baseInput({ status: 'completed', cleaner_confirmation_status: 'rejected' }), fixedNow),
    ).toBeNull();
  });

  it('returns awaiting_assignment when request_state is awaiting_admin', () => {
    expect(
      deriveActionReason(baseInput({ request_state: 'awaiting_admin' }), fixedNow),
    ).toBe('awaiting_assignment');
  });

  it('returns all_cleaners_declined when ccs=rejected and no cleaner', () => {
    expect(
      deriveActionReason(
        baseInput({ cleaner_confirmation_status: 'rejected', cleaner_id: null }),
        fixedNow,
      ),
    ).toBe('all_cleaners_declined');
  });

  it('returns counter_proposed when ccs=rejected, has cleaner, has suggestions', () => {
    expect(
      deriveActionReason(
        baseInput({
          cleaner_confirmation_status: 'rejected',
          cleaner_id: 'c1',
          has_suggestions: true,
        }),
        fixedNow,
      ),
    ).toBe('counter_proposed');
  });

  it('returns cleaner_declined when ccs=rejected, has cleaner, no suggestions', () => {
    expect(
      deriveActionReason(
        baseInput({
          cleaner_confirmation_status: 'rejected',
          cleaner_id: 'c1',
          has_suggestions: false,
        }),
        fixedNow,
      ),
    ).toBe('cleaner_declined');
  });

  it('returns cleaner_overdue when ccs=awaiting and deadline has passed', () => {
    expect(
      deriveActionReason(
        baseInput({
          status: 'pending',
          cleaner_confirmation_status: 'awaiting',
          cleaner_id: 'c1',
          response_deadline: '2026-05-20T12:00:00Z',
        }),
        fixedNow,
      ),
    ).toBe('cleaner_overdue');
  });

  it('returns null when ccs=awaiting and deadline is in the future', () => {
    expect(
      deriveActionReason(
        baseInput({
          status: 'pending',
          cleaner_confirmation_status: 'awaiting',
          cleaner_id: 'c1',
          response_deadline: '2026-05-22T12:00:00Z',
        }),
        fixedNow,
      ),
    ).toBeNull();
  });

  it('returns null when ccs=approved (confirmed appointment)', () => {
    expect(
      deriveActionReason(
        baseInput({ status: 'confirmed', cleaner_confirmation_status: 'approved' }),
        fixedNow,
      ),
    ).toBeNull();
  });

  it('precedence: request_state=awaiting_admin wins over a stale ccs=rejected', () => {
    expect(
      deriveActionReason(
        baseInput({
          request_state: 'awaiting_admin',
          cleaner_confirmation_status: 'rejected',
        }),
        fixedNow,
      ),
    ).toBe('awaiting_assignment');
  });
});

describe('isActionRequired', () => {
  it('mirrors deriveActionReason !== null', () => {
    expect(isActionRequired(baseInput({ request_state: 'awaiting_admin' }), fixedNow)).toBe(true);
    expect(isActionRequired(baseInput({ status: 'completed' }), fixedNow)).toBe(false);
  });
});
