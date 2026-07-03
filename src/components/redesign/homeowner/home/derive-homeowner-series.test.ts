import { describe, it, expect } from 'vitest';
import type { Appointment } from '@/hooks/useHomeownerData';
import { deriveHomeownerSeries } from './derive-homeowner-series';

const TODAY = '2026-07-03';

function appt(p: Partial<Appointment> & { id: string }): Appointment {
  return {
    scheduled_date: '2026-07-20',
    scheduled_time: '10:00',
    status: 'pending',
    total_price: 120,
    property: { name: 'Maple', address: '1 A St', city: 'Reno', state: 'NV' },
    service_type: { name: 'Regular Cleaning', description: '' },
    ...p,
  } as Appointment;
}

describe('deriveHomeownerSeries', () => {
  it('ignores standalone (no series_id) cleanings', () => {
    expect(deriveHomeownerSeries([appt({ id: 'a' })], TODAY)).toEqual([]);
  });

  it('groups >= 2 upcoming occurrences of a series, sorted by date', () => {
    const out = deriveHomeownerSeries(
      [
        appt({ id: 'b2', series_id: 'S1', scheduled_date: '2026-07-27' }),
        appt({ id: 'b1', series_id: 'S1', scheduled_date: '2026-07-20' }),
      ],
      TODAY,
    );
    expect(out).toHaveLength(1);
    expect(out[0].seriesId).toBe('S1');
    expect(out[0].count).toBe(2);
    expect(out[0].occurrences.map((o) => o.id)).toEqual(['b1', 'b2']);
    expect(out[0].startDate).toBe('2026-07-20');
    expect(out[0].endDate).toBe('2026-07-27');
  });

  it('does not group a lone remaining occurrence', () => {
    expect(deriveHomeownerSeries([appt({ id: 'c', series_id: 'S9' })], TODAY)).toEqual([]);
  });

  it('excludes past and terminal (completed/cancelled) occurrences', () => {
    const out = deriveHomeownerSeries(
      [
        appt({ id: 'past', series_id: 'S1', scheduled_date: '2026-06-01' }),
        appt({ id: 'done', series_id: 'S1', scheduled_date: '2026-07-20', status: 'completed' }),
        appt({ id: 'cancelled', series_id: 'S1', scheduled_date: '2026-07-27', status: 'cancelled' }),
        appt({ id: 'up1', series_id: 'S1', scheduled_date: '2026-08-03' }),
      ],
      TODAY,
    );
    // Only up1 is upcoming+non-terminal → lone occurrence → not grouped.
    expect(out).toEqual([]);
  });

  it('marks the series Awaiting confirmation when any occurrence is pending, else Confirmed', () => {
    const awaiting = deriveHomeownerSeries(
      [
        appt({ id: 'p1', series_id: 'S1', scheduled_date: '2026-07-20', status: 'pending' }),
        appt({ id: 'c1', series_id: 'S1', scheduled_date: '2026-07-27', status: 'confirmed' }),
      ],
      TODAY,
    );
    expect(awaiting[0].status).toEqual({ label: 'Awaiting confirmation', tone: 'caution' });

    const confirmed = deriveHomeownerSeries(
      [
        appt({ id: 'c1', series_id: 'S2', scheduled_date: '2026-07-20', status: 'confirmed' }),
        appt({ id: 'c2', series_id: 'S2', scheduled_date: '2026-07-27', status: 'confirmed' }),
      ],
      TODAY,
    );
    expect(confirmed[0].status).toEqual({ label: 'Confirmed', tone: 'secondary' });
  });

  it('sorts multiple series by start date', () => {
    const out = deriveHomeownerSeries(
      [
        appt({ id: 'l1', series_id: 'LATE', scheduled_date: '2026-09-01' }),
        appt({ id: 'l2', series_id: 'LATE', scheduled_date: '2026-09-08' }),
        appt({ id: 'e1', series_id: 'EARLY', scheduled_date: '2026-07-20' }),
        appt({ id: 'e2', series_id: 'EARLY', scheduled_date: '2026-07-27' }),
      ],
      TODAY,
    );
    expect(out.map((s) => s.seriesId)).toEqual(['EARLY', 'LATE']);
  });
});
