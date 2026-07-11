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
