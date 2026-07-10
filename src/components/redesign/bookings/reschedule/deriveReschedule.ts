/**
 * Pure client-side derivation module for the Reschedule dialog.
 * Builds constrained time options, conflict detection, outcome lines, and
 * button labels from AdminAppointment + user selection.
 */
import { type AdminAppointment } from '@/hooks/useAdminData';
import {
  type SuggestionInputs,
  type RescheduleOutcome,
  decideRescheduleOutcome,
  normalizeTimeHHMM,
} from '@/lib/appointments/rescheduleOutcome';
import { bookableTimeOptions } from '@/components/redesign/homeowner/booking/time-options';
import { fmtTime, monthDay } from '../booking-vm';
import { findConflicts, type ScheduleAppointment } from '@/lib/appointmentConflicts';

export interface RescheduleSelection {
  date: string | null;
  time: string | null;
  cleanerId: string | null;
}

export interface RescheduleChip {
  kind: 'time' | 'window';
  id: string;
  label: string; // "Mar 6 at 9:00am" / "Mar 7, 1:00pm to 4:00pm"
  date: string;
  time?: string; // exact-time chips
  startTime?: string;
  endTime?: string; // window chips
}

/**
 * Flatten cleaner_availability_feedback into SuggestionInputs for the current
 * cleaner, mirroring the server-side rescheduleOutcome logic.
 */
export function suggestionInputsFor(a: AdminAppointment): SuggestionInputs {
  const times: SuggestionInputs['times'] = [];
  const windows: SuggestionInputs['windows'] = [];

  for (const fb of a.cleaner_availability_feedback ?? []) {
    for (const t of fb.cleaner_suggested_times ?? []) {
      times.push({
        feedbackCleanerId: fb.cleaner_id,
        suggestedDate: t.suggested_date,
        suggestedTime: t.suggested_time,
      });
    }
    for (const w of fb.cleaner_suggested_windows ?? []) {
      windows.push({
        feedbackCleanerId: fb.cleaner_id,
        windowDate: w.window_date,
        startTime: w.start_time,
        endTime: w.end_time,
      });
    }
  }
  return { times, windows };
}

/**
 * Build a list of reschedule chips (time options and windows) that belong
 * to the current cleaner only. Chip labels use booking-vm vocabulary
 * (monthDay, fmtTime).
 */
export function ownedChips(a: AdminAppointment): RescheduleChip[] {
  const chips: RescheduleChip[] = [];
  const currentCleanerId = a.cleaner_id;

  for (const fb of a.cleaner_availability_feedback ?? []) {
    if (fb.cleaner_id !== currentCleanerId) continue;

    for (const t of fb.cleaner_suggested_times ?? []) {
      chips.push({
        kind: 'time',
        id: t.id,
        label: `${monthDay(t.suggested_date)} at ${fmtTime(t.suggested_time)}`,
        date: t.suggested_date,
        time: t.suggested_time,
      });
    }

    for (const w of fb.cleaner_suggested_windows ?? []) {
      chips.push({
        kind: 'window',
        id: w.id,
        label: `${monthDay(w.window_date)}, ${fmtTime(w.start_time)} to ${fmtTime(w.end_time)}`,
        date: w.window_date,
        startTime: w.start_time,
        endTime: w.end_time,
      });
    }
  }

  return chips;
}

/**
 * Derive time-pill options constrained to a window, or return the base
 * bookable-hour options if no constraint. The window's exact start time is
 * ALWAYS included (auto-approve guaranteed).
 */
export function timePillOptions(constraint: { startTime: string; endTime: string } | null): Array<{
  value: string;
  label: string;
}> {
  const base = bookableTimeOptions();
  if (!constraint) return base;

  const start = normalizeTimeHHMM(constraint.startTime);
  const end = normalizeTimeHHMM(constraint.endTime);
  if (!start || !end) return base;

  const clipped = base.filter((t) => t.value >= start && t.value <= end);

  // Ensure the window's exact start is included (even if not in base hourly options).
  if (!clipped.some((t) => t.value === start)) {
    clipped.unshift({ value: start, label: fmtTime(`${start}:00`) });
  }

  return clipped;
}

/**
 * Find a conflict for the given selection (date, time, cleanerId) among
 * all appointments, excluding the target appointment itself.
 * Returns { label } with conflict info, or null if no conflict.
 */
