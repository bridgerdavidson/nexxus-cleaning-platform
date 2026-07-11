// src/components/redesign/calendar/DayView.tsx
'use client';

import { useDroppable } from '@dnd-kit/core';
import type { CalendarEvent } from '@/lib/calendar/types';
import { deriveBusinessHours } from '@/lib/calendar/businessHours';
import { packEventsIntoLanes } from '@/lib/calendar/overlapLayout';
import { buildHourTicks, buildSlots, minutesToY, eventHeightPx, PX_PER_MIN, minutesToTimeString } from '@/lib/calendar/timeGrid';
import { toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { encodeSlot } from './calendarDrop';
import { nowLineY } from './nowLine';
import { EventBlock } from './EventBlock';
import { NowIndicator } from './NowIndicator';

const HOUR_LABEL = (min: number) => {
  const h = Math.floor(min / 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ap}`;
};

function DropSlot({ date, min }: { date: string; min: number }) {
  const { setNodeRef } = useDroppable({ id: encodeSlot(date, min) });
  return <div ref={setNodeRef} className="absolute inset-0" />;
}

export function DayView({
  events, focusedDate, nowMs, canEdit, onOpen, onCreate,
}: {
  events: CalendarEvent[];
  focusedDate: Date;
  nowMs: number;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onCreate: (date: string, time: string) => void;
}) {
  const key = toDateKey(focusedDate);
  const dayEvents = events.filter((e) => e.date === key);
  const hours = deriveBusinessHours(dayEvents);
  const ticks = buildHourTicks(hours);
  const slots = buildSlots(hours);
  const gridHeight = minutesToY(hours.endMin, hours.startMin);
  const laid = packEventsIntoLanes(dayEvents);
  const today = isSameDayLocal(focusedDate, new Date(nowMs));
  const y = today ? nowLineY(nowMs, key, hours) : null;

  return (
    <div className="grid overflow-hidden rounded-card border border-border bg-card" style={{ gridTemplateColumns: '64px 1fr' }}>
      <div className="relative border-r border-border/60" style={{ height: gridHeight }}>
        {ticks.map((m) => (
          <div key={m} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: minutesToY(m, hours.startMin) }}>
            {HOUR_LABEL(m)}
          </div>
        ))}
      </div>
      {/* DISPATCH SEAM (hourly_external): render one lane per cleaner here via dispatchColumns.ts */}
      <div className="relative" style={{ height: gridHeight }}>
        {ticks.map((m) => (
          <div key={m} className="absolute inset-x-0 border-b border-border/40" style={{ top: minutesToY(m, hours.startMin) }} />
        ))}
        {slots.map((m) => (
          <div key={m} className="absolute inset-x-0" style={{ top: minutesToY(m, hours.startMin), height: 15 * PX_PER_MIN }}>
            {canEdit ? <DropSlot date={key} min={m} /> : null}
            {canEdit ? (
              <button type="button" aria-label={`Create a booking at ${HOUR_LABEL(m)}`} onClick={() => onCreate(key, minutesToTimeString(m).slice(0, 5))} className="absolute inset-0 opacity-0" />
            ) : null}
          </div>
        ))}
        {laid.map((ev) => (
          <EventBlock
            key={ev.id}
            event={ev}
            nowMs={nowMs}
            top={minutesToY(ev.startMin, hours.startMin)}
            height={eventHeightPx(ev.durationMin)}
            widthPct={100 / ev.laneCount}
            leftPct={(100 / ev.laneCount) * ev.lane}
            draggable={canEdit}
            onOpen={onOpen}
          />
        ))}
        {y != null ? <NowIndicator y={y} /> : null}
      </div>
    </div>
  );
}
