// src/components/redesign/calendar/EventBlock.tsx
'use client';

import { Repeat } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { Badge } from '@/components/ui/badge';
import type { CalendarEvent } from '@/lib/calendar/types';
import { fmtTime } from '@/components/redesign/bookings/booking-vm';
import { calendarStatus } from './calendarStatus';

/** Below this rendered height a job shows the compact single-row layout. */
export function isCompactHeight(px: number): boolean {
  return px < 64;
}

/** At or above this rendered height the full layout also shows the service label. */
const SERVICE_LABEL_MIN_PX = 78;

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function EventBlock({
  event,
  nowMs,
  top,
  height,
  widthPct,
  leftPct,
  draggable,
  onOpen,
}: {
  event: CalendarEvent;
  nowMs: number;
  top: number;
  height: number;
  widthPct: number;
  leftPct: number;
  draggable: boolean;
  onOpen: (id: string) => void;
}) {
  const status = calendarStatus(event, nowMs);
  const compact = isCompactHeight(height);
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `event:${event.id}`,
    disabled: !draggable || status.terminal,
    data: { eventId: event.id },
  });

  const timeLabel = `${fmtTime(event.start.toTimeString().slice(0, 5))}`;

  return (
    <div
      ref={setNodeRef}
      // pointer-drag only: keyboard Enter/Space opens the event (onKeyDown below); keyboard reschedule is via the detail sheet's Reschedule dialog
      {...(draggable && !status.terminal ? listeners : {})}
      role="button"
      tabIndex={0}
      aria-label={`${status.label}. ${event.customerLabel}. ${timeLabel}${event.serviceLabel ? '. ' + event.serviceLabel : ''}`}
      onClick={() => onOpen(event.id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen(event.id);
        }
      }}
      className={
        'absolute flex flex-col overflow-hidden rounded-control border border-border bg-card px-2 py-1.5 text-left shadow-soft-sm ' +
        'transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
        (draggable && !status.terminal ? 'cursor-grab ' : 'cursor-pointer ') +
        (status.terminal ? 'opacity-70 ' : '') +
        (isDragging ? 'opacity-40 ' : '')
      }
      style={{ top, height, left: `${leftPct}%`, width: `calc(${widthPct}% - 6px)`, minHeight: 42 }}
    >
      {compact ? (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden title={status.label} className={`size-2 shrink-0 rounded-full ${status.dotClass}`} />
            <span className="min-w-0 flex-1 truncate text-xs font-bold text-foreground">{event.customerLabel}</span>
            <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-brand-600 text-[9px] font-extrabold text-white">
              {initials(event.cleanerName)}
            </span>
          </div>
          <div className="truncate text-[10.5px] font-semibold tabular-nums text-muted-foreground">{timeLabel}</div>
        </>
      ) : (
        <>
          <div className="truncate text-[10.5px] font-semibold tabular-nums text-muted-foreground">{timeLabel}</div>
          <div className="flex min-w-0 items-center gap-1 text-[12.5px] font-bold leading-tight">
            <span className="min-w-0 truncate">{event.customerLabel}</span>
            {event.seriesId ? <Repeat className="size-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
          </div>
          {height >= SERVICE_LABEL_MIN_PX ? <div className="truncate text-[11px] text-muted-foreground">{event.serviceLabel}</div> : null}
          <div className="mt-auto flex items-center gap-1.5 pt-1">
            <Badge variant={status.variant}>{status.label}</Badge>
            <span className="ml-auto grid size-[18px] shrink-0 place-items-center rounded-full bg-brand-600 text-[9px] font-extrabold text-white">
              {initials(event.cleanerName)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
