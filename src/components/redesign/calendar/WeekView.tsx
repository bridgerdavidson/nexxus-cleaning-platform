// src/components/redesign/calendar/WeekView.tsx
'use client';

import { useDroppable } from '@dnd-kit/core';
import type { CalendarEvent } from '@/lib/calendar/types';
import { deriveBusinessHours } from '@/lib/calendar/businessHours';
import { packEventsIntoLanes } from '@/lib/calendar/overlapLayout';
import { groupEventsByDate } from '@/lib/calendar/groupEvents';
import {
  buildHourTicks, buildSlots, minutesToY, eventHeightPx, PX_PER_MIN, minutesToTimeString,
} from '@/lib/calendar/timeGrid';
import { weekDays, toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
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

function DropSlot({ date, min, top }: { date: string; min: number; top: number }) {
  const { setNodeRef } = useDroppable({ id: encodeSlot(date, min) });
  return <div ref={setNodeRef} className="absolute inset-x-0" style={{ top, height: 15 * PX_PER_MIN }} />;
}

export function WeekView({
  events, focusedDate, nowMs, canEdit, onOpen, onCreate,
}: {
  events: CalendarEvent[];
  focusedDate: Date;
  nowMs: number;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onCreate: (date: string, time: string) => void;
}) {
  const days = weekDays(focusedDate, 1);
  const hours = deriveBusinessHours(events);
  const ticks = buildHourTicks(hours);
  const slots = buildSlots(hours);
  const gridHeight = minutesToY(hours.endMin, hours.startMin);
  const byDate = groupEventsByDate(events);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card">
      {/* headers */}
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(7, 1fr)` }}>
        <div className="border-b border-r border-border" />
        {days.map((d) => {
          const today = isSameDayLocal(d, new Date(nowMs));
          return (
            <div key={toDateKey(d)} className="border-b border-border px-2 py-2 text-center [&:not(:last-child)]:border-r [&:not(:last-child)]:border-border/60">
              <div className={'text-[11px] font-bold uppercase tracking-wide ' + (today ? 'text-brand-700' : 'text-muted-foreground')}>
                {d.toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
              <div className={'mt-0.5 text-base font-bold tabular-nums ' + (today ? 'mx-auto grid size-6 place-items-center rounded-full bg-brand-600 text-white' : '')}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      {/* body */}
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(7, 1fr)` }}>
        {/* time gutter */}
        <div className="relative border-r border-border/60" style={{ height: gridHeight }}>
          {ticks.map((m) => (
            <div key={m} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: minutesToY(m, hours.startMin) }}>
              {HOUR_LABEL(m)}
            </div>
          ))}
        </div>
        {/* day columns */}
        {days.map((d) => {
          const key = toDateKey(d);
          const today = isSameDayLocal(d, new Date(nowMs));
          const laid = packEventsIntoLanes(byDate.get(key) ?? []);
          const y = nowLineY(nowMs, key, hours);
          return (
            <div key={key} className={'relative [&:not(:last-child)]:border-r [&:not(:last-child)]:border-border/60 ' + (today ? 'bg-brand-600/[0.03]' : '')} style={{ height: gridHeight }}>
              {/* hour lines */}
              {ticks.map((m) => (
                <div key={m} className="absolute inset-x-0 border-b border-border/40" style={{ top: minutesToY(m, hours.startMin) }} />
              ))}
              {/* droppable slots + click-to-create */}
              {slots.map((m) => (
                <div key={m} className="absolute inset-x-0" style={{ top: minutesToY(m, hours.startMin), height: 15 * PX_PER_MIN }}>
                  {canEdit ? <DropSlot date={key} min={m} top={0} /> : null}
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`Create a booking at ${HOUR_LABEL(m)}`}
                      onClick={() => onCreate(key, minutesToTimeString(m).slice(0, 5))}
                      className="absolute inset-0 opacity-0"
                    />
                  ) : null}
                </div>
              ))}
              {/* events */}
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
          );
        })}
      </div>
    </div>
  );
}
