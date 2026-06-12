/**
 * Shared types for the custom Bookings calendar cockpit (Month / Week / Day-dispatch /
 * Agenda). Kept dependency-light so the pure layout/geometry helpers in this folder stay
 * unit-testable in isolation. The mapping from `AppointmentCardData` to `CalendarEvent`
 * lives in `useCalendarEvents` (a hook), not here.
 */
import type { PillPaymentStatus } from '../paymentStatusPill';

export type ViewMode = 'month' | 'week' | 'day' | 'agenda';

/** Visible vertical window of a time-grid, in minutes from local midnight. */
export interface BusinessHours {
  startMin: number;
  endMin: number;
}

/** Column-packing result for overlapping events within a single day/cleaner column. */
export interface LaidOut {
  /** 0-based column index within the overlap cluster. */
  lane: number;
  /** Total columns the cluster was packed into (event width = 1 / laneCount). */
  laneCount: number;
}

/**
 * A normalized appointment ready for the calendar. Times are pre-parsed into
 * minutes-from-midnight so the layout helpers never re-parse strings.
 */
export interface CalendarEvent {
  id: string;
  /** Local calendar day, `yyyy-mm-dd`. */
  date: string;
  /** Start time in minutes from local midnight. */
  startMin: number;
  /** Length in minutes (already defaulted; never 0). */
  durationMin: number;
  /** `startMin + durationMin`. */
  endMin: number;
  /** Local Date for the start instant (for formatting / now-indicator math). */
  start: Date;
  status: string;
  cleanerConfirmationStatus?: 'awaiting' | 'approved' | 'rejected' | null;
  hasSuggestedTimes?: boolean;
  /** Resolved customer/property label (never "Unknown"). */
  customerLabel: string;
  /** Service (+ checklist) label. */
  serviceLabel: string;
  cleanerId: string | null;
  cleanerName: string | null;
  paymentStatus?: PillPaymentStatus;
  seriesId?: string | null;
  totalPrice?: number;
}

export type LaidOutEvent = CalendarEvent & LaidOut;

/** Minimal shape the cleaner-column grouping needs (a roster entry for the dispatch board). */
export interface CalendarCleaner {
  id: string;
  name: string;
  avatarUrl?: string | null;
}
