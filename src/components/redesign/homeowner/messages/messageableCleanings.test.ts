import { describe, it, expect } from 'vitest';
import { messageableCleanings } from './messageableCleanings';
import type { Appointment } from '@/hooks/useHomeownerData';

const NOW = new Date('2026-06-30T18:00:00Z');

function appt(over: Partial<Appointment>): Appointment {
  return {
    id: 'a',
    scheduled_date: '2026-06-30',
    scheduled_time: '14:00',
    status: 'in_progress',
    total_price: 100,
    property: null,
    service_type: null,
    cleaner_id: 'cl-1',
    cancelled_at: null,
    cleaner_confirmation_status: 'approved',
    completed_at: null,
    cleaner_profile: { user_profile: { first_name: 'Maria', last_name: 'Lopez', avatar_url: null } },
    ...over,
  } as Appointment;
}

describe('messageableCleanings', () => {
  it('includes an in_progress appt with a cleaner, with correct labels', () => {
    const result = messageableCleanings(
      [
        appt({
          id: 'x',
          status: 'in_progress',
          service_type: { name: 'Deep Clean' } as Appointment['service_type'],
        }),
      ],
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].appointmentId).toBe('x');
    expect(result[0].cleanerName).toBe('Maria Lopez');
    expect(result[0].dateLabel).toBeTruthy();
    expect(result[0].serviceLabel).toBe('Deep Clean');
  });

  it('includes confirmed + cleaner_confirmation_status=approved', () => {
    const result = messageableCleanings(
      [appt({ status: 'confirmed', cleaner_confirmation_status: 'approved' })],
      NOW,
    );
    expect(result).toHaveLength(1);
  });

  it('excludes confirmed + cleaner_confirmation_status=awaiting', () => {
    const result = messageableCleanings(
      [appt({ status: 'confirmed', cleaner_confirmation_status: 'awaiting' })],
      NOW,
    );
    expect(result).toHaveLength(0);
  });

  it('excludes cancelled appts', () => {
    const result = messageableCleanings(
      [appt({ status: 'cancelled', cancelled_at: '2026-06-29T10:00:00Z' })],
      NOW,
    );
    expect(result).toHaveLength(0);
  });

  it('excludes completed appts past the 24h grace, includes within grace', () => {
    const completedRecently = appt({
      id: 'recent',
      status: 'completed',
      completed_at: '2026-06-30T06:00:00Z', // 12h before NOW -> within 24h grace
    });
    const completedOld = appt({
      id: 'old',
      status: 'completed',
      completed_at: '2026-06-28T18:00:00Z', // 48h before NOW -> outside grace
    });
    const result = messageableCleanings([completedRecently, completedOld], NOW);
    expect(result).toHaveLength(1);
    expect(result[0].appointmentId).toBe('recent');
  });

  it('excludes appts with no cleaner_id', () => {
    const result = messageableCleanings(
      [appt({ cleaner_id: null })],
      NOW,
    );
    expect(result).toHaveLength(0);
  });

  it('returns results sorted by scheduled_date ascending (soonest first)', () => {
    const a1 = appt({ id: 'a1', scheduled_date: '2026-07-02' });
    const a2 = appt({ id: 'a2', scheduled_date: '2026-06-30' });
    const a3 = appt({ id: 'a3', scheduled_date: '2026-07-01' });
    const result = messageableCleanings([a1, a2, a3], NOW);
    expect(result.map((r) => r.appointmentId)).toEqual(['a2', 'a3', 'a1']);
  });
});
