import { describe, it, expect } from 'vitest';
import {
  PX_PER_MIN,
  MIN_EVENT_PX,
  minutesToY,
  yToMinutes,
  snapMinutes,
  clampMinutes,
  eventHeightPx,
  buildHourTicks,
  buildSlots,
  minutesToTimeString,
} from './timeGrid';

describe('timeGrid geometry', () => {
  it('maps minutes to pixels relative to the window start', () => {
    expect(minutesToY(420, 420)).toBe(0);
    expect(minutesToY(480, 420)).toBe(60 * PX_PER_MIN); // 48
  });

  it('round-trips minutes <-> pixels', () => {
    const start = 420;
    for (const m of [420, 435, 600, 1139]) {
      expect(yToMinutes(minutesToY(m, start), start)).toBeCloseTo(m, 6);
    }
  });

  it('snaps to the nearest 15-minute line', () => {
    expect(snapMinutes(420)).toBe(420);
    expect(snapMinutes(427)).toBe(420); // 28.47 -> 28
    expect(snapMinutes(428)).toBe(435); // 28.53 -> 29
    expect(snapMinutes(607, 30)).toBe(600);
  });

  it('clamps a minute into range', () => {
    expect(clampMinutes(300, 420, 1140)).toBe(420);
    expect(clampMinutes(1200, 420, 1140)).toBe(1140);
    expect(clampMinutes(600, 420, 1140)).toBe(600);
  });

  it('floors event height at MIN_EVENT_PX', () => {
    expect(eventHeightPx(60)).toBe(48);
    expect(eventHeightPx(10)).toBe(MIN_EVENT_PX); // 8px would be too short
  });

  it('builds whole-hour ticks inside the window', () => {
    expect(buildHourTicks({ startMin: 420, endMin: 1140 })).toEqual([
      420, 480, 540, 600, 660, 720, 780, 840, 900, 960, 1020, 1080, 1140,
    ]);
    // A 6:30 start does not produce a 6:00 tick.
    expect(buildHourTicks({ startMin: 390, endMin: 540 })).toEqual([420, 480, 540]);
  });

  it('builds drop slots on a step lattice, end-exclusive', () => {
    expect(buildSlots({ startMin: 420, endMin: 480 }, 15)).toEqual([420, 435, 450, 465]);
  });

  it('formats minutes to a HH:MM:SS time string', () => {
    expect(minutesToTimeString(540)).toBe('09:00:00');
    expect(minutesToTimeString(615)).toBe('10:15:00');
    expect(minutesToTimeString(0)).toBe('00:00:00');
    expect(minutesToTimeString(24 * 60)).toBe('23:59:00'); // clamped within the day
  });
});
