/**
 * Dense month overview. A fixed 6-week grid; each cell shows the day number (today gets a
 * filled brand chip, out-of-month days dim) and up to a few event pills, then a "+N more" that
 * opens that day in Day view. Replaces the old "+8 more" pale bars.
 */
'use client';
import React, { useMemo } from 'react';
import { isSameMonth } from 'date-fns';
import { monthMatrix, toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import MonthEventPill from './MonthEventPill';
import type { CalendarEvent } from '@/lib/calendar/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_PILLS = 3;

export default function MonthView({
  events,
  currentDate,
  onEventClick,
  onDayOpen,
}: {
  events: CalendarEvent[];
  currentDate: Date;
  onEventClick: (event: CalendarEvent) => void;
  onDayOpen: (date: Date) => void;
}) {
  const days = monthMatrix(currentDate);
  const today = new Date();

  const byDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const arr = m.get(ev.date) ?? [];
      arr.push(ev);
      m.set(ev.date, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.startMin - b.startMin);
    return m;
  }, [events]);

  return (
    <div className="flex min-w-[680px] flex-col">
      <div className="grid grid-cols-7 border-b border-gray-200">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-400"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = toDateKey(day);
          const dayEvents = byDate.get(key) ?? [];
          const inMonth = isSameMonth(day, currentDate);
          const isToday = isSameDayLocal(day, today);
          return (
            <div
              key={key}
              className={`flex min-h-[112px] flex-col border-b border-r border-gray-100 p-1 ${
                inMonth ? 'bg-white' : 'bg-gray-50/60'
              }`}
            >
              <button
                type="button"
                onClick={() => onDayOpen(day)}
                className="mb-1 flex items-center justify-end focus:outline-none"
                aria-label={`Open ${toDateKey(day)}`}
              >
                <span
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums transition-colors ${
                    isToday
                      ? 'bg-primary-500 text-white'
                      : inMonth
                        ? 'text-gray-700 hover:bg-gray-100'
                        : 'text-gray-300 hover:bg-gray-100'
                  }`}
                >
                  {day.getDate()}
                </span>
              </button>
              <div className="flex flex-col gap-0.5">
                {dayEvents.slice(0, MAX_PILLS).map((ev) => (
                  <MonthEventPill key={ev.id} event={ev} onClick={() => onEventClick(ev)} />
                ))}
                {dayEvents.length > MAX_PILLS && (
                  <button
                    type="button"
                    onClick={() => onDayOpen(day)}
                    className="rounded px-1 py-[3px] text-left text-[11px] font-semibold text-primary-600 hover:bg-primary-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                  >
                    +{dayEvents.length - MAX_PILLS} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
