/**
 * Left-hand hour labels for the Week/Day time-grids. Sticky so it stays visible while the grid
 * scrolls horizontally (dispatch board). Tabular figures keep the column from jittering.
 */
'use client';
import React from 'react';
import { format } from 'date-fns';
import { buildHourTicks, minutesToY } from '@/lib/calendar/timeGrid';
import type { BusinessHours } from '@/lib/calendar/types';

export default function TimeGutter({
  hours,
  className = '',
}: {
  hours: BusinessHours;
  className?: string;
}) {
  const ticks = buildHourTicks(hours);
  return (
    <div className={`relative w-14 shrink-0 select-none ${className}`} aria-hidden="true">
      {ticks.map((min) => (
        <div
          key={min}
          className="absolute right-2 -translate-y-1/2 text-[10px] font-medium uppercase tabular-nums text-gray-400"
          style={{ top: minutesToY(min, hours.startMin) }}
        >
          {format(new Date(2000, 0, 1, Math.floor(min / 60), min % 60), 'h a')}
        </div>
      ))}
    </div>
  );
}
