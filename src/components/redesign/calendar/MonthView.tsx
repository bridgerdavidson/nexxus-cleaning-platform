// src/components/redesign/calendar/MonthView.tsx
'use client';

import { useDroppable } from '@dnd-kit/core';
import type { CalendarEvent } from '@/lib/calendar/types';
import { monthMatrix, toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { groupEventsByDate } from '@/lib/calendar/groupEvents';
import { encodeDay } from './calendarDrop';
import { MonthEventPill } from './MonthEventPill';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PILLS = 3;

function DayCell({
  date, events, inMonth, today, nowMs, canEdit, onOpen, onCreate, onPickDay,
}: {
  date: Date; events: CalendarEvent[]; inMonth: boolean; today: boolean; nowMs: number; canEdit: boolean;
  onOpen: (id: string) => void; onCreate: (date: string) => void; onPickDay: (date: Date) => void;
}) {
  const key = toDateKey(date);
  const { setNodeRef } = useDroppable({ id: encodeDay(key), disabled: !canEdit });
  const shown = events.slice(0, MAX_PILLS);
  const extra = events.length - shown.length;
  return (
    <div
      ref={setNodeRef}
      onClick={() => canEdit && onCreate(key)}
      className={'flex min-h-[104px] flex-col gap-1 border-b border-r border-border/60 p-1.5 [&:nth-child(7n)]:border-r-0 ' + (inMonth ? '' : 'bg-muted/30 ') + (canEdit ? 'cursor-pointer' : '')}
    >
      <span className={'self-start text-[12.5px] font-bold tabular-nums ' + (today ? 'grid size-[22px] place-items-center rounded-full bg-brand-600 text-white' : inMonth ? 'text-foreground' : 'text-muted-foreground/60')}>
        {date.getDate()}
      </span>
      {shown.map((ev) => <MonthEventPill key={ev.id} event={ev} nowMs={nowMs} onOpen={onOpen} />)}
      {extra > 0 ? (
        <button type="button" onClick={(e) => { e.stopPropagation(); onPickDay(date); }} className="px-1.5 text-left text-[10.5px] font-bold text-brand-700">
          +{extra} more
        </button>
      ) : null}
    </div>
  );
}

export function MonthView({
  events, focusedDate, nowMs, canEdit, onOpen, onCreate, onPickDay,
}: {
  events: CalendarEvent[];
  focusedDate: Date;
  nowMs: number;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onCreate: (date: string) => void;
  onPickDay: (date: Date) => void;
}) {
  const cells = monthMatrix(focusedDate, 1);
  const byDate = groupEventsByDate(events);
  const month = focusedDate.getMonth();
  const now = new Date(nowMs);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card">
      <div className="grid grid-cols-7">
        {DOW.map((d) => (
          <div key={d} className="border-b border-r border-border/60 py-2 text-center text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground [&:nth-child(7)]:border-r-0">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d) => (
          <DayCell
            key={toDateKey(d)}
            date={d}
            events={byDate.get(toDateKey(d)) ?? []}
            inMonth={d.getMonth() === month}
            today={isSameDayLocal(d, now)}
            nowMs={nowMs}
            canEdit={canEdit}
            onOpen={onOpen}
            onCreate={onCreate}
            onPickDay={onPickDay}
          />
        ))}
      </div>
    </div>
  );
}
