/** The floating preview rendered inside @dnd-kit's DragOverlay while a chip is dragged. */
'use client';
import React from 'react';
import { format } from 'date-fns';
import { statusVisual } from '@/lib/calendar/eventColors';
import type { CalendarEvent } from '@/lib/calendar/types';

export default function CalendarDragLayer({ event }: { event: CalendarEvent }) {
  const v = statusVisual(event.status, {
    cleanerConfirmationStatus: event.cleanerConfirmationStatus,
    hasSuggestedTimes: event.hasSuggestedTimes,
  });
  return (
    <div
      className={`pointer-events-none w-44 rotate-2 rounded-md border border-black/10 px-2.5 py-1.5 shadow-xl ${v.chipClass}`}
    >
      <div className="truncate text-[11px] font-semibold">{event.customerLabel}</div>
      <div className="truncate text-[10px] tabular-nums opacity-80">
        {format(event.start, 'h:mm a')} &middot; {event.serviceLabel}
      </div>
    </div>
  );
}
