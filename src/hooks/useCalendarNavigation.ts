/**
 * View + focused-date state for the calendar cockpit, with prev/next stepping that respects
 * the active view (month steps months, week steps weeks, day/agenda step days). URL persistence
 * is layered on in the BookingsPage integration (the Overview "today" glance deep-links here).
 */
import { useCallback, useState } from 'react';
import { addDays, addMonths, addWeeks } from 'date-fns';
import type { ViewMode } from '@/lib/calendar/types';

export interface CalendarNavigation {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  currentDate: Date;
  setCurrentDate: (d: Date) => void;
  goNext: () => void;
  goPrev: () => void;
  goToday: () => void;
}

export function useCalendarNavigation(
  initialView: ViewMode = 'week',
  initialDate?: Date,
): CalendarNavigation {
  const [view, setView] = useState<ViewMode>(initialView);
  const [currentDate, setCurrentDate] = useState<Date>(() => initialDate ?? new Date());

  const step = useCallback(
    (dir: 1 | -1) => {
      setCurrentDate((d) => {
        if (view === 'month') return addMonths(d, dir);
        if (view === 'week') return addWeeks(d, dir);
        return addDays(d, dir); // day + agenda advance one day at a time
      });
    },
    [view],
  );

  const goNext = useCallback(() => step(1), [step]);
  const goPrev = useCallback(() => step(-1), [step]);
  const goToday = useCallback(() => setCurrentDate(new Date()), []);

  return { view, setView, currentDate, setCurrentDate, goNext, goPrev, goToday };
}
