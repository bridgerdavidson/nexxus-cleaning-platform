// src/lib/messaging/jobMessagingWindow.test.ts
import { describe, it, expect } from 'vitest';
import { isJobMessagingWindowOpen } from './jobMessagingWindow';

const now = new Date('2026-06-30T12:00:00Z');
const base = {
  status: 'confirmed',
  cleaner_confirmation_status: 'approved' as string | null,
  completed_at: null as string | null,
  cancelled_at: null as string | null,
};

describe('isJobMessagingWindowOpen', () => {
  it('open when confirmed and the cleaner has approved', () => {
    expect(isJobMessagingWindowOpen({ ...base, status: 'confirmed', cleaner_confirmation_status: 'approved' }, now)).toBe(true);
  });
  it('closed when confirmed but the cleaner has not accepted (awaiting)', () => {
    expect(isJobMessagingWindowOpen({ ...base, status: 'confirmed', cleaner_confirmation_status: 'awaiting' }, now)).toBe(false);
  });
  it('closed when confirmed but the cleaner rejected', () => {
    expect(isJobMessagingWindowOpen({ ...base, status: 'confirmed', cleaner_confirmation_status: 'rejected' }, now)).toBe(false);
  });
  it('open when in_progress regardless of confirmation bookkeeping', () => {
    expect(isJobMessagingWindowOpen({ ...base, status: 'in_progress', cleaner_confirmation_status: 'awaiting' }, now)).toBe(true);
  });
  it('closed when pending (incl. post-reassignment re-confirm gap)', () => {
    expect(isJobMessagingWindowOpen({ ...base, status: 'pending', cleaner_confirmation_status: 'awaiting' }, now)).toBe(false);
  });
  it('closed when status cancelled', () => {
    expect(isJobMessagingWindowOpen({ ...base, status: 'cancelled' }, now)).toBe(false);
  });
  it('closed when cancelled_at set even though status is confirmed+approved', () => {
    expect(
      isJobMessagingWindowOpen({ ...base, status: 'confirmed', cleaner_confirmation_status: 'approved', cancelled_at: '2026-06-30T11:00:00Z' }, now),
    ).toBe(false);
  });
  it('open within 24h after completion', () => {
    expect(
      isJobMessagingWindowOpen({ status: 'completed', cleaner_confirmation_status: 'approved', completed_at: '2026-06-30T01:00:00Z', cancelled_at: null }, now),
    ).toBe(true);
  });
  it('closed after the 24h grace window', () => {
    expect(
      isJobMessagingWindowOpen({ status: 'completed', cleaner_confirmation_status: 'approved', completed_at: '2026-06-29T11:00:00Z', cancelled_at: null }, now),
    ).toBe(false);
  });
  it('closed when completed without a completed_at timestamp', () => {
    expect(
      isJobMessagingWindowOpen({ status: 'completed', cleaner_confirmation_status: 'approved', completed_at: null, cancelled_at: null }, now),
    ).toBe(false);
  });
});
