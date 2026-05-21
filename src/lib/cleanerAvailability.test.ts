import { describe, it, expect } from 'vitest';
import {
  rankCleanersByAvailability,
  rankCleanersByMultiSlotCoverage,
  type CleanerLike,
} from './cleanerAvailability';
import type { ScheduleAppointment } from './appointmentConflicts';

const cleaner = (id: string, first: string, last = ''): CleanerLike => ({
  id,
  user_profile: { first_name: first, last_name: last },
});

const apt = (overrides: Partial<ScheduleAppointment>): ScheduleAppointment => ({
  id: 'a1',
  status: 'confirmed',
  scheduled_date: '2026-05-20',
  scheduled_time: '10:00',
  duration_minutes: 60,
  ...overrides,
});

describe('rankCleanersByAvailability', () => {
  it('returns all cleaners as available when schedules are empty', () => {
    const cleaners = [cleaner('a', 'Alice'), cleaner('b', 'Bob')];
    const result = rankCleanersByAvailability(cleaners, {}, {
      date: '2026-05-20',
      time: '10:00',
      durationMinutes: 60,
    });
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.isAvailable)).toBe(true);
    expect(result.every((r) => r.conflicts.length === 0)).toBe(true);
    expect(result.every((r) => r.nextFreeSlot === null)).toBe(true);
  });

  it('marks a cleaner unavailable when their schedule overlaps the candidate (4pm/4:30pm)', () => {
    const c = cleaner('wanda', 'Wanda');
    const schedules = {
      wanda: [apt({ id: 'x', scheduled_time: '16:00', duration_minutes: 60 })],
    };
    const [entry] = rankCleanersByAvailability([c], schedules, {
      date: '2026-05-20',
      time: '16:30',
      durationMinutes: 60,
    });
    expect(entry.isAvailable).toBe(false);
    expect(entry.conflicts).toHaveLength(1);
    expect(entry.nextFreeSlot).toEqual({ date: '2026-05-20', time: '17:00' });
  });

  it('sorts available cleaners ahead of unavailable, alphabetical within each bucket', () => {
    const cleaners = [
      cleaner('c', 'Charlie'),
      cleaner('a', 'Alice'),
      cleaner('b', 'Bob'),
      cleaner('d', 'Dana'),
    ];
    const schedules = {
      a: [apt({ id: 'x', scheduled_time: '10:00', duration_minutes: 60 })],
      c: [apt({ id: 'y', scheduled_time: '10:00', duration_minutes: 60 })],
    };
    const result = rankCleanersByAvailability(cleaners, schedules, {
      date: '2026-05-20',
      time: '10:00',
      durationMinutes: 60,
    });
    expect(result.map((r) => r.cleaner.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('treats missing schedule entries (cleaner has no appointments) as available', () => {
    const cleaners = [cleaner('a', 'Alice')];
    const result = rankCleanersByAvailability(cleaners, {}, {
      date: '2026-05-20',
      time: '10:00',
      durationMinutes: 60,
    });
    expect(result[0].isAvailable).toBe(true);
  });

  it('returns neutral (all available, no analysis) when candidate is null', () => {
    const cleaners = [cleaner('a', 'Alice'), cleaner('b', 'Bob')];
    const schedules = {
      a: [apt({ id: 'x', scheduled_time: '10:00', duration_minutes: 60 })],
    };
    const result = rankCleanersByAvailability(cleaners, schedules, null);
    expect(result.every((r) => r.isAvailable)).toBe(true);
    expect(result.every((r) => r.conflicts.length === 0)).toBe(true);
  });

  it('returns neutral when any of date/time/durationMinutes is missing or invalid', () => {
    const cleaners = [cleaner('a', 'Alice')];
    const schedules = {
      a: [apt({ id: 'x', scheduled_time: '10:00', duration_minutes: 60 })],
    };
    expect(
      rankCleanersByAvailability(cleaners, schedules, {
        date: '',
        time: '10:00',
        durationMinutes: 60,
      })[0].isAvailable,
    ).toBe(true);
    expect(
      rankCleanersByAvailability(cleaners, schedules, {
        date: '2026-05-20',
        time: '',
        durationMinutes: 60,
      })[0].isAvailable,
    ).toBe(true);
    expect(
      rankCleanersByAvailability(cleaners, schedules, {
        date: '2026-05-20',
        time: '10:00',
        durationMinutes: 0,
      })[0].isAvailable,
    ).toBe(true);
  });

  it('returns nextFreeSlot=null when no same-day opening fits', () => {
    const c = cleaner('a', 'Alice');
    const schedules = {
      a: [apt({ id: 'x', scheduled_time: '23:00', duration_minutes: 30 })],
    };
    const [entry] = rankCleanersByAvailability([c], schedules, {
      date: '2026-05-20',
      time: '23:00',
      durationMinutes: 120,
    });
    expect(entry.isAvailable).toBe(false);
    expect(entry.nextFreeSlot).toBeNull();
  });

  it('ignores cancelled/completed appointments when ranking', () => {
    const c = cleaner('a', 'Alice');
    const schedules = {
      a: [
        apt({ id: 'x', scheduled_time: '10:00', status: 'cancelled' }),
        apt({ id: 'y', scheduled_time: '10:00', status: 'completed' }),
      ],
    };
    const [entry] = rankCleanersByAvailability([c], schedules, {
      date: '2026-05-20',
      time: '10:00',
      durationMinutes: 60,
    });
    expect(entry.isAvailable).toBe(true);
    expect(entry.conflicts).toHaveLength(0);
  });
});

describe('rankCleanersByMultiSlotCoverage', () => {
  const slots = [
    { date: '2026-05-20', time: '10:00' },
    { date: '2026-05-21', time: '14:00' },
    { date: '2026-05-22', time: '09:00' },
  ];

  it('scores primary=2 and each alt=1 when fully free', () => {
    const c = cleaner('a', 'Alice');
    const result = rankCleanersByMultiSlotCoverage([c], {}, slots, 60);
    expect(result[0].score).toBe(4);
    expect(result[0].slotCoverage).toEqual({ primary: true, alt1: true, alt2: true });
  });

  it('strips primary points when primary slot is conflicted', () => {
    const c = cleaner('a', 'Alice');
    const schedules = {
      a: [apt({ id: 'x', scheduled_date: '2026-05-20', scheduled_time: '10:00' })],
    };
    const result = rankCleanersByMultiSlotCoverage([c], schedules, slots, 60);
    expect(result[0].score).toBe(2);
    expect(result[0].slotCoverage).toEqual({ primary: false, alt1: true, alt2: true });
  });

  it('returns zero score when every slot conflicts', () => {
    const c = cleaner('a', 'Alice');
    const schedules = {
      a: [
        apt({ id: 'x', scheduled_date: '2026-05-20', scheduled_time: '10:00' }),
        apt({ id: 'y', scheduled_date: '2026-05-21', scheduled_time: '14:00' }),
        apt({ id: 'z', scheduled_date: '2026-05-22', scheduled_time: '09:00' }),
      ],
    };
    const result = rankCleanersByMultiSlotCoverage([c], schedules, slots, 60);
    expect(result[0].score).toBe(0);
    expect(result[0].slotCoverage).toEqual({ primary: false, alt1: false, alt2: false });
  });

  it('breaks score ties by last-worked-this-property (recent first, nulls last)', () => {
    const cleaners = [
      cleaner('never', 'Alice'),
      cleaner('week', 'Bob'),
      cleaner('day', 'Carol'),
    ];
    const metrics = {
      never: { lastWorkedDaysAgo: null },
      week: { lastWorkedDaysAgo: 7 },
      day: { lastWorkedDaysAgo: 1 },
    };
    const result = rankCleanersByMultiSlotCoverage(cleaners, {}, slots, 60, metrics);
    expect(result.map((r) => r.cleaner.id)).toEqual(['day', 'week', 'never']);
  });

  it('falls back to alphabetical for total ties', () => {
    const cleaners = [
      cleaner('c', 'Charlie'),
      cleaner('a', 'Alice'),
      cleaner('b', 'Bob'),
    ];
    const result = rankCleanersByMultiSlotCoverage(cleaners, {}, slots, 60);
    expect(result.map((r) => r.cleaner.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops excluded cleaner ids before ranking', () => {
    const cleaners = [cleaner('a', 'Alice'), cleaner('b', 'Bob'), cleaner('c', 'Carol')];
    const result = rankCleanersByMultiSlotCoverage(
      cleaners,
      {},
      slots,
      60,
      {},
      ['b'],
    );
    expect(result.map((r) => r.cleaner.id)).toEqual(['a', 'c']);
  });

  it('handles a single offered slot (primary only) without alt scoring', () => {
    const c = cleaner('a', 'Alice');
    const result = rankCleanersByMultiSlotCoverage([c], {}, [slots[0]], 60);
    expect(result[0].score).toBe(2);
    expect(result[0].slotCoverage).toEqual({ primary: true, alt1: false, alt2: false });
  });

  it('skips slots missing date or time', () => {
    const c = cleaner('a', 'Alice');
    const result = rankCleanersByMultiSlotCoverage(
      [c],
      {},
      [{ date: '2026-05-20', time: '10:00' }, { date: '', time: '' }],
      60,
    );
    expect(result[0].score).toBe(2);
    expect(result[0].slotCoverage.alt1).toBe(false);
  });

  it('ranks free + recent above free + older above busy, regardless of how recently the busy one worked here', () => {
    // Screenshot scenario (primary-only request): Jane is free for the slot
    // and worked here today; Wanda worked here today too but is busy at the
    // requested time. Busy must rank below anyone who can take the job.
    const cleaners = [
      cleaner('jane', 'Jane', 'Smith'),
      cleaner('wanda', 'Wanda', 'Jones'),
      cleaner('charles', 'Charles', 'Brown'),
      cleaner('jordan', 'Jordan', 'Miles'),
    ];
    const primaryOnly = [slots[0]];
    const schedules = {
      wanda: [apt({ id: 'b', scheduled_date: '2026-05-20', scheduled_time: '10:00' })],
    };
    const metrics = {
      jane:    { lastWorkedDaysAgo: 0 },
      wanda:   { lastWorkedDaysAgo: 0 },
      charles: { lastWorkedDaysAgo: null },
      jordan:  { lastWorkedDaysAgo: 131 },
    };
    const result = rankCleanersByMultiSlotCoverage(cleaners, schedules, primaryOnly, 60, metrics);
    expect(result.map((r) => r.cleaner.id)).toEqual(['jane', 'jordan', 'charles', 'wanda']);
  });

  it('surfaces firstConflict (and its homeowner_name) for the first busy slot, null when fully free', () => {
    const cleaners = [cleaner('a', 'Alice'), cleaner('b', 'Bob')];
    const schedules = {
      a: [
        {
          id: 'conflict-1',
          status: 'confirmed',
          scheduled_date: '2026-05-20',
          scheduled_time: '10:00',
          duration_minutes: 60,
          homeowner_name: 'Acme Co',
        } as ScheduleAppointment,
      ],
    };
    const result = rankCleanersByMultiSlotCoverage(cleaners, schedules, slots, 60);
    const a = result.find((r) => r.cleaner.id === 'a')!;
    const b = result.find((r) => r.cleaner.id === 'b')!;
    expect(a.firstConflict?.id).toBe('conflict-1');
    expect(a.firstConflict?.homeowner_name).toBe('Acme Co');
    expect(b.firstConflict).toBeNull();
  });

  it('demotes zero-coverage cleaners below everyone with at least one free slot', () => {
    // Worked here today, but fully busy → must end up last regardless.
    const cleaners = [
      cleaner('busy', 'Busy', 'Bee'),
      cleaner('newcomer', 'Newcomer', 'Person'),
    ];
    const schedules = {
      busy: [
        apt({ id: 'p', scheduled_date: '2026-05-20', scheduled_time: '10:00' }),
        apt({ id: 'q', scheduled_date: '2026-05-21', scheduled_time: '14:00' }),
        apt({ id: 'r', scheduled_date: '2026-05-22', scheduled_time: '09:00' }),
      ],
    };
    const metrics = {
      busy:     { lastWorkedDaysAgo: 0 },
      newcomer: { lastWorkedDaysAgo: null },
    };
    const result = rankCleanersByMultiSlotCoverage(cleaners, schedules, slots, 60, metrics);
    expect(result.map((r) => r.cleaner.id)).toEqual(['newcomer', 'busy']);
  });

  it('weights the primary slot above an alternate at equal accept/recency', () => {
    // A covers Primary only (2 pts), B covers alt1 only (1 pt). Same metrics.
    const cleaners = [cleaner('a', 'Alice'), cleaner('b', 'Bob')];
    const schedules = {
      a: [
        apt({ id: 'a1', scheduled_date: '2026-05-21', scheduled_time: '14:00' }),
        apt({ id: 'a2', scheduled_date: '2026-05-22', scheduled_time: '09:00' }),
      ],
      b: [
        apt({ id: 'b1', scheduled_date: '2026-05-20', scheduled_time: '10:00' }),
        apt({ id: 'b2', scheduled_date: '2026-05-22', scheduled_time: '09:00' }),
      ],
    };
    const result = rankCleanersByMultiSlotCoverage(cleaners, schedules, slots, 60);
    expect(result.map((r) => r.cleaner.id)).toEqual(['a', 'b']);
    expect(result[0].score).toBe(2);
    expect(result[1].score).toBe(1);
  });
});
