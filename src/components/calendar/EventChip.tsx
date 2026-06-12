/**
 * The time-grid event block (Week + Day dispatch board). Absolutely positioned by its parent
 * (top/height/left/width passed via `style`). Status drives the fill (canonical palette), a
 * left accent bar reinforces it, a recurring glyph marks series occurrences, and a small dot
 * flags a payment problem. Status is conveyed by label + color (never color alone).
 */
'use client';
import React from 'react';
import { Repeat } from 'lucide-react';
import { format } from 'date-fns';
import type { CalendarEvent } from '@/lib/calendar/types';
import { statusVisual, paymentProblemPill } from '@/lib/calendar/eventColors';

interface EventChipProps {
  event: CalendarEvent;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
  className?: string;
  /** Hide the cleaner line (e.g. on the dispatch board where the column already says who). */
  hideCleaner?: boolean;
  isDragging?: boolean;
  /** Ref for the @dnd-kit draggable node. */
  innerRef?: React.Ref<HTMLButtonElement>;
  /** Spread @dnd-kit listeners/attributes; presence also flips the cursor to grab. */
  dragHandleProps?: Record<string, unknown>;
}

export default function EventChip({
  event,
  onClick,
  style,
  className = '',
  hideCleaner = false,
  isDragging = false,
  innerRef,
  dragHandleProps,
}: EventChipProps) {
  const v = statusVisual(event.status, {
    cleanerConfirmationStatus: event.cleanerConfirmationStatus,
    hasSuggestedTimes: event.hasSuggestedTimes,
  });
  const pill = paymentProblemPill(event.paymentStatus);
  const dotClass = pill ? (/fail/i.test(pill.label) ? 'bg-red-500' : 'bg-amber-500') : '';
  const time = format(event.start, 'h:mm a');
  const isShort = event.durationMin <= 30;

  return (
    <button
      type="button"
      ref={innerRef}
      onClick={onClick}
      style={style}
      {...dragHandleProps}
      aria-label={`${v.label}. ${event.customerLabel}. ${time}. ${event.serviceLabel}${
        pill ? `. ${pill.label}` : ''
      }`}
      className={`absolute flex flex-col overflow-hidden rounded-md border border-black/[0.06] text-left shadow-sm transition-[box-shadow,transform] duration-150 hover:z-10 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${v.chipClass} ${
        dragHandleProps ? 'cursor-grab touch-none active:cursor-grabbing' : 'cursor-pointer'
      } ${isDragging ? 'opacity-40' : ''} ${className}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${v.barClass}`} aria-hidden="true" />
      {pill && (
        <span
          className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${dotClass}`}
          aria-hidden="true"
        />
      )}
      <div className="flex min-w-0 flex-col gap-0.5 py-1 pl-2.5 pr-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[11px] font-semibold leading-tight">
            {event.customerLabel}
          </span>
          {event.seriesId && (
            <Repeat className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden="true" />
          )}
        </div>
        {!isShort && (
          <div className="truncate text-[10px] leading-tight opacity-80">
            <span className="tabular-nums">{time}</span>
            <span className="opacity-70"> &middot; {event.serviceLabel}</span>
            {!hideCleaner && event.cleanerName && (
              <span className="opacity-70"> &middot; {event.cleanerName}</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
