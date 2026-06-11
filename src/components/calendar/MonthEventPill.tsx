/**
 * One compact line in a Month cell: status dot + time + customer, truncated to a single row.
 * Month cells show a few of these, then a "+N more" affordance handled by the cell.
 */
'use client';
import React from 'react';
import { format } from 'date-fns';
import type { CalendarEvent } from '@/lib/calendar/types';
import { statusVisual } from '@/lib/calendar/eventColors';

export default function MonthEventPill({
  event,
  onClick,
}: {
  event: CalendarEvent;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const v = statusVisual(event.status, {
    cleanerConfirmationStatus: event.cleanerConfirmationStatus,
    hasSuggestedTimes: event.hasSuggestedTimes,
  });
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${v.label}. ${event.customerLabel}. ${format(event.start, 'h:mm a')}`}
      className="flex w-full items-center gap-1 rounded px-1 py-[3px] text-left transition-colors duration-150 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${v.dotClass}`} aria-hidden="true" />
      <span className="shrink-0 text-[10px] tabular-nums text-gray-500">
        {format(event.start, 'h:mm')}
      </span>
      <span className="truncate text-[11px] font-medium text-gray-700">{event.customerLabel}</span>
    </button>
  );
}
