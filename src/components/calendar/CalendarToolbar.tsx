'use client';
import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { weekDays } from '@/lib/calendar/dateRange';
import CalendarViewSwitcher from './CalendarViewSwitcher';
import type { ViewMode } from '@/lib/calendar/types';

function rangeLabel(view: ViewMode, date: Date): string {
  if (view === 'month') return format(date, 'MMMM yyyy');
  if (view === 'week') {
    const d = weekDays(date);
    return `${format(d[0], 'MMM d')} to ${format(d[6], 'MMM d, yyyy')}`;
  }
  return format(date, 'EEE, MMM d, yyyy'); // day + agenda
}

export default function CalendarToolbar({
  view,
  currentDate,
  onView,
  onPrev,
  onNext,
  onToday,
  hideViews = [],
  right,
}: {
  view: ViewMode;
  currentDate: Date;
  onView: (v: ViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  hideViews?: ViewMode[];
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToday}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          Today
        </button>
        <div className="flex items-center">
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous"
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next"
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <h2 className="text-base font-bold text-gray-900 sm:text-lg">{rangeLabel(view, currentDate)}</h2>
      </div>
      <div className="flex items-center gap-2">
        {right}
        <CalendarViewSwitcher view={view} onChange={onView} hide={hideViews} />
      </div>
    </div>
  );
}
