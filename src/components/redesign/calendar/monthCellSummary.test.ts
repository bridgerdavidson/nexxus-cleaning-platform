// src/components/redesign/calendar/monthCellSummary.test.ts
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@/lib/calendar/types';
import { monthCellSummary, selectionForMonth } from './monthCellSummary';

const NOW = Date.parse('2026-07-10T12:00:00Z');
function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'a1', date: '2026-07-10', startMin: 780, durationMin: 90, endMin: 870,
    start: new Date(2026, 6, 10, 13, 0), status: 'confirmed',
    cleanerConfirmationStatus: null, customerLabel: '12 Maple St',
    serviceLabel: 'Standard clean', cleanerId: 'cl1', cleanerName: 'Cleo C.',
    responseDeadline: null, ...over,
  };
}

describe('monthCellSummary', () => {
  it('returns none for an empty day', () => {
    expect(monthCellSummary([], NOW)).toEqual({ kind: 'none' });
  });

  it('returns 1-3 status dots in start-time order, even from unsorted input', () => {
    const s = monthCellSummary(
      [ev({ id: 'b', startMin: 900, status: 'pending' }), ev({ id: 'a', startMin: 600, status: 'confirmed' })],
      NOW,
    );
    expect(s).toEqual({ kind: 'dots', dotClasses: ['bg-warm-400', 'bg-caution'] });
  });

  it('uses the overdue dot for a pending event whose deadline passed', () => {
    const s = monthCellSummary(
      [ev({ status: 'pending', cleanerConfirmationStatus: 'awaiting', responseDeadline: '2026-07-10T10:00:00Z' })],
      NOW,
    );
    expect(s).toEqual({ kind: 'dots', dotClasses: ['bg-critical'] });
  });

  it('swaps to a count at 4+', () => {
    const four = [1, 2, 3, 4].map((n) => ev({ id: String(n), startMin: 600 + n }));
    expect(monthCellSummary(four, NOW)).toEqual({ kind: 'count', count: 4 });
  });
});

describe('selectionForMonth', () => {
  it('picks today when the month contains it', () => {
    expect(selectionForMonth(new Date(2026, 6, 1), NOW)).toBe('2026-07-10');
  });

  it('picks the 1st for any other month', () => {
    expect(selectionForMonth(new Date(2026, 7, 15), NOW)).toBe('2026-08-01');
  });
});
