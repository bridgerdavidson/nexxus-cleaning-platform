// src/components/redesign/calendar/calendarStatus.ts
/**
 * Maps a CalendarEvent to our badge vocabulary. The hierarchy mirrors the rest
 * of the redesign: amber = needs you, gray = settled, blue = live, green = done,
 * red = problem. A pending row whose response deadline passed is overridden to
 * Overdue (critical), using the same predicate as the Overview queue so the two
 * never disagree.
 */
import type { CalendarEvent } from '@/lib/calendar/types';
import { isResponseOverdue } from '@/lib/appointments/isResponseOverdue';

export type CalendarBadgeVariant = 'caution' | 'secondary' | 'info' | 'positive' | 'critical';

export interface CalendarStatus {
  variant: CalendarBadgeVariant;
  label: string;
  /** Tailwind bg class for the compact dot (design-system status colors). */
  dotClass: string;
  overdue: boolean;
  /** Completed/cancelled: read-only (not draggable), de-emphasized. */
  terminal: boolean;
}

const MAP: Record<string, { variant: CalendarBadgeVariant; label: string; dotClass: string; terminal: boolean }> = {
  pending:     { variant: 'caution',   label: 'Pending',     dotClass: 'bg-caution',  terminal: false },
  confirmed:   { variant: 'secondary', label: 'Confirmed',   dotClass: 'bg-warm-400', terminal: false },
  in_progress: { variant: 'info',      label: 'In progress', dotClass: 'bg-info',     terminal: false },
  completed:   { variant: 'positive',  label: 'Completed',   dotClass: 'bg-positive', terminal: true  },
  cancelled:   { variant: 'secondary', label: 'Cancelled',   dotClass: 'bg-warm-400', terminal: true  },
};

export function calendarStatus(ev: CalendarEvent, nowMs: number): CalendarStatus {
  if (
    isResponseOverdue(
      {
        status: ev.status,
        cleaner_id: ev.cleanerId,
        cleaner_confirmation_status: ev.cleanerConfirmationStatus ?? null,
        response_deadline: ev.responseDeadline ?? null,
      },
      nowMs,
    )
  ) {
    return { variant: 'critical', label: 'Overdue', dotClass: 'bg-critical', overdue: true, terminal: false };
  }
  const base = MAP[ev.status] ?? MAP.pending;
  return { ...base, overdue: false };
}
