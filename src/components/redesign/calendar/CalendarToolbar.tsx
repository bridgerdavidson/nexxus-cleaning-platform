// src/components/redesign/calendar/CalendarToolbar.tsx
'use client';

import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { ViewMode } from '@/lib/calendar/types';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CleanerOption } from '@/components/redesign/bookings/bookings-types';

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' },
];

export const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function CalendarToolbar({
  view, rangeLabel, cleaners, cleanerFilter, statusFilter, canCreate,
  onView, onPrev, onNext, onToday, onCleanerFilter, onStatusFilter, onNewBooking,
}: {
  view: ViewMode;
  rangeLabel: string;
  cleaners: CleanerOption[];
  cleanerFilter: string;
  statusFilter: string;
  canCreate: boolean;
  onView: (v: ViewMode) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onCleanerFilter: (v: string) => void;
  onStatusFilter: (v: string) => void;
  onNewBooking: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon" aria-label="Previous" onClick={onPrev}><ChevronLeft className="size-4" /></Button>
        <Button variant="outline" size="sm" onClick={onToday}>Today</Button>
        <Button variant="outline" size="icon" aria-label="Next" onClick={onNext}><ChevronRight className="size-4" /></Button>
      </div>
      <span className="text-[15px] font-bold tabular-nums">{rangeLabel}</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={onView} />
        <Select value={cleanerFilter} onValueChange={onCleanerFilter}>
          <SelectTrigger className="h-9 w-auto gap-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All cleaners</SelectItem>
            {cleaners.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={onStatusFilter}>
          <SelectTrigger className="h-9 w-auto gap-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {canCreate ? <Button onClick={onNewBooking}><Plus className="size-4" /> New booking</Button> : null}
      </div>
    </div>
  );
}