export function conflictFor(
  appointments: AdminAppointment[],
  sel: RescheduleSelection,
  excludeId: string,
): { label: string } | null {
  if (!sel.cleanerId || !sel.date || !sel.time) return null;

  // The candidate's real duration comes from the appointment being rescheduled
  // (it's the appointment shrinking/growing, not the conflicting one). 120 is
  // only a fallback for the (unexpected) case where it's not in the list.
  const durationMinutes = appointments.find((a) => a.id === excludeId)?.duration_minutes ?? 120;

  // Build ScheduleAppointment[] for the target cleaner.
  const schedule: ScheduleAppointment[] = appointments
    .filter((a) => a.cleaner_id === sel.cleanerId)
    .map((a) => ({
      id: a.id,
      status: a.status,
      scheduled_date: a.scheduled_date,
      scheduled_time: a.scheduled_time,
      duration_minutes: a.duration_minutes ?? 0,
      homeowner_name: a.homeowner
        ? `${a.homeowner.first_name ?? ''} ${a.homeowner.last_name ?? ''}`.trim() || 'Customer'
        : 'Customer',
    }));

  const conflicts = findConflicts(
    schedule,
    { date: sel.date, time: sel.time, durationMinutes },
    { excludeAppointmentId: excludeId },
  );

  if (conflicts.length === 0) return null;

  const conflict = conflicts[0]!;
  return {
    label: `Conflicts with ${conflict.homeowner_name} at ${fmtTime(sel.time)}`,
  };
}

/**
 * Derive the reschedule outcome for a pending selection, wrapping the SAME
 * shared decision logic the server route uses (decideRescheduleOutcome) over
 * this appointment's own suggestions. No reimplementation.
 */
export function outcomeFor(
  a: AdminAppointment,
  sel: RescheduleSelection,
  payoutModel: string | null | undefined,
): RescheduleOutcome {
  return decideRescheduleOutcome({
    scheduledDate: sel.date ?? a.scheduled_date,
    scheduledTime: sel.time ?? a.scheduled_time,
    targetCleanerId: sel.cleanerId,
    currentCleanerId: a.cleaner_id ?? null,
    orgDefaultPayoutModel: payoutModel,
    suggestions: suggestionInputsFor(a),
  });
}

/**
 * Derive the outcome line shown in the Reschedule dialog. Covers the six
 * spec variants (docs/superpowers/specs/2026-07-09-reschedule-edit-booking-design.md,
 * lines 53-58); the series line is separate (see seriesLine). No em dashes;
 * uses periods and commas.
 *
 * decideRescheduleOutcome only returns 'auto_approve' when the target cleaner
 * IS the current cleaner (see rescheduleOutcome.ts), so auto_approve is
 * never paired with cleanerChanged; this function does not branch on it.
 */
export function outcomeLine(args: {
  outcome: RescheduleOutcome;
  cleanerName: string | null;
  cleanerChanged: boolean;
  escalatedUnassigned: boolean;
  tier: 4 | 24 | null;
}): string {
  const { outcome, cleanerName, cleanerChanged, escalatedUnassigned, tier } = args;

  if (outcome.kind === 'unassigned') {
    return escalatedUnassigned
      ? 'The new time is saved. This booking still needs a cleaner.'
      : 'No cleaner is assigned yet. The new time takes effect right away.';
  }

  const name = cleanerName || 'The cleaner';

  if (outcome.kind === 'auto_approve') {
    return `Matches ${name}'s suggestion. Confirms instantly, no re-confirmation needed.`;
  }

  if (outcome.kind === 'employee_settled') {
    return `${name} will be notified of the new time.`;
  }

  // outcome.kind === 'reask'
  const respondBy = tier ? ` They will have ${tier} hours to respond.` : '';
  return cleanerChanged
    ? `${name} will be asked to confirm this time.${respondBy}`
    : `${name} will be asked to re-confirm this time.${respondBy}`;
}

/**
 * Return the series warning line if this appointment is part of a series,
 * or null otherwise.
 */
export function seriesLine(a: AdminAppointment): string | null {
  return a.series_id ? 'Part of a repeating series. This change applies to this cleaning only.' : null;
}

/**
 * Derive the primary action button label. Precedence: conflict -> unsettled ->
 * settled. No em dashes.
 */
export function primaryLabel(
  outcome: RescheduleOutcome,
  hasConflict: boolean,
  cleanerFirstName: string | null,
): string {
  if (hasConflict) return 'Reschedule anyway';
  if (!outcome.settled) {
    return cleanerFirstName ? `Send to ${cleanerFirstName}` : 'Send to cleaner';
  }
  return 'Confirm reschedule';
}
