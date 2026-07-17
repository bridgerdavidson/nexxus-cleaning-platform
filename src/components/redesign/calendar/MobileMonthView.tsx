// src/components/redesign/calendar/MobileMonthView.tsx
'use client';

import { Plus } from 'lucide-react';
import type { CalendarEvent } from '@/lib/calendar/types';
import { cn } from '@/lib/utils';
import { monthMatrix, toDateKey, isSameDayLocal } from '@/lib/calendar/dateRange';
import { groupEventsByDate } from '@/lib/calendar/groupEvents';
import { Button } from '@/components/ui/button';
import { AgendaRow } from './AgendaRow';
import { monthCellSummary, type MonthCellSummary } from './monthCellSummary';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function cellAriaLabel(d: Date, count: number): string {
  const ds = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (count === 0) return `${ds}, no bookings`;
  return `${ds}, ${count} ${count === 1 ? 'booking' : 'bookings'}`;
}

function dayListLabel(d: Date, now: Date): string {
  const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  return isSameDayLocal(d, now) ? `Today · ${label}` : label;
}

function CellSignal({ summary }: { summary: MonthCellSummary }) {
  if (summary.kind === 'count') {
    return (
      <span className="text-[10px] font-extrabold leading-none tabular-nums text-brand-700">
        {summary.count}
      </span>
    );
  }
  if (summary.kind === 'dots') {
    return (
      <>
        {summary.dotClasses.map((c, i) => (
          <span key={i} className={cn('size-1.5 rounded-full', c)} />
        ))}
      </>
    );
  }
  return null;
}

/**
 * Mini month grid + selected-day booking list (mobile only; spec 2026-07-16).
 * Workload dots reuse the calendarStatus colors; today is the full brand chip
 * with white signals (its statuses are spelled out in the list below). The
 * day list reuses AgendaRow so tap-to-open matches the agenda everywhere.
 */
export function MobileMonthView({
  events, focusedDate, selectedKey, nowMs, canEdit, onSelectDay, onOpen, onCreate,
}: {
  events: CalendarEvent[];
  focusedDate: Date;
  selectedKey: string;
  nowMs: number;
  canEdit: boolean;
  onSelectDay: (key: string) => void;
  onOpen: (id: string) => void;
  onCreate: (date: string) => void;
}) {
  const cells = monthMatrix(focusedDate, 1);
  const byDate = groupEventsByDate(events);
  const month = focusedDate.getMonth();
  const now = new Date(nowMs);

  const selectedDate = cells.find((d) => toDateKey(d) === selectedKey) ?? focusedDate;
  const dayEvents = byDate.get(selectedKey) ?? [];

  return (
    <div className="pb-20">
      <div className="rounded-card border border-border bg-card p-2">
        <div className="grid grid-cols-7">
          {DOW.map((d) => (
            <div key={d} className="py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d) => {
            const key = toDateKey(d);
            const inMonth = d.getMonth() === month;
            const today = isSameDayLocal(d, now);
            const selected = key === selectedKey;
            const cellEvents = byDate.get(key) ?? [];
            const summary = monthCellSummary(cellEvents, nowMs);
            // Today and selected share one geometry (a size-7 circle on the number):
            // filled brand circle = today, muted ring = selected. Dots live below,
            // outside the circle, so they never crowd it and keep status colors
            // even on today.
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelectDay(key)}
                aria-label={cellAriaLabel(d, cellEvents.length)}
                aria-pressed={selected}
                className="flex min-h-11 flex-col items-center gap-1 rounded-control py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    'grid size-7 place-items-center rounded-full text-[13px] font-bold tabular-nums',
                    today
                      ? 'bg-brand-600 text-white'
                      : selected
                        ? 'bg-muted text-foreground ring-1 ring-border'
                        : inMonth
                          ? 'text-foreground'
                          : 'text-muted-foreground/50',
                  )}
                >
                  {d.getDate()}
                </span>
                <span className="flex h-1.5 items-center justify-center gap-0.5">
                  <CellSignal summary={summary} />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[12.5px] font-extrabold text-foreground">{dayListLabel(selectedDate, now)}</div>
        {dayEvents.length > 0 ? (
          dayEvents.map((ev) => <AgendaRow key={ev.id} event={ev} nowMs={nowMs} onOpen={onOpen} />)
        ) : (
          /* Deliberately compact (not the full EmptyState card) so the action
             stays clear of the shell FAB on short pages. */
          <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-card/50 px-6 py-6 text-center">
            <p className="text-sm font-semibold text-foreground">Nothing scheduled</p>
            {canEdit ? (
              <Button variant="secondary" size="sm" onClick={() => onCreate(selectedKey)}>
                <Plus /> Book this day
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
