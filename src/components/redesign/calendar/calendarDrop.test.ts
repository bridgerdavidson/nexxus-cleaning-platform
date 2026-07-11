import { describe, expect, it } from 'vitest';
import { encodeSlot, encodeDay, decodeDropId, dropToInit } from './calendarDrop';

describe('calendarDrop', () => {
  it('round-trips a time slot', () => {
    expect(decodeDropId(encodeSlot('2026-07-10', 780))).toEqual({ date: '2026-07-10', min: 780 });
  });
  it('round-trips a whole-day target', () => {
    expect(decodeDropId(encodeDay('2026-07-10'))).toEqual({ date: '2026-07-10' });
  });
  it('returns null for a foreign id', () => {
    expect(decodeDropId('event:abc')).toBeNull();
    expect(decodeDropId(undefined)).toBeNull();
  });
  it('maps a slot drop to a reschedule init with HH:MM time', () => {
    expect(dropToInit({ date: '2026-07-10', min: 780 })).toEqual({ date: '2026-07-10', time: '13:00' });
  });
  it('maps a day drop to a date-only init (dialog keeps the current time)', () => {
    expect(dropToInit({ date: '2026-07-10' })).toEqual({ date: '2026-07-10' });
  });
});
