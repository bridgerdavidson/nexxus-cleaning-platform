import { describe, it, expect } from 'vitest';
import { EMPTY_OPERATOR_BOOKING, type OperatorBookingState } from './operator-booking-types';
import {
  isRecurring,
  weekdayOfYmd,
  resolveCadence,
  resolveEnd,
  buildOccurrenceInput,
  previewOccurrences,
  cadencePhrase,
  recurrenceRecap,
} from './deriveRecurrence';

// 2026-07-20 is a Monday (weekday 1) in every timezone.
const MON = '2026-07-20';

function withRec(
  partial: Partial<OperatorBookingState['recurrence']>,
  base?: Partial<OperatorBookingState>,
): OperatorBookingState {
  return {
    ...EMPTY_OPERATOR_BOOKING,
    customerId: 'cust-1',
    slots: [{ date: MON, time: '10:00' }],
    ...base,
    recurrence: { ...EMPTY_OPERATOR_BOOKING.recurrence, ...partial },
  };
}

describe('isRecurring', () => {
  it('is false when disabled', () => {
    expect(isRecurring(withRec({ enabled: false }))).toBe(false);
  });
  it('is true when enabled and customer-billed', () => {
    expect(isRecurring(withRec({ enabled: true }))).toBe(true);
  });
  it('is false in self-pay even when enabled', () => {
    expect(isRecurring(withRec({ enabled: true }, { billTo: 'self_pay' }))).toBe(false);
  });
});

describe('weekdayOfYmd (TZ-safe)', () => {
  it('returns Monday for 2026-07-20 regardless of timezone', () => {
    expect(weekdayOfYmd('2026-07-20')).toBe(1);
  });
});

describe('resolveCadence', () => {
  it('weekly preset -> weekly interval 1, day defaults to start weekday', () => {
    expect(resolveCadence({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'weekly' }, MON)).toEqual({
      recurrenceType: 'weekly',
      interval: 1,
      daysOfWeek: [1],
    });
  });
  it('biweekly preset -> weekly interval 2', () => {
    expect(resolveCadence({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'biweekly' }, MON).interval).toBe(2);
  });
  it('every4 preset -> weekly interval 4', () => {
    expect(resolveCadence({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'every4' }, MON).interval).toBe(4);
  });
  it('explicit daysOfWeek override the default and are sorted', () => {
    expect(
      resolveCadence({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'weekly', daysOfWeek: [5, 1] }, MON).daysOfWeek,
    ).toEqual([1, 5]);
  });
  it('custom monthly -> daysOfWeek undefined', () => {
    const r = resolveCadence(
      { ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'custom', customType: 'monthly', customInterval: 3 },
      MON,
    );
    expect(r).toEqual({ recurrenceType: 'monthly', interval: 3, daysOfWeek: undefined });
  });
});

describe('resolveEnd', () => {
  it('after -> maxOccurrences set, endDate null', () => {
    expect(resolveEnd({ ...EMPTY_OPERATOR_BOOKING.recurrence, end: 'after', count: 6 })).toEqual({
      endDate: null,
      maxOccurrences: 6,
    });
  });
  it('on_date -> endDate set, maxOccurrences null', () => {
    expect(resolveEnd({ ...EMPTY_OPERATOR_BOOKING.recurrence, end: 'on_date', endDate: '2026-09-01' })).toEqual({
      endDate: '2026-09-01',
      maxOccurrences: null,
    });
  });
  it('keep_going -> both null', () => {
    expect(resolveEnd({ ...EMPTY_OPERATOR_BOOKING.recurrence, end: 'keep_going' })).toEqual({
      endDate: null,
      maxOccurrences: null,
    });
  });
});

