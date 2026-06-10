/**
 * Day view = the by-cleaner dispatch board. One column per cleaner (roster order), plus an
 * Unassigned column when needed. Cleaner header sticks to the top, the time gutter sticks to
 * the left, and the board scrolls horizontally for large teams. Cross-cleaner drag-to-reassign
 * is layered on in Phase 4; this is the presentational shell.
 */
'use client';
import React, { useMemo } from 'react';
import { toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { deriveBusinessHours } from '@/lib/calendar/businessHours';
import { buildCleanerColumns } from '@/lib/calendar/dispatchColumns';
import TimeGutter from './TimeGutter';
import DayColumn from './DayColumn';
import NowIndicator from './NowIndicator';
import CalendarEmptyState from './CalendarEmptyState';
import type { CalendarEvent, CalendarCleaner } from '@/lib/calendar/types';

const AVATAR_COLORS = [
  'bg-rose-100 text-rose-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-cyan-100 text-cyan-700',
];

function initials(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export default function DayDispatchBoard({
  events,
  cleaners,
  currentDate,
  onEventClick,
  editable = false,
  isDragActive = false,
}: {
  events: CalendarEvent[];
  cleaners: CalendarCleaner[];
  currentDate: Date;
  onEventClick: (event: CalendarEvent) => void;
  editable?: boolean;
  isDragActive?: boolean;
}) {
  const dayKey = toDateKey(currentDate);
  const isToday = isSameDayLocal(currentDate, new Date());

  const dayEvents = useMemo(() => events.filter((e) => e.date === dayKey), [events, dayKey]);
  const hours = useMemo(
    () => deriveBusinessHours(dayEvents.map((e) => ({ startMin: e.startMin, durationMin: e.durationMin }))),
    [dayEvents],
  );
  const columns = useMemo(() => buildCleanerColumns(dayEvents, cleaners), [dayEvents, cleaners]);

  if (columns.length === 0) {
    return (
      <CalendarEmptyState
        title="No cleaners to dispatch"
        message="Add cleaners to your team to start assigning jobs on the board."
      />
    );
  }

  return (
    <div className="flex min-w-max flex-col">
      {/* Sticky cleaner header */}
      <div className="sticky top-0 z-20 flex border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="sticky left-0 z-10 w-14 shrink-0 bg-white/95" />
        {columns.map((col) => (
          <div
            key={col.cleaner?.id ?? 'unassigned'}
            className="flex w-[184px] shrink-0 items-center gap-2 border-r border-gray-100 px-3 py-2 last:border-r-0"
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                col.cleaner ? colorFor(col.cleaner.id) : 'bg-gray-100 text-gray-400'
              }`}
              aria-hidden="true"
            >
              {col.cleaner ? initials(col.cleaner.name) : '?'}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-800">
                {col.cleaner?.name ?? 'Unassigned'}
              </p>
              <p className="text-[11px] tabular-nums text-gray-400">
                {col.events.length} job{col.events.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Body */}
      <div className="flex">
        <TimeGutter hours={hours} className="sticky left-0 z-10 bg-white" />
        {columns.map((col) => (
          <div
            key={col.cleaner?.id ?? 'unassigned'}
            className="relative w-[184px] shrink-0 border-r border-gray-100 last:border-r-0"
          >
            {isToday && <NowIndicator hours={hours} />}
            <DayColumn
              events={col.events}
              hours={hours}
              onEventClick={onEventClick}
              hideCleaner
              editable={editable}
              isDragActive={isDragActive}
              // Cleaner columns get a 3-part slot id (cleaner + date + minute) so a cross-column
              // drop reassigns. The Unassigned column has no drop lattice (you assign OUT of it).
              slotPrefix={col.cleaner ? `${col.cleaner.id}:${dayKey}` : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
