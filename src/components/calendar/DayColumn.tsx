/**
 * A single vertical time column for one day (Week) or one cleaner (Day dispatch board).
 * Draws faint hour gridlines, then absolutely positions each event using the pure geometry +
 * overlap-lane helpers. When `editable`, chips are draggable and, while a drag is active, a
 * 15-minute droppable lattice is mounted behind them (mounted only during drag for perf).
 */
'use client';
import React from 'react';
import { packEventsIntoLanes } from '@/lib/calendar/overlapLayout';
import {
  buildHourTicks,
  buildSlots,
  minutesToY,
  yToMinutes,
  snapMinutes,
  clampMinutes,
  eventHeightPx,
  PX_PER_MIN,
  DEFAULT_SNAP_MIN,
} from '@/lib/calendar/timeGrid';
import EventChip from './EventChip';
import DraggableEventChip from './DraggableEventChip';
import DropSlot from './DropSlot';
import type { CalendarEvent, BusinessHours } from '@/lib/calendar/types';

const LANE_GAP_PX = 2;

// Finished/cancelled jobs are read-only: don't let them be dragged (reschedule or reassign).
const TERMINAL_STATUSES = new Set(['completed', 'cancelled']);

export default function DayColumn({
  events,
  hours,
  onEventClick,
  hideCleaner = false,
  className = '',
  editable = false,
  isDragActive = false,
  slotPrefix,
  onSlotClick,
}: {
  events: CalendarEvent[];
  hours: BusinessHours;
  onEventClick?: (event: CalendarEvent) => void;
  hideCleaner?: boolean;
  className?: string;
  /** Chips become draggable. */
  editable?: boolean;
  /** A drag is in progress somewhere; mount the drop lattice. */
  isDragActive?: boolean;
  /** Prefix for drop-slot ids: `<date>` (week) or `<cleanerId>:<date>` (dispatch). */
  slotPrefix?: string;
  /** Click an empty area to create at that (15-min snapped) minute-of-day. */
  onSlotClick?: (minutes: number) => void;
}) {
  const laid = packEventsIntoLanes(events);
  const ticks = buildHourTicks(hours);
  const height = minutesToY(hours.endMin, hours.startMin);
  const slots =
    editable && isDragActive && slotPrefix ? buildSlots(hours, DEFAULT_SNAP_MIN) : [];
  const slotHeight = DEFAULT_SNAP_MIN * PX_PER_MIN;

  return (
    <div className={`relative flex-1 ${className}`} style={{ height }}>
      {/* Empty-area click-to-create layer (behind the chips; gridlines are pointer-events-none
          and the drop lattice is only mounted while dragging, so empty clicks land here). */}
      {onSlotClick && !isDragActive && (
        <div
          className="absolute inset-0 z-0 cursor-copy"
          onClick={(e) => {
            const minute = clampMinutes(
              snapMinutes(yToMinutes(e.nativeEvent.offsetY, hours.startMin)),
              hours.startMin,
              hours.endMin - DEFAULT_SNAP_MIN,
            );
            onSlotClick(minute);
          }}
          aria-hidden="true"
        />
      )}

      {/* Hour gridlines */}
      {ticks.map((min) => (
        <div
          key={min}
          className="pointer-events-none absolute inset-x-0 border-t border-gray-100"
          style={{ top: minutesToY(min, hours.startMin) }}
          aria-hidden="true"
        />
      ))}

      {/* Drop lattice (only while dragging) */}
      {slots.map((min) => (
        <DropSlot
          key={min}
          id={`slot:${slotPrefix}:${min}`}
          top={minutesToY(min, hours.startMin)}
          height={slotHeight}
        />
      ))}

      {/* Events */}
      {laid.map((ev) => {
        const widthPct = 100 / ev.laneCount;
        const leftPct = ev.lane * widthPct;
        const style: React.CSSProperties = {
          top: minutesToY(ev.startMin, hours.startMin),
          height: eventHeightPx(ev.durationMin),
          left: `calc(${leftPct}% + ${LANE_GAP_PX}px)`,
          width: `calc(${widthPct}% - ${LANE_GAP_PX * 2}px)`,
        };
        return editable ? (
          <DraggableEventChip
            key={ev.id}
            event={ev}
            hideCleaner={hideCleaner}
            onClick={() => onEventClick?.(ev)}
            style={style}
            disabled={TERMINAL_STATUSES.has(ev.status)}
          />
        ) : (
          <EventChip
            key={ev.id}
            event={ev}
            hideCleaner={hideCleaner}
            onClick={() => onEventClick?.(ev)}
            style={style}
          />
        );
      })}
    </div>
  );
}
