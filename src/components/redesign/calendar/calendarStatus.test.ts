// src/components/redesign/calendar/calendarStatus.test.ts
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/lib/calendar/types';
import { calendarStatus } from './calendarStatus';

const NOW = Date.parse('2026-07-10T12:00:00Z');
function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'a1', date: '2026-07-10', startMin: 780, durationMin: 90, endMin: 870,
    start: new Date(2026, 6, 10, 13, 0), status: 'pending',
    cleanerConfirmationStatus: 'awaiting', customerLabel: '12 Maple St',
    serviceLabel: 'Standard clean', cleanerId: 'cl1', cleanerName: 'Cleo C.',
    responseDeadline: null, ...over,
  };
}

describe('calendarStatus', () => {
  it('maps each status to the right badge variant + label', () => {
    expect(calendarStatus(ev({ status: 'pending' }), NOW)).toMatchObject({ variant: 'caution', label: 'Pending' });
    expect(calendarStatus(ev({ status: 'confirmed' }), NOW)).toMatchObject({ variant: 'secondary', label: 'Confirmed' });
    expect(calendarStatus(ev({ status: 'in_progress' }), NOW)).toMatchObject({ variant: 'info', label: 'In progress' });
    expect(calendarStatus(ev({ status: 'completed' }), NOW)).toMatchObject({ variant: 'positive', label: 'Completed', terminal: true });
    expect(calendarStatus(ev({ status: 'cancelled' }), NOW)).toMatchObject({ variant: 'secondary', label: 'Cancelled', terminal: true });
  });
  it('overrides a pending row to Overdue when the deadline passed', () => {
    const s = calendarStatus(ev({ status: 'pending', responseDeadline: '2026-07-10T10:00:00Z' }), NOW);
    expect(s).toMatchObject({ variant: 'critical', label: 'Overdue', overdue: true });
  });
  it('does not mark a future-deadline pending row overdue', () => {
    expect(calendarStatus(ev({ responseDeadline: '2026-07-10T14:00:00Z' }), NOW).overdue).toBe(false);
  });
});
