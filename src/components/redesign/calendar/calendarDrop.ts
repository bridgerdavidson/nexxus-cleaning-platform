/**
 * Encodes/decodes @dnd-kit droppable ids for the calendar and maps a decoded
 * drop to a RescheduleInit that pre-seeds the shipped RescheduleDialog. Week/Day
 * grids drop onto a 15-min slot (date + minute); Month drops onto a whole day
 * (date only, the dialog keeps the job's current time).
 */
import { minutesToTimeString } from '@/lib/calendar/timeGrid';
import type { RescheduleInit } from '@/components/redesign/bookings/reschedule/RescheduleDialog';

export function encodeSlot(date: string, min: number): string {
  return `slot:${date}:${min}`;
}
export function encodeDay(date: string): string {
  return `day:${date}`;
}

export function decodeDropId(id: string | number | undefined | null): { date: string; min?: number } | null {
  if (typeof id !== 'string') return null;
  const parts = id.split(':');
  if (parts[0] === 'slot' && parts.length === 3) {
    const min = Number(parts[2]);
    if (!Number.isFinite(min)) return null;
    return { date: parts[1], min };
  }
  if (parts[0] === 'day' && parts.length === 2) {
    return { date: parts[1] };
  }
  return null;
}

export function dropToInit(decoded: { date: string; min?: number }): RescheduleInit {
  if (decoded.min == null) return { date: decoded.date };
  // minutesToTimeString gives "HH:MM:SS"; the dialog normalizes, and the tests
  // expect "HH:MM", so trim the seconds for a clean seed value.
  return { date: decoded.date, time: minutesToTimeString(decoded.min).slice(0, 5) };
}
