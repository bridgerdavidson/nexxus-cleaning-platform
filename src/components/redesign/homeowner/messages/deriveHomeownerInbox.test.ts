import { describe, it, expect } from 'vitest';
import { deriveHomeownerInbox } from './deriveHomeownerInbox';
import type { ConversationWithDetails } from '@/types';
import type { Appointment } from '@/hooks/useHomeownerData';

const NOW = new Date('2026-06-30T18:00:00Z');
const ME = 'home-1';

function conv(over: Partial<ConversationWithDetails>): ConversationWithDetails {
  return {
    id: 'c', participant_1_id: ME, participant_2_id: 'other', appointment_id: null,
    last_message_at: '2026-06-30T17:00:00Z', created_at: '2026-06-01T00:00:00Z',
    other_participant: { id: 'other', first_name: 'A', last_name: 'B', role: 'cleaner', email: '', avatar_url: null } as never,
    last_message: null, last_message_attachment_count: 0, unread_count: 0,
    ...over,
  } as ConversationWithDetails;
}

function appt(over: Partial<Appointment>): Appointment {
  return {
    id: 'a', scheduled_date: '2026-06-30', scheduled_time: '14:00', status: 'in_progress',
    total_price: 100, property: null, service_type: null,
    cleaner_id: 'cl-1', cancelled_at: null, cleaner_confirmation_status: 'approved', completed_at: null,
    cleaner_profile: { user_profile: { first_name: 'Maria', last_name: 'Lopez', avatar_url: null } },
    ...over,
  } as Appointment;
}

describe('deriveHomeownerInbox', () => {
  it('returns the office row from an appointment_id=null conversation', () => {
    const m = deriveHomeownerInbox({
      officeRows: [conv({ id: 'office-c', appointment_id: null })],
      jobRows: [], appointmentsById: new Map(), now: NOW, currentUserId: ME,
    });
    expect(m.office.map((o) => o.id)).toContain('office-c');
    expect(m.office).toHaveLength(1);
    expect(m.active).toHaveLength(0);
    expect(m.past).toHaveLength(0);
  });

  it('returns ALL office threads, most-recent first', () => {
    const m = deriveHomeownerInbox({
      officeRows: [
        conv({ id: 'office-older', appointment_id: null, last_message_at: '2026-06-30T10:00:00Z' }),
        conv({ id: 'office-newer', appointment_id: null, last_message_at: '2026-06-30T16:00:00Z' }),
      ],
      jobRows: [], appointmentsById: new Map(), now: NOW, currentUserId: ME,
    });
    expect(m.office.map((o) => o.id)).toEqual(['office-newer', 'office-older']);
  });

  it('partitions an in-progress job thread into active', () => {
    const m = deriveHomeownerInbox({
      officeRows: [],
      jobRows: [conv({ id: 'job-c', appointment_id: 'a', unread_count: 2 })],
      appointmentsById: new Map([['a', appt({ id: 'a', status: 'in_progress' })]]),
      now: NOW, currentUserId: ME,
    });
    expect(m.active).toHaveLength(1);
    expect(m.active[0].conversationId).toBe('job-c');
    expect(m.active[0].cleanerName).toBe('Maria Lopez');
    expect(m.active[0].unreadCount).toBe(2);
    expect(m.past).toHaveLength(0);
  });

  it('partitions a cancelled job thread into past', () => {
    const m = deriveHomeownerInbox({
      officeRows: [],
      jobRows: [conv({ id: 'job-c', appointment_id: 'a' })],
      appointmentsById: new Map([['a', appt({ id: 'a', status: 'cancelled', cancelled_at: '2026-06-30T10:00:00Z' })]]),
      now: NOW, currentUserId: ME,
    });
    expect(m.active).toHaveLength(0);
    expect(m.past).toHaveLength(1);
  });

  it('drops a job thread whose appointment is not loaded', () => {
    const m = deriveHomeownerInbox({
      officeRows: [],
      jobRows: [conv({ id: 'job-c', appointment_id: 'missing' })],
      appointmentsById: new Map(), now: NOW, currentUserId: ME,
    });
    expect(m.active).toHaveLength(0);
    expect(m.past).toHaveLength(0);
  });

  it('sorts active by last message desc', () => {
    const m = deriveHomeownerInbox({
      officeRows: [],
      jobRows: [
        conv({ id: 'older', appointment_id: 'a1', last_message_at: '2026-06-30T10:00:00Z' }),
        conv({ id: 'newer', appointment_id: 'a2', last_message_at: '2026-06-30T16:00:00Z' }),
      ],
      appointmentsById: new Map([
        ['a1', appt({ id: 'a1', status: 'in_progress' })],
        ['a2', appt({ id: 'a2', status: 'in_progress' })],
      ]),
      now: NOW, currentUserId: ME,
    });
    expect(m.active.map((r) => r.conversationId)).toEqual(['newer', 'older']);
  });
});
