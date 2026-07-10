// src/lib/appointments/isResponseOverdue.test.ts
import { describe, expect, it } from 'vitest';
import { isResponseOverdue } from './isResponseOverdue';

const NOW = Date.parse('2026-06-19T12:00:00Z');
const base = {
  status: 'pending',
  cleaner_id: 'c1',
  cleaner_confirmation_status: 'awaiting',
  response_deadline: '2026-06-19T10:00:00Z',
};

describe('isResponseOverdue', () => {
  it('true for pending + assigned + awaiting + deadline passed', () => {
    expect(isResponseOverdue(base, NOW)).toBe(true);
  });
  it('false when the deadline is still in the future', () => {
    expect(isResponseOverdue({ ...base, response_deadline: '2026-06-19T14:00:00Z' }, NOW)).toBe(false);
  });
  it('false with no deadline', () => {
    expect(isResponseOverdue({ ...base, response_deadline: null }, NOW)).toBe(false);
  });
  it('false when not pending (confirmed/in_progress excluded)', () => {
    expect(isResponseOverdue({ ...base, status: 'confirmed' }, NOW)).toBe(false);
  });
  it('false when unassigned', () => {
    expect(isResponseOverdue({ ...base, cleaner_id: null }, NOW)).toBe(false);
  });
  it('false when the cleaner already answered (approved/rejected)', () => {
    expect(isResponseOverdue({ ...base, cleaner_confirmation_status: 'approved' }, NOW)).toBe(false);
    expect(isResponseOverdue({ ...base, cleaner_confirmation_status: 'rejected' }, NOW)).toBe(false);
  });
});