describe('previewOccurrences (TZ-safe; mirrors server date-fns stepping + caps)', () => {
  it('weekly, after 4, keeps the exact start date string', () => {
    const input = buildOccurrenceInput(withRec({ enabled: true, preset: 'weekly', end: 'after', count: 4 }), 120)!;
    expect(previewOccurrences(input)).toEqual(['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10']);
  });
  it('biweekly, after 3', () => {
    const input = buildOccurrenceInput(withRec({ enabled: true, preset: 'biweekly', end: 'after', count: 3 }), 120)!;
    expect(previewOccurrences(input)).toEqual(['2026-07-20', '2026-08-03', '2026-08-17']);
  });
  it('custom monthly interval 1, after 3', () => {
    const input = buildOccurrenceInput(
      withRec({ enabled: true, preset: 'custom', customType: 'monthly', customInterval: 1, end: 'after', count: 3 }),
      120,
    )!;
    expect(previewOccurrences(input)).toEqual(['2026-07-20', '2026-08-20', '2026-09-20']);
  });
  it('respects the on-date end (inclusive)', () => {
    const input = buildOccurrenceInput(
      withRec({ enabled: true, preset: 'weekly', end: 'on_date', endDate: '2026-08-03' }),
      120,
    )!;
    expect(previewOccurrences(input)).toEqual(['2026-07-20', '2026-07-27', '2026-08-03']);
  });
  it('caps keep-going at 50 occurrences', () => {
    const input = buildOccurrenceInput(
      withRec({ enabled: true, preset: 'custom', customType: 'daily', customInterval: 1, end: 'keep_going' }),
      120,
    )!;
    expect(previewOccurrences(input).length).toBe(50);
  });
  it('month-end monthly clamps to end-of-month like the server (date-fns addMonths, no setMonth overflow)', () => {
    // Jan 31 must step to Feb 28 (clamp), not overflow to Mar 3. Once clamped, it sticks to the 28th,
    // exactly mirroring the server generateOccurrences (which steps with date-fns addMonths in UTC).
    const s: OperatorBookingState = {
      ...EMPTY_OPERATOR_BOOKING,
      customerId: 'cust-1',
      slots: [{ date: '2026-01-31', time: '10:00' }],
      recurrence: {
        ...EMPTY_OPERATOR_BOOKING.recurrence,
        enabled: true,
        preset: 'custom',
        customType: 'monthly',
        customInterval: 1,
        end: 'after',
        count: 6,
      },
    };
    const input = buildOccurrenceInput(s, 120)!;
    expect(previewOccurrences(input)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-28',
      '2026-04-28',
      '2026-05-28',
      '2026-06-28',
    ]);
  });
});

describe('recurrenceRecap', () => {
  it('composes cadence + time + count + range with no em dashes', () => {
    const rec = { ...EMPTY_OPERATOR_BOOKING.recurrence, enabled: true, preset: 'biweekly' as const, daysOfWeek: [1] };
    const dates = ['2026-07-20', '2026-08-03', '2026-08-17'];
    const recap = recurrenceRecap(rec, MON, '10:00', dates);
    expect(recap).toBe('Every 2 weeks on Mondays at 10:00 AM. 3 cleanings, Jul 20 to Aug 17.');
    expect(recap).not.toContain('—');
  });
  it('singularizes a single cleaning', () => {
    const rec = { ...EMPTY_OPERATOR_BOOKING.recurrence, enabled: true, preset: 'weekly' as const };
    expect(recurrenceRecap(rec, MON, '09:00', ['2026-07-20'])).toBe(
      'Every week on Mondays at 9:00 AM. 1 cleaning, Jul 20.',
    );
  });
});

describe('cadencePhrase', () => {
  it('weekly interval 1', () => {
    expect(cadencePhrase({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'weekly' }, MON)).toBe('Every week on Mondays');
  });
  it('custom daily interval 3', () => {
    expect(
      cadencePhrase({ ...EMPTY_OPERATOR_BOOKING.recurrence, preset: 'custom', customType: 'daily', customInterval: 3 }, MON),
    ).toBe('Every 3 days');
  });
});
