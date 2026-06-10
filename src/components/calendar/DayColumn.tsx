/**
 * A single vertical time column for one day (Week) or one cleaner (Day dispatch board).
 * Draws faint hour gridlines, then absolutely positions each event using the pure geometry +
 * overlap-lane helpers. The DnD droppable lattice is layered on in Phase 3; this component is
 * presentational.
 */
'use client';
import React from 'react';
import { packEventsIntoLanes } from '@/lib/calendar/overlapLayout';
import { buildHourTicks, minutesToY, eventHeightPx } from '@/lib/calendar/timeGrid';
import EventChip from './EventChip';
import type { CalendarEvent, BusinessHours } from '@/lib/calendar/types';

const LANE_GAP_PX = 2;

export default function DayColumn({
  events,
  hours,
  onEventClick,
  hideCleaner = false,
  className = '',
  draggingId,
}: {
  events: CalendarEvent[];
  hours: BusinessHours;
  onEventClick?: (event: CalendarEvent) => void;
  hideCleaner?: boolean;
  className?: string;
  draggingId?: string | null;
}) {
  const laid = packEventsIntoLanes(events);
  const ticks = buildHourTicks(hours);
  const height = minutesToY(hours.endMin, hours.startMin);

  return (
    <div className={`relative flex-1 ${className}`} style={{ height }}>
      {/* Hour gridlines */}
      {ticks.map((min) => (
        <div
          key={min}
          className="pointer-events-none absolute inset-x-0 border-t border-gray-100"
          style={{ top: minutesToY(min, hours.startMin) }}
          aria-hidden="true"
        />
      ))}

      {/* Events */}
      {laid.map((ev) => {
        const widthPct = 100 / ev.laneCount;
        const leftPct = ev.lane * widthPct;
        return (
          <EventChip
            key={ev.id}
            event={ev}
            hideCleaner={hideCleaner}
            isDragging={draggingId === ev.id}
            onClick={() => onEventClick?.(ev)}
            style={{
              top: minutesToY(ev.startMin, hours.startMin),
              height: eventHeightPx(ev.durationMin),
              left: `calc(${leftPct}% + ${LANE_GAP_PX}px)`,
              width: `calc(${widthPct}% - ${LANE_GAP_PX * 2}px)`,
            }}
          />
        );
      })}
    </div>
  );
}
