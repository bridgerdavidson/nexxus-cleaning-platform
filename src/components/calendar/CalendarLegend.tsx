'use client';
import React from 'react';
import { statusVisual } from '@/lib/calendar/eventColors';

const STATUSES = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled'];

export default function CalendarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {STATUSES.map((s) => {
        const v = statusVisual(s);
        return (
          <span key={s} className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className={`h-2 w-2 rounded-full ${v.dotClass}`} aria-hidden="true" />
            {v.label}
          </span>
        );
      })}
    </div>
  );
}
