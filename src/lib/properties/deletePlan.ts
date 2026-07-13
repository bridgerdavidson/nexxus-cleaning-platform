export type PropertyDeleteAction = 'hard-delete' | 'cancel-and-archive' | 'archive-only';
export interface PropertyDeletePlan { action: PropertyDeleteAction; liveCount: number; historyCount: number; needsBookingEdit: boolean; }
export const LIVE_APPT_STATUSES = ['pending', 'confirmed', 'in_progress'] as const;
export const HISTORY_APPT_STATUSES = ['completed', 'cancelled'] as const;

export function planPropertyDeletion(counts: { liveCount: number; historyCount: number }): PropertyDeletePlan {
  const { liveCount, historyCount } = counts;
  if (liveCount === 0 && historyCount === 0) return { action: 'hard-delete', liveCount, historyCount, needsBookingEdit: false };
  if (liveCount === 0) return { action: 'archive-only', liveCount, historyCount, needsBookingEdit: false };
  return { action: 'cancel-and-archive', liveCount, historyCount, needsBookingEdit: true };
}

/**
 * Whether the delete affordance must be blocked for lack of booking-edit rights.
 * Only `cancel-and-archive` (a property with upcoming cleanings) needs to cancel
 * appointments, an `appointments` UPDATE gated by `can_edit_bookings` (migration
 * 106). Owner/admin are privileged: they have no `manager_permissions` row (so
 * the raw flag reads false) but bypass all flags at the RLS layer, so privilege
 * alone un-blocks them. Non-cancel plans (hard-delete / archive-only) are never
 * blocked by this permission.
 */
export function isDeleteBlockedByPermission(
  action: PropertyDeleteAction | null | undefined,
  opts: { privileged: boolean; canEditBookingsFlag: boolean },
): boolean {
  if (action !== 'cancel-and-archive') return false;
  return !opts.privileged && !opts.canEditBookingsFlag;
}
