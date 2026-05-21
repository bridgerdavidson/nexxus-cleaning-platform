import { isAppointmentOverdue } from '../isAppointmentOverdue';

/**
 * Why a given appointment is sitting on the admin's action queue.
 *
 * These five reasons collectively replace what used to be three separate
 * admin surfaces (AwaitingRequestsSection, RescheduleRequiredSection, the
 * BookingsPage "needs your response" memo). One source of truth.
 *
 * NOT included: "awaiting cleaner approval" — those are pending the cleaner's
 * response, not the admin's. They surface in the informational
 * AwaitingApprovalSection instead, not in the action queue.
 */
export type ActionReason =
  | 'awaiting_assignment'    // homeowner request, no cleaner picked yet
  | 'all_cleaners_declined'  // chain exhausted, must force-assign
  | 'counter_proposed'       // cleaner suggested alt times
  | 'cleaner_declined'       // cleaner declined, didn't auto-route
  | 'cleaner_overdue';       // SLA elapsed, cleaner ghosted

export interface ActionInput {
  status: string;
  request_state?: string | null;
  cleaner_confirmation_status: string | null;
  cleaner_id: string | null;
  response_deadline: string | null;
  /**
   * True when the appointment has a `cleaner_availability_feedback` row with
   * at least one `cleaner_suggested_times` or `cleaner_suggested_windows`
   * child. The caller is responsible for joining and computing this — keeps
   * the predicate pure.
   */
  has_suggestions?: boolean;
}

export function isActionRequired(apt: ActionInput, now: Date = new Date()): boolean {
  return deriveActionReason(apt, now) !== null;
}

export function deriveActionReason(apt: ActionInput, now: Date = new Date()): ActionReason | null {
  if (apt.status === 'cancelled' || apt.status === 'completed') return null;

  if (apt.request_state === 'awaiting_admin') return 'awaiting_assignment';

  if (apt.cleaner_confirmation_status === 'rejected') {
    if (!apt.cleaner_id) return 'all_cleaners_declined';
    if (apt.has_suggestions) return 'counter_proposed';
    return 'cleaner_declined';
  }

  if (
    isAppointmentOverdue(
      {
        status: apt.status,
        cleaner_confirmation_status: apt.cleaner_confirmation_status as
          | 'awaiting'
          | 'approved'
          | 'rejected'
          | null,
        response_deadline: apt.response_deadline,
      },
      now,
    )
  ) {
    return 'cleaner_overdue';
  }

  return null;
}

export function actionReasonLabel(reason: ActionReason): string {
  switch (reason) {
    case 'awaiting_assignment':
      return 'Awaiting assignment';
    case 'all_cleaners_declined':
      return 'All cleaners declined';
    case 'counter_proposed':
      return 'Counter-proposed';
    case 'cleaner_declined':
      return 'Cleaner declined';
    case 'cleaner_overdue':
      return 'Cleaner overdue';
  }
}

/**
 * Priority order for grouping items in the queue. Lower index = higher
 * priority (rendered first).
 */
export const ACTION_REASON_PRIORITY: ActionReason[] = [
  'counter_proposed',
  'all_cleaners_declined',
  'cleaner_overdue',
  'cleaner_declined',
  'awaiting_assignment',
];
