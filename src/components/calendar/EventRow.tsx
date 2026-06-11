/**
 * Agenda-list row (also reused by the Overview "today" glance). Richer than a grid chip: a
 * full StatusBadge + payment pill (reused from the rest of the app for consistency), the time
 * range, customer, service, and assigned cleaner. Comfortable 44px+ touch target.
 */
'use client';
import React from 'react';
import { Clock, User, Repeat } from 'lucide-react';
import { format, addMinutes } from 'date-fns';
import StatusBadge from '@/components/StatusBadge';
import { paymentStatusPill } from '@/lib/paymentStatusPill';
import { paymentProblemPill } from '@/lib/calendar/eventColors';
import type { CalendarEvent } from '@/lib/calendar/types';

export default function EventRow({
  event,
  onClick,
  showDate = false,
}: {
  event: CalendarEvent;
  onClick?: () => void;
  showDate?: boolean;
}) {
  const end = addMinutes(event.start, event.durationMin);
  const pill = paymentProblemPill(event.paymentStatus, event.authorizationStatus);
  const paymentChip = pill ?? paymentStatusPill(event.paymentStatus, event.authorizationStatus);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2.5 text-left transition-colors duration-150 hover:border-gray-200 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      <div className="flex w-20 shrink-0 flex-col">
        {showDate && (
          <span className="text-[11px] font-medium text-gray-400">
            {format(event.start, 'MMM d')}
          </span>
        )}
        <span className="text-sm font-semibold tabular-nums text-gray-900">
          {format(event.start, 'h:mm a')}
        </span>
        <span className="text-[11px] tabular-nums text-gray-400">
          {format(end, 'h:mm a')}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-gray-900">{event.customerLabel}</p>
          {event.seriesId && <Repeat className="h-3 w-3 shrink-0 text-gray-400" aria-hidden="true" />}
        </div>
        <p className="truncate text-xs text-gray-500">{event.serviceLabel}</p>
        {event.cleanerName && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-400">
            <User className="h-3 w-3 shrink-0" aria-hidden="true" />
            {event.cleanerName}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <StatusBadge
          status={event.status}
          size="sm"
          cleanerConfirmationStatus={event.cleanerConfirmationStatus}
          hasSuggestedTimes={event.hasSuggestedTimes}
        />
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${paymentChip.className}`}
        >
          {pill && <Clock className="h-3 w-3" aria-hidden="true" />}
          {paymentChip.label}
        </span>
      </div>
    </button>
  );
}
