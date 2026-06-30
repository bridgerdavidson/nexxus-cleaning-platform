import { describe, it, expect } from 'vitest';
import { deriveCleanings } from './derive-cleanings';
import type { Appointment } from '@/hooks/useHomeownerData';

function appt(over: Partial<Appointment>): Appointment {
  return {
    id: 'a',
    scheduled_date: '2026-07-01',
    scheduled_time: '10:00:00',
    status: 'confirmed',
    total_price: 120,
    property: null,
    service_type: null,
    ...over,
  } as Appointment;
}

describe('deriveCleanings', () => {
  it('returns empty when there are no appointments', () => {
    const r = deriveCleanings([]);
    expect(r.isEmpty).toBe(true);
    expect(r.sections).toHaveLength(0);
    expect(r.total).toBe(0);
  });

  it('splits Upcoming (pending/confirmed/in_progress) from Past (completed/cancelled)', () => {
    const r = deriveCleanings([
      appt({ id: 'p', status: 'pending' }),
      appt({ id: 'c', status: 'confirmed' }),
      appt({ id: 'ip', status: 'in_progress' }),
      appt({ id: 'done', status: 'completed' }),
      appt({ id: 'x', status: 'cancelled' }),
    ]);
    const upcoming = r.sections.find((s) => s.key === 'upcoming');
    const past = r.sections.find((s) => s.key === 'past');
    expect(upcoming?.appointments.map((a) => a.id).sort()).toEqual(['c', 'ip', 'p']);
    expect(past?.appointments.map((a) => a.id).sort()).toEqual(['done', 'x']);
    expect(r.total).toBe(5);
    expect(r.isEmpty).toBe(false);
  });

  it('sorts Upcoming ascending and Past descending by date then time', () => {
    const r = deriveCleanings([
      appt({ id: 'u-late', status: 'confirmed', scheduled_date: '2026-07-10', scheduled_time: '09:00:00' }),
      appt({ id: 'u-soon', status: 'confirmed', scheduled_date: '2026-07-02', scheduled_time: '09:00:00' }),
      appt({ id: 'u-soon-am', status: 'confirmed', scheduled_date: '2026-07-02', scheduled_time: '08:00:00' }),
      appt({ id: 'p-old', status: 'completed', scheduled_date: '2026-06-01', scheduled_time: '09:00:00' }),
      appt({ id: 'p-recent', status: 'completed', scheduled_date: '2026-06-20', scheduled_time: '09:00:00' }),
    ]);
    expect(r.sections.find((s) => s.key === 'upcoming')?.appointments.map((a) => a.id)).toEqual([
      'u-soon-am', 'u-soon', 'u-late',
    ]);
    expect(r.sections.find((s) => s.key === 'past')?.appointments.map((a) => a.id)).toEqual([
      'p-recent', 'p-old',
    ]);
  });

  it('omits a section that has no appointments', () => {
    const r = deriveCleanings([appt({ id: 'c', status: 'confirmed' })]);
    expect(r.sections.map((s) => s.key)).toEqual(['upcoming']);
  });
});
