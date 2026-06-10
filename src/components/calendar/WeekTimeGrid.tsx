/**
 * Week view: a 7-day time-grid. All cleaners share one timeline (cleaner shown on the chip,
 * not as a column). The visible hour window is derived from the week's events. Header is
 * sticky; clicking a day header opens that day. NowIndicator rides today's column.
 */
'use client';
import React, { useMemo } from 'react';
import { format } from 'date-fns';
import { weekDays, toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { deriveBusinessHours } from '@/lib/calendar/businessHours';
import { groupEventsByDate } from '@/lib/calendar/groupEvents';
import TimeGutter from './TimeGutter';
import DayColumn from './DayColumn';
import NowIndicator from './NowIndicator';
import type { CalendarEvent } from '@/lib/calendar/types';

export default function WeekTimeGrid({
  events,
  currentDate,
  onEventClick,
  onDayOpen,
  editable = false,
  isDragActive = false,
  onSlotClick,
}: {
  events: CalendarEvent[];
  currentDate: Date;
  onEventClick: (event: CalendarEvent) => void;
  onDayOpen: (date: Date) => void;
  editable?: boolean;
  isDragActive?: boolean;
  onSlotClick?: (date: Date, minutes: number) => void;
}) {
  const days = weekDays(currentDate);
  const today = new Date();
  const dayKeys = days.map(toDateKey);

  const weekEvents = useMemo(
    () => events.filter((e) => dayKeys.includes(e.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, dayKeys.join('|')],
  );
  const hours = useMemo(
    () => deriveBusinessHours(weekEvents.map((e) => ({ startMin: e.startMin, durationMin: e.durationMin }))),
    [weekEvents],
  );
  const byDate = useMemo(() => groupEventsByDate(weekEvents), [weekEvents]);

  return (
    <div className="flex min-w-[760px] flex-col">
      {/* Sticky day header */}
      <div className="sticky top-0 z-20 flex border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="w-14 shrink-0" />
        {days.map((day) => {
          const isToday = isSameDayLocal(day, today);
          return (
            <button
              key={toDateKey(day)}
              type="button"
              onClick={() => onDayOpen(day)}
              className="flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {format(day, 'EEE')}
              </span>
              <span
                className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-sm font-semibold tabular-nums ${
                  isToday ? 'bg-primary-500 text-white' : 'text-gray-700'
                }`}
              >
                {day.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Scrollable body */}
      <div className="flex">
        <TimeGutter hours={hours} />
        {days.map((day) => {
          const key = toDateKey(day);
          const isToday = isSameDayLocal(day, today);
          return (
            <div key={key} className="relative flex-1 border-r border-gray-100 last:border-r-0">
              {isToday && <NowIndicator hours={hours} />}
              <DayColumn
                events={byDate.get(key) ?? []}
                hours={hours}
                onEventClick={onEventClick}
                editable={editable}
                isDragActive={isDragActive}
                slotPrefix={key}
                onSlotClick={onSlotClick ? (min) => onSlotClick(day, min) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
