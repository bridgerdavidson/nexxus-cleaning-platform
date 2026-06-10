/**
 * Agenda view: upcoming appointments from the focused date, grouped by day with sticky-ish day
 * headers and rich EventRows. Reused (compact, with maxItems) as the Overview "today" glance.
 */
'use client';
import React, { useMemo } from 'react';
import { format, startOfDay } from 'date-fns';
import { fromDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { groupEventsByDate } from '@/lib/calendar/groupEvents';
import EventRow from './EventRow';
import CalendarEmptyState from './CalendarEmptyState';
import type { CalendarEvent } from '@/lib/calendar/types';

export default function AgendaList({
  events,
  currentDate,
  onEventClick,
  compact = false,
  maxItems,
}: {
  events: CalendarEvent[];
  currentDate: Date;
  onEventClick: (event: CalendarEvent) => void;
  compact?: boolean;
  maxItems?: number;
}) {
  const fromTime = startOfDay(currentDate).getTime();

  const upcoming = useMemo(
    () =>
      events
        .filter((e) => e.start.getTime() >= fromTime)
        .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin),
    [events, fromTime],
  );
  const limited = maxItems ? upcoming.slice(0, maxItems) : upcoming;
  const byDate = useMemo(() => groupEventsByDate(limited), [limited]);
  const keys = useMemo(() => Array.from(byDate.keys()).sort(), [byDate]);

  if (keys.length === 0) {
    return (
      <CalendarEmptyState
        title="Nothing scheduled"
        message="No upcoming appointments from this date forward."
      />
    );
  }

  const today = new Date();

  return (
    <div className={compact ? 'space-y-4' : 'space-y-6 p-1'}>
      {keys.map((key) => {
        const date = fromDateKey(key);
        const isToday = isSameDayLocal(date, today);
        const dayEvents = byDate.get(key) ?? [];
        return (
          <section key={key}>
            <div className="mb-2 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">
                {format(date, 'EEEE, MMMM d')}
              </h3>
              {isToday && (
                <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[11px] font-semibold text-primary-700">
                  Today
                </span>
              )}
              <span className="ml-auto text-xs tabular-nums text-gray-400">
                {dayEvents.length} appointment{dayEvents.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="space-y-1.5">
              {dayEvents.map((ev) => (
                <EventRow key={ev.id} event={ev} onClick={() => onEventClick(ev)} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
