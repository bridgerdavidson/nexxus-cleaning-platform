/**
 * Pure geometry for the Week/Day time-grids. Converts minutes-from-midnight to pixels and
 * back, snaps drop targets to a 15-minute lattice, and derives hour ticks + droppable slots
 * for a visible window. No DOM, no React; fully unit-tested.
 */
import type { BusinessHours } from './types';

/** Vertical scale: 0.8px per minute => a 60-min job is 48px, a 2-hour job 96px. */
export const PX_PER_MIN = 0.8;
/** Floor on a chip's rendered height so a 15-min job stays tappable/legible. */
export const MIN_EVENT_PX = 22;
/** Drop + slot granularity. */
export const DEFAULT_SNAP_MIN = 15;

/** Pixel offset (from the top of the grid) for a minute-of-day, given the window start. */
export function minutesToY(min: number, rangeStartMin: number): number {
  return (min - rangeStartMin) * PX_PER_MIN;
}

/** Inverse of {@link minutesToY}: a pixel offset back to minute-of-day. */
export function yToMinutes(y: number, rangeStartMin: number): number {
  return rangeStartMin + y / PX_PER_MIN;
}

/** Snap a minute value to the nearest `step` (default 15). */
export function snapMinutes(min: number, step: number = DEFAULT_SNAP_MIN): number {
  return Math.round(min / step) * step;
}

/** Clamp a minute value into `[lo, hi]`. */
export function clampMinutes(min: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, min));
}

/** Rendered height for an event block of `durationMin` minutes (floored at MIN_EVENT_PX). */
export function eventHeightPx(durationMin: number): number {
  return Math.max(MIN_EVENT_PX, durationMin * PX_PER_MIN);
}

/** Whole-hour tick marks (in minutes) that fall inside the window, e.g. [420, 480, ...]. */
export function buildHourTicks(hours: BusinessHours): number[] {
  const ticks: number[] = [];
  const firstHour = Math.ceil(hours.startMin / 60);
  const lastHour = Math.floor(hours.endMin / 60);
  for (let h = firstHour; h <= lastHour; h++) ticks.push(h * 60);
  return ticks;
}

/** Drop-slot start minutes across the window on a `step` lattice (end-exclusive). */
export function buildSlots(hours: BusinessHours, step: number = DEFAULT_SNAP_MIN): number[] {
  const slots: number[] = [];
  for (let m = hours.startMin; m < hours.endMin; m += step) slots.push(m);
  return slots;
}

/** Minutes-from-midnight to a `HH:MM:SS` string (the DB `scheduled_time` format). */
export function minutesToTimeString(min: number): string {
  const clamped = clampMinutes(Math.round(min), 0, 24 * 60 - 1);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}
