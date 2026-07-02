import { describe, it, expect } from 'vitest';
import { bookableTimeOptions, toYMD } from './time-options';

describe('bookableTimeOptions', () => {
  it('runs 8:00 to 18:00 on the hour with 12h labels', () => {
    const opts = bookableTimeOptions();
    expect(opts[0]).toEqual({ value: '08:00', label: '8:00 AM' });
    expect(opts.at(-1)).toEqual({ value: '18:00', label: '6:00 PM' });
    expect(opts).toHaveLength(11);
  });
});

describe('toYMD', () => {
  it('formats local date as YYYY-MM-DD', () => {
    expect(toYMD(new Date(2026, 6, 5))).toBe('2026-07-05');
  });
});
