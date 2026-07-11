// src/components/redesign/calendar/AgendaRow.tsx
'use client';

import { Repeat } from 'lucide-react';
import type { CalendarEvent } from '@/lib/calendar/types';
import { Badge } from '@/components/ui/badge';
import { calendarStatus } from './calendarStatus';
import { fmtTime } from '@/components/redesign/bookings/booking-vm';

function durationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}
function initials(name: string | null): string {
  if (!name) return '?';
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function AgendaRow({ event, nowMs, onOpen }: { event: CalendarEvent; nowMs: number; onOpen: (id: string) => void }) {
  const s = calendarStatus(event, nowMs);
  return (
    <button
      type="button"
      onClick={() => onOpen(event.id)}
      className="mb-2 flex w-full items-center gap-3.5 rounded-control border border-border bg-card px-3.5 py-2.5 text-left shadow-soft-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="w-28 shrink-0">
        <div className="text-[12.5px] font-bold tabular-nums text-foreground">{fmtTime(event.start.toTimeString().slice(0, 5))}</div>
        <div className="text-[11px] text-muted-foreground">{durationLabel(event.durationMin)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1 text-sm font-bold">
          <span className="min-w-0 truncate">{event.customerLabel}</span>
          {event.seriesId ? <Repeat className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
        </div>
        <div className="truncate text-[12.5px] text-muted-foreground">{event.serviceLabel}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Badge variant={s.variant}>{s.label}</Badge>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-warm-700">
          <span className="grid size-[22px] place-items-center rounded-full bg-brand-600 text-[10px] font-extrabold text-white">{initials(event.cleanerName)}</span>
          {event.cleanerName ?? 'Unassigned'}
        </span>
      </div>
    </button>
  );
}
