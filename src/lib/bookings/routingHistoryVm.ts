// src/lib/bookings/routingHistoryVm.ts
import { format, isSameDay } from 'date-fns';

export type RoutingLogRow = {
  id: string;
  cleaner_id: string;
  attempt_index: number;
  sent_at: string;
  deadline_at: string;
  response: 'pending' | 'accepted' | 'declined' | 'expired';
  responded_at: string | null;
  decline_reason: string | null;
};

export type RoutingTimelineItem = {
  id: string;
  name: string;
  badgeVariant: 'positive' | 'critical' | 'secondary' | 'info';
  badgeLabel: string;
  metaLine: string;
  declineReason: string | null;
  current: boolean;
};

const stamp = (iso: string) => format(new Date(iso), 'MMM d, h:mm a');

/** Maps routing-log rows to timeline items, oldest attempt first. `now` is a
 *  parameter (not Date.now()) so tests and callers control the clock. */
export function buildRoutingTimeline(
  rows: RoutingLogRow[],
  cleanerNameById: Map<string, string>,
  now: Date,
): RoutingTimelineItem[] {
  const sorted = [...rows].sort((a, b) => a.attempt_index - b.attempt_index);
  const lastPendingId = [...sorted].reverse().find((r) => r.response === 'pending')?.id ?? null;

  return sorted.map((r) => {
    let badgeVariant: RoutingTimelineItem['badgeVariant'];
    let badgeLabel: string;
    switch (r.response) {
      case 'accepted':
        badgeVariant = 'positive';
        badgeLabel = 'Accepted';
        break;
      case 'declined':
        badgeVariant = 'critical';
        badgeLabel = 'Declined';
        break;
      case 'expired':
        badgeVariant = 'secondary';
        badgeLabel = 'Expired';
        break;
      default: {
        const deadline = new Date(r.deadline_at);
        badgeVariant = 'info';
        badgeLabel = `Respond by ${isSameDay(deadline, now) ? format(deadline, 'h:mm a') : stamp(r.deadline_at)}`;
      }
    }

    let metaLine = `Attempt ${r.attempt_index} · offered ${stamp(r.sent_at)}`;
    if (r.response === 'expired') metaLine += ' · no response by deadline';
    if ((r.response === 'accepted' || r.response === 'declined') && r.responded_at) {
      metaLine += ` · responded ${stamp(r.responded_at)}`;
    }

    return {
      id: r.id,
      name: cleanerNameById.get(r.cleaner_id) ?? 'Former cleaner',
      badgeVariant,
      badgeLabel,
      metaLine,
      declineReason: r.decline_reason,
      current: r.id === lastPendingId,
    };
  });
}
