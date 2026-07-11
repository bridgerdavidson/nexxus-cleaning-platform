// src/components/redesign/calendar/deriveCalendar.test.ts
import { describe, expect, it } from 'vitest';
import type { AdminAppointment } from '@/hooks/useAdminData';
import { toCalendarEvent, deriveCalendarEvents } from './deriveCalendar';

function appt(over: Partial<AdminAppointment> = {}): AdminAppointment {
  return {
    id: 'a1',
    scheduled_date: '2026-07-10',
    scheduled_time: '13:00:00',
    duration_minutes: 90,
    status: 'confirmed',
    total_price: 120,
    homeowner: { first_name: 'Hank', last_name: 'Homeowner', email: 'h@x.com' },
    property: { name: '12 Maple St', address: '12 Maple St', city: 'X', state: 'YZ' },
    service_type: { name: 'Standard clean', description: '' },
    cleaner_id: 'cl1',
    cleaner_profile: { user_profile: { id: 'cl1', first_name: 'Cleo', last_name: 'Cleaner' } },
    cleaner_confirmation_status: 'approved',
    series_id: null,
    ...over,
  } as AdminAppointment;
}

describe('toCalendarEvent', () => {
  it('parses time to minutes and builds end/label fields', () => {
    const ev = toCalendarEvent(appt());
    expect(ev.startMin).toBe(780);          // 13:00
    expect(ev.durationMin).toBe(90);
    expect(ev.endMin).toBe(870);
    expect(ev.customerLabel).toBe('Hank Homeowner');
    expect(ev.serviceLabel).toBe('Standard clean');
    expect(ev.cleanerName).toBe('Cleo Cleaner');
    expect(ev.cleanerId).toBe('cl1');
  });
  it('defaults a missing/zero duration to 60', () => {
    expect(toCalendarEvent(appt({ duration_minutes: undefined })).durationMin).toBe(60);
    expect(toCalendarEvent(appt({ duration_minutes: 0 })).durationMin).toBe(60);
  });
  it('appends the checklist name to the service label when present', () => {
    const ev = toCalendarEvent(appt({ checklist: { name: 'Deep', price_adder: 20 } }));
    expect(ev.serviceLabel).toBe('Standard clean (Deep)');
  });
  it('carries responseDeadline through', () => {
    expect(toCalendarEvent(appt({ response_deadline: '2026-07-10T10:00:00Z' })).responseDeadline)
      .toBe('2026-07-10T10:00:00Z');
  });
});

describe('deriveCalendarEvents', () => {
  it('dedupes by id', () => {
    expect(deriveCalendarEvents([appt(), appt(), appt({ id: 'a2' })])).toHaveLength(2);
  });
});
