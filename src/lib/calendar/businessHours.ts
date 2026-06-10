/**
 * Derives the visible vertical window for the Week/Day time-grids from the events actually on
 * screen. Replaces the old hard-coded 2024 / 6am-10pm window. Always covers at least 7am-7pm
 * and widens (to whole hours) to fit an early-morning or late-night job. Clamped to [0, 1440].
 */
import type { BusinessHours } from './types';

interface DeriveOpts {
  /** Latest the window may start (default 7:00). */
  fallbackStartMin?: number;
  /** Earliest the window may end (default 19:00). */
  fallbackEndMin?: number;
}

const floorHour = (m: number) => Math.floor(m / 60) * 60;
const ceilHour = (m: number) => Math.ceil(m / 60) * 60;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function deriveBusinessHours(
  events: Array<{ startMin: number; durationMin: number }>,
  opts: DeriveOpts = {},
): BusinessHours {
  const fallbackStart = opts.fallbackStartMin ?? 7 * 60;
  const fallbackEnd = opts.fallbackEndMin ?? 19 * 60;

  if (events.length === 0) {
    return { startMin: fallbackStart, endMin: fallbackEnd };
  }

  let earliest = Infinity;
  let latest = -Infinity;
  for (const e of events) {
    earliest = Math.min(earliest, e.startMin);
    latest = Math.max(latest, e.startMin + e.durationMin);
  }

  // Start no later than the fallback; widen down (to the hour) for an early job.
  const startMin = clamp(Math.min(fallbackStart, floorHour(earliest)), 0, fallbackStart);
  // End no earlier than the fallback; widen up (to the hour) for a late job.
  const endMin = clamp(Math.max(fallbackEnd, ceilHour(latest)), fallbackEnd, 24 * 60);

  return { startMin, endMin };
}
