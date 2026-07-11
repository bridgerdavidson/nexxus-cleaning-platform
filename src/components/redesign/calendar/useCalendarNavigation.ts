'use client';

import { useCallback, useState } from 'react';
import { addDays, addMonths } from 'date-fns';
import type { ViewMode } from '@/lib/calendar/types';

/** Pure date stepping per view (month by month, week/agenda by 7 days, day by 1). */
export function stepDate(view: ViewMode, date: Date, dir: -1 | 1): Date {
  switch (view) {
    case 'month':
      return addMonths(date, dir);
    case 'week':
    case 'agenda':
      return addDays(date, dir * 7);
    case 'day':
    default:
      return addDays(date, dir);
  }
}

export function useCalendarNavigation(initialView: ViewMode = 'week') {
  const [view, setView] = useState<ViewMode>(initialView);
  const [focusedDate, setFocusedDate] = useState<Date>(() => new Date());

  const next = useCallback(() => setFocusedDate((d) => stepDate(view, d, 1)), [view]);
  const prev = useCallback(() => setFocusedDate((d) => stepDate(view, d, -1)), [view]);
  const today = useCallback(() => setFocusedDate(new Date()), []);
  const goToDate = useCallback((d: Date) => setFocusedDate(d), []);

  return { view, focusedDate, setView, next, prev, today, goToDate };
}
