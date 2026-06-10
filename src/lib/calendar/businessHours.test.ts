import { describe, it, expect } from 'vitest';
import { deriveBusinessHours } from './businessHours';

const e = (startMin: number, durationMin: number) => ({ startMin, durationMin });

describe('deriveBusinessHours', () => {
  it('falls back to 7am-7pm with no events', () => {
    expect(deriveBusinessHours([])).toEqual({ startMin: 420, endMin: 1140 });
  });

  it('keeps the minimum 7am-7pm window for a mid-day job', () => {
    expect(deriveBusinessHours([e(480, 60)])).toEqual({ startMin: 420, endMin: 1140 });
  });

  it('widens the start down to the hour for an early job', () => {
    expect(deriveBusinessHours([e(6 * 60, 60)]).startMin).toBe(6 * 60);
    expect(deriveBusinessHours([e(5 * 60 + 30, 60)]).startMin).toBe(5 * 60);
  });

  it('widens the end up to the hour for a late job', () => {
    // 20:00 start, 90 min => ends 21:30 -> ceil to 22:00.
    expect(deriveBusinessHours([e(20 * 60, 90)]).endMin).toBe(22 * 60);
  });

  it('clamps to within a single day', () => {
    const r = deriveBusinessHours([e(0, 30), e(23 * 60 + 30, 90)]);
    expect(r.startMin).toBe(0);
    expect(r.endMin).toBe(24 * 60);
  });

  it('honors custom fallbacks', () => {
    expect(deriveBusinessHours([], { fallbackStartMin: 8 * 60, fallbackEndMin: 18 * 60 })).toEqual({
      startMin: 480,
      endMin: 1080,
    });
  });
});
