// src/components/redesign/calendar/MobileCalendarBar.tsx
'use client';

import { ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';

export type MobileCalendarView = 'month' | 'agenda';

const VIEWS: { value: MobileCalendarView; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'agenda', label: 'Upcoming' },
];

/**
 * Compact two-row mobile calendar header (spec 2026-07-16): month label +
 * date stepping on top, view toggle + filter trigger below. The New-booking
 * CTA is deliberately absent; the shell FAB owns creation on mobile.
 */
export function MobileCalendarBar({
  view, rangeLabel, filtersActive, onView, onPrev, onNext, onToday, onOpenFilters,
}: {
  view: MobileCalendarView;
  rangeLabel: string;
  filtersActive: boolean;
  onView: (v: MobileCalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onOpenFilters: () => void;
}) {
  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h1 className="min-w-0 truncate text-xl font-bold tabular-nums tracking-tight">{rangeLabel}</h1>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="outline" size="icon" className="size-11" aria-label="Previous" onClick={onPrev}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" className="h-11" onClick={onToday}>Today</Button>
          <Button variant="outline" size="icon" className="size-11" aria-label="Next" onClick={onNext}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <SegmentedControl options={VIEWS} value={view} onChange={onView} />
        <Button variant="outline" size="icon" className="relative size-11" aria-label="Filters" onClick={onOpenFilters}>
          <Filter className="size-4" />
          {filtersActive ? (
            <span aria-hidden className="absolute right-2.5 top-2.5 size-2 rounded-full bg-brand-600" />
          ) : null}
        </Button>
      </div>
    </div>
  );
}
