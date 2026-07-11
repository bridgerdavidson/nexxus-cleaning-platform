// src/components/redesign/calendar/AgendaView.tsx
'use client';

import { addDays } from 'date-fns';
import type { CalendarEvent } from '@/lib/calendar/types';
import { groupEventsByDate } from '@/lib/calendar/groupEvents';
import { toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { AgendaRow } from './AgendaRow';
import { EmptyState } from '@/components/ui/empty-state';
import { CalendarDays } from 'lucide-react';

const DAYS_AHEAD = 30;

function headerLabel(d: Date, now: Date): string {
  if (isSameDayLocal(d, now)) return 'Today';
  if (isSameDayLocal(d, addDays(now, 1))) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

export function AgendaView({
  events, focusedDate, nowMs, onOpen,
}: {
  events: CalendarEvent[];
  focusedDate: Date;
  nowMs: number;
  onOpen: (id: string) => void;
}) {
  const byDate = groupEventsByDate(events);
  const now = new Date(nowMs);
  const start = focusedDate;
  const groups: Array<{ key: string; date: Date; items: CalendarEvent[] }> = [];
  for (let i = 0; i < DAYS_AHEAD; i++) {
    const d = addDays(start, i);
    const key = toDateKey(d);
    const items = byDate.get(key);
    if (items && items.length) groups.push({ key, date: d, items });
  }

  if (groups.length === 0) {
    return <EmptyState icon={<CalendarDays />} title="Nothing scheduled" description="No cleanings in the next 30 days from this date." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="mb-2 text-[12.5px] font-extrabold text-foreground">{headerLabel(g.date, now)}</div>
          {g.items.map((ev) => <AgendaRow key={ev.id} event={ev} nowMs={nowMs} onOpen={onOpen} />)}
        </div>
      ))}
    </div>
  );
}
