import { describe, it, expect } from 'vitest';
import { toJobThreadRowVM } from './jobThreadRow';

const NOW = new Date('2026-06-30T12:00:00Z');

const summary = {
  appointmentId: 'appt-1',
  conversationId: 'conv-1',
  lastMessageContent: 'Gate code is 1234',
  lastMessageAt: '2026-06-30T10:00:00Z',
  unreadCount: 2,
};

const appt = {
  id: 'appt-1',
  cleaner_id: 'cln-1',
  scheduled_date: '2026-10-15',
  homeowner: { first_name: 'John', last_name: 'Doe' },
  cleaner_profile: { user_profile: { first_name: 'Wanda', last_name: 'Jones' } },
};

describe('toJobThreadRowVM', () => {
  it('builds the title from the homeowner and cleaner names', () => {
    const vm = toJobThreadRowVM(summary, appt as never, NOW);
    expect(vm.title).toBe('John Doe and Wanda Jones');
    expect(vm.cleanerId).toBe('cln-1');
    expect(vm.preview).toBe('Gate code is 1234');
    expect(vm.unreadCount).toBe(2);
  });

  it('falls back to generic labels when the appointment is missing', () => {
    const vm = toJobThreadRowVM(summary, undefined, NOW);
    expect(vm.title).toBe('Homeowner and cleaner');
    expect(vm.cleanerId).toBeNull();
  });

  it('formats a short time-ago label', () => {
    const vm = toJobThreadRowVM(summary, appt as never, NOW);
    expect(vm.timeLabel).toBe('2h');
  });
});
