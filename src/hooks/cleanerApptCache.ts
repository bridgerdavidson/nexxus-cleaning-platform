/**
 * Tiny per-user localStorage snapshot of the cleaner's appointments list, so a
 * cold offline open shows last-known jobs and addresses instead of a skeleton
 * that resolves to an error, exactly when a field worker on no signal needs the
 * address. Deliberately targeted at this one query (not whole-client
 * persistence, which would need a new dependency).
 *
 * Used via TanStack Query's `initialData` + `initialDataUpdatedAt`: the snapshot
 * seeds the query as real (stale) data, so an online mount refetches in the
 * background while an offline mount just keeps showing it. The write side stamps
 * the query's own `dataUpdatedAt`, so re-persisting the seeded data on mount is
 * idempotent and never extends a stale snapshot's life.
 *
 * The cached rows are the cleaner's OWN assigned jobs (data already shown to
 * them in-app), keyed per user, so there's no cross-account leak on a shared
 * device. SSR-safe and fully best-effort: any storage error degrades to "no
 * cache", never a throw.
 */
const PREFIX = 'nexxus.cleanerAppointments.v1.';
// Don't seed a list older than this; beyond it, prefer an honest skeleton/refetch.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

interface Snapshot<T> {
  ts: number;
  data: T[];
}

export function readCleanerApptCache<T>(userId: string): { data: T[]; ts: number } | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + userId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot<T> | null;
    if (!parsed || typeof parsed.ts !== 'number' || !Array.isArray(parsed.data)) return null;
    if (Date.now() - parsed.ts > MAX_AGE_MS) return null;
    return { data: parsed.data, ts: parsed.ts };
  } catch {
    return null;
  }
}

export function writeCleanerApptCache<T>(userId: string, data: T[], ts: number): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    const snapshot: Snapshot<T> = { ts, data };
    window.localStorage.setItem(PREFIX + userId, JSON.stringify(snapshot));
  } catch {
    // Quota exceeded / storage disabled: the offline cache is best-effort.
  }
}
