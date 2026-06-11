/** Groups events by their local date key, each bucket sorted by start time. */
import type { CalendarEvent } from './types';

export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const ev of events) {
    const arr = map.get(ev.date) ?? [];
    arr.push(ev);
    map.set(ev.date, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.startMin - b.startMin);
  return map;
}
