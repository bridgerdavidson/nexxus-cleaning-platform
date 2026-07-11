// src/components/redesign/calendar/MonthEventPill.tsx
'use client';

import type { CalendarEvent } from '@/lib/calendar/types';
import { calendarStatus } from './calendarStatus';
import { fmtTime } from '@/components/redesign/bookings/booking-vm';

const PILL_TINT: Record<string, string> = {
  caution: 'bg-caution-50 text-caution-700',
  secondary: 'bg-muted text-warm-700',
  info: 'bg-info-50 text-info-700',
  positive: 'bg-positive-50 text-positive-700',
  critical: 'bg-critical-50 text-critical-700',
};

export function MonthEventPill({ event, nowMs, onOpen }: { event: CalendarEvent; nowMs: number; onOpen: (id: string) => void }) {
  const s = calendarStatus(event, nowMs);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(event.id); }}
      className={`flex h-[19px] min-w-0 items-center gap-1.5 rounded-pill px-1.5 text-[10.5px] font-semibold ${PILL_TINT[s.variant] ?? PILL_TINT.secondary}`}
    >
      <span className={`size-2 shrink-0 rounded-full ${s.dotClass}`} />
      <span className="min-w-0 truncate">{fmtTime(event.start.toTimeString().slice(0, 5))} {event.customerLabel}</span>
    </button>
  );
}
