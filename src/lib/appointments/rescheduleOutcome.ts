/**
 * Shared decision logic for the operator reschedule flow (spec:
 * docs/superpowers/specs/2026-07-09-reschedule-edit-booking-design.md).
 * Consumed by BOTH the RescheduleDialog (outcome line, button label,
 * constrained time pills) and /api/appointments/[appointmentId]/reschedule,
 * so client preview and server behavior cannot drift.
 *
 * Matching rules are defined HERE, deliberately (accept-counter-proposal has
 * no time-equality rule and its window check compares raw mixed-format
 * strings; the legacy modal's closed-interval window rule is what shipped):
 *   - all times normalized to HH:MM before comparing
 *   - exact match: same date + equal normalized times
 *   - window match: same date + start <= t <= end (closed interval)
 *   - a suggestion counts only when its feedback row belongs to the target cleaner
 */
import { computeResponseDeadline } from '@/lib/computeResponseDeadline';

export interface SuggestionInputs {
  times: Array<{ feedbackCleanerId: string; suggestedDate: string; suggestedTime: string }>;
  windows: Array<{ feedbackCleanerId: string; windowDate: string; startTime: string; endTime: string }>;
}

export function normalizeTimeHHMM(time: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export function matchesOwnedSuggestion(
  cleanerId: string,
  scheduledDate: string,
  scheduledTime: string,
  suggestions: SuggestionInputs,
): boolean {
  const t = normalizeTimeHHMM(scheduledTime);
  if (!t) return false;
  const timeHit = suggestions.times.some(
    (s) =>
      s.feedbackCleanerId === cleanerId &&
      s.suggestedDate === scheduledDate &&
      normalizeTimeHHMM(s.suggestedTime) === t,
  );
  if (timeHit) return true;
  return suggestions.windows.some((w) => {
    if (w.feedbackCleanerId !== cleanerId || w.windowDate !== scheduledDate) return false;
    const start = normalizeTimeHHMM(w.startTime);
    const end = normalizeTimeHHMM(w.endTime);
    return !!start && !!end && start <= t && t <= end;
  });
}

export type RescheduleOutcomeKind = 'auto_approve' | 'employee_settled' | 'unassigned' | 'reask';

export interface RescheduleOutcome {
  kind: RescheduleOutcomeKind;
  /** True for every outcome except a re-ask (the time is final immediately). */
  settled: boolean;
  /** Column values to write; null = leave the column untouched (unassigned). */
  status: 'pending' | 'confirmed' | null;
  cleanerConfirmationStatus: 'awaiting' | 'approved' | null;
  /** true -> computeResponseDeadlineISO(newDate, newTime); false -> write null. */
  recomputeDeadline: boolean;
}

export interface RescheduleDecisionInput {
  scheduledDate: string;
  scheduledTime: string;
  targetCleanerId: string | null;
  currentCleanerId: string | null;
  /** organizations.default_payout_model. 'hourly_external' means employees:
   *  no offer loop, changes settle. Every contractor-umbrella mode
   *  (percentage/flat/request) keeps the offer loop. */
  orgDefaultPayoutModel: string | null | undefined;
  suggestions: SuggestionInputs;
}

export function decideRescheduleOutcome(input: RescheduleDecisionInput): RescheduleOutcome {
  const { targetCleanerId, currentCleanerId } = input;
  if (!targetCleanerId) {
    return { kind: 'unassigned', settled: true, status: null, cleanerConfirmationStatus: null, recomputeDeadline: false };
  }
  const sameCleaner = targetCleanerId === currentCleanerId;
  if (
    sameCleaner &&
    matchesOwnedSuggestion(targetCleanerId, input.scheduledDate, input.scheduledTime, input.suggestions)
  ) {
    return { kind: 'auto_approve', settled: true, status: 'confirmed', cleanerConfirmationStatus: 'approved', recomputeDeadline: false };
  }
  const model = input.orgDefaultPayoutModel;
  if (model === 'hourly_external') {
    return { kind: 'employee_settled', settled: true, status: 'confirmed', cleanerConfirmationStatus: 'approved', recomputeDeadline: false };
  }
  return { kind: 'reask', settled: false, status: 'pending', cleanerConfirmationStatus: 'awaiting', recomputeDeadline: true };
}

export interface RescheduleNotificationPlan {
  cleanerEvent:
    | 'cleaner_counter_accepted'
    | 'cleaner_assigned'
    | 'cleaner_force_assigned'
    | 'appointment_rescheduled'
    | null;
  /** Payload flag on appointment_rescheduled: re-confirm ask vs FYI. */
  requiresConfirmation: boolean;
  /** Emit appointment_time_changed to the homeowner (when homeowner_id set). */
  notifyHomeowner: boolean;
}

export function planRescheduleNotifications(
  outcome: RescheduleOutcome,
  cleanerChanged: boolean,
): RescheduleNotificationPlan {
  if (outcome.kind === 'unassigned') {
    return { cleanerEvent: null, requiresConfirmation: false, notifyHomeowner: true };
  }
  if (cleanerChanged) {
    return {
      cleanerEvent: outcome.settled ? 'cleaner_force_assigned' : 'cleaner_assigned',
      requiresConfirmation: false,
      notifyHomeowner: outcome.settled,
    };
  }
  if (outcome.kind === 'auto_approve') {
    return { cleanerEvent: 'cleaner_counter_accepted', requiresConfirmation: false, notifyHomeowner: true };
  }
  return {
    cleanerEvent: 'appointment_rescheduled',
    requiresConfirmation: outcome.kind === 'reask',
    notifyHomeowner: outcome.settled,
  };
}

/**
 * The SLA tier a re-ask would give the cleaner, for the dialog's outcome line
 * ("They will have 24 hours to respond"). Duration, not a clock time: the real
 * deadline is computed server-side at save time and a client-side absolute
 * time could drift across the 48h tier boundary.
 */
export function reaskTierHours(
  scheduledDate: string,
  scheduledTime: string,
  now: Date = new Date(),
): 4 | 24 | null {
  const d = computeResponseDeadline(scheduledDate, scheduledTime, now);
  if (!d) return null;
  const hours = Math.round((d.getTime() - now.getTime()) / (60 * 60 * 1000));
  return hours <= 4 ? 4 : 24;
}
