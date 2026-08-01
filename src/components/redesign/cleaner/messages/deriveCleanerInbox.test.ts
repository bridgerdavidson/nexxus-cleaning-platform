import { describe, it, expect, beforeAll } from 'vitest';
import { deriveCleanerInbox } from './deriveCleanerInbox';
import type { ConversationWithDetails } from '@/types';
import type { CleanerAppointment } from '@/hooks/useCleanerData';

beforeAll(() => {
  process.env.TZ = 'UTC';
});

const NOW = new Date('2026-06-30T18:00:00Z');

function conv(over: Partial<ConversationWithDetails>): ConversationWithDetails {
  return {
    id: 'c1',
    participant_1_id: 'cleaner',
    participant_2_id: 'ho',
    appointment_id: null,
    organization_id: 'org',
    created_at: '2026-06-01T00:00:00Z',
    last_message_at: '2026-06-29T00:00:00Z',
    other_participant: {
      id: 'ho',
      first_name: 'John',
      last_name: 'Doe',
      email: 'j@x.com',
      role: 'homeowner',
    } as never,
    last_message: null,
    last_message_attachment_count: 0,
    unread_count: 0,
    ...over,
  } as ConversationWithDetails;
}

function appt(over: Partial<CleanerAppointment>): CleanerAppointment {
  return {
    id: 'a1',
    scheduled_date: '2026-06-30',
    scheduled_time: '10:00',
    status: 'in_progress',
    cleaner_confirmation_status: 'approved',
    homeowner: { first_name: 'John', last_name: 'Doe', email: 'j@x.com' },
    property: null,
    service_type: null,
    ...over,
  } as CleanerAppointment;
}

describe('deriveCleanerInbox', () => {
  it('maps office threads (appointment_id null) into the office section', () => {
    const model = deriveCleanerInbox({
      officeRows: [conv({ id: 'o1', appointment_id: null })],
      jobRows: [],
      appointmentsById: new Map(),
      now: NOW,
      currentUserId: 'cleaner',
    });
    expect(model.office).toHaveLength(1);
    expect(model.active).toHaveLength(0);
    expect(model.past).toHaveLength(0);
  });

  it('puts an in_progress job in active with the homeowner name', () => {
    const jc = conv({ id: 'j1', appointment_id: 'a1' });
    const model = deriveCleanerInbox({
      officeRows: [],
      jobRows: [jc],
      appointmentsById: new Map([['a1', appt({ id: 'a1', status: 'in_progress' })]]),
      now: NOW,
      currentUserId: 'cleaner',
    });
    expect(model.active).toHaveLength(1);
    expect(model.active[0].homeownerName).toBe('John Doe');
    expect(model.active[0].appointmentId).toBe('a1');
    expect(model.past).toHaveLength(0);
  });

  it('puts a long-completed job in past (grace window elapsed)', () => {
    const jc = conv({ id: 'j1', appointment_id: 'a1' });
    const model = deriveCleanerInbox({
      officeRows: [],
      jobRows: [jc],
      appointmentsById: new Map([
        ['a1', appt({ id: 'a1', status: 'completed', completed_at: '2026-06-01T00:00:00Z' })],
      ]),
      now: NOW,
      currentUserId: 'cleaner',
    });
    expect(model.active).toHaveLength(0);
    expect(model.past).toHaveLength(1);
  });

  it('keeps a just-completed job in active (within 24h grace)', () => {
    const jc = conv({ id: 'j1', appointment_id: 'a1' });
    const model = deriveCleanerInbox({
      officeRows: [],
      jobRows: [jc],
      appointmentsById: new Map([
        ['a1', appt({ id: 'a1', status: 'completed', completed_at: '2026-06-30T12:00:00Z' })],
      ]),
      now: NOW,
      currentUserId: 'cleaner',
    });
    expect(model.active).toHaveLength(1);
  });

  it('drops a job thread whose appointment is not loaded', () => {
    const jc = conv({ id: 'j1', appointment_id: 'missing' });
    const model = deriveCleanerInbox({
      officeRows: [],
      jobRows: [jc],
      appointmentsById: new Map(),
      now: NOW,
      currentUserId: 'cleaner',
    });
    expect(model.active).toHaveLength(0);
    expect(model.past).toHaveLength(0);
  });

  it('falls back to "Homeowner" when the appointment has no homeowner', () => {
    const jc = conv({ id: 'j1', appointment_id: 'a1' });
    const model = deriveCleanerInbox({
      officeRows: [],
      jobRows: [jc],
      appointmentsById: new Map([['a1', appt({ id: 'a1', homeowner: null })]]),
      now: NOW,
      currentUserId: 'cleaner',
    });
    expect(model.active[0].homeownerName).toBe('Homeowner');
  });
});
