'use client';
import React from 'react';
import type { ViewMode } from '@/lib/calendar/types';

const VIEWS: Array<{ key: ViewMode; label: string }> = [
  { key: 'month', label: 'Month' },
  { key: 'week', label: 'Week' },
  { key: 'day', label: 'Day' },
  { key: 'agenda', label: 'Agenda' },
];

export default function CalendarViewSwitcher({
  view,
  onChange,
  hide = [],
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
  /** Views to omit (e.g. on mobile). */
  hide?: ViewMode[];
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-gray-100 p-1" role="tablist" aria-label="Calendar view">
      {VIEWS.filter((v) => !hide.includes(v.key)).map((v) => {
        const active = view === v.key;
        return (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(v.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
              active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
            }`}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
