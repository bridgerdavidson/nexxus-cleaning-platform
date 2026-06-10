/**
 * Pure column-packing for overlapping events within one day (Week) or one cleaner column
 * (Day dispatch board). Groups transitively-overlapping events into clusters, then greedily
 * assigns each a lane (the first column free at its start). Event width = 1 / laneCount,
 * left = lane / laneCount.
 *
 * Back-to-back events (one ends exactly when the next starts) do NOT overlap, matching the
 * conflict rule in `src/lib/appointmentConflicts.ts` (strict `<` comparison).
 */
import type { LaidOut } from './types';

type Interval = { id: string; startMin: number; endMin: number };

export function packEventsIntoLanes<T extends Interval>(events: T[]): Array<T & LaidOut> {
  const sorted = [...events].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin,
  );

  const out: Array<T & LaidOut> = [];
  let cluster: Array<T & LaidOut> = [];
  let clusterMaxEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const laneCount = cluster.reduce((mx, e) => Math.max(mx, e.lane + 1), 0);
    for (const e of cluster) e.laneCount = laneCount;
    out.push(...cluster);
    cluster = [];
    clusterMaxEnd = -Infinity;
  };

  for (const ev of sorted) {
    // A new event that starts at or after every current member's end begins a fresh cluster
    // (no overlap with anything already placed).
    if (cluster.length > 0 && ev.startMin >= clusterMaxEnd) flush();

    // Latest end time seen per lane in the current cluster.
    const laneEnds: number[] = [];
    for (const e of cluster) {
      laneEnds[e.lane] = Math.max(laneEnds[e.lane] ?? -Infinity, e.endMin);
    }
    // First lane that is free at ev.startMin (free == its last event ends <= ev.startMin).
    let lane = 0;
    while (lane < laneEnds.length && laneEnds[lane] > ev.startMin) lane++;

    cluster.push({ ...ev, lane, laneCount: 0 });
    clusterMaxEnd = Math.max(clusterMaxEnd, ev.endMin);
  }
  flush();

  return out;
}
