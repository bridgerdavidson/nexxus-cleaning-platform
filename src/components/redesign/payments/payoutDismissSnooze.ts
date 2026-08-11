// Dismissing a failed cleaner payout is a SNOOZE, not a permanent hide (audit T2-9):
// the money is still owed to the cleaner, so a dismissal only holds the row out of the
// "Needs you now" band for this window. A payout still 'failed' when the window lapses
// re-enters the band with a resurfaced treatment (usePaymentsTriage stops honoring the
// stale stamp), so a payout the sweep keeps failing can never stay invisible while the
// cleaner's money stays stranded. Dismissing again re-stamps the clock; the /undismiss
// route is the manual inverse.

export const PAYOUT_DISMISS_SNOOZE_HOURS = 24;

const SNOOZE_MS = PAYOUT_DISMISS_SNOOZE_HOURS * 60 * 60 * 1000;

/** ISO cutoff for the triage query: dismissals stamped BEFORE this are stale. */
export function dismissCutoffIso(nowMs: number): string {
  return new Date(nowMs - SNOOZE_MS).toISOString();
}

/** True when a dismissal stamp has outlived its snooze window (the row is back in the band). */
export function isDismissalStale(dismissedAt: string | null | undefined, nowMs: number): boolean {
  if (!dismissedAt) return false;
  const stamped = Date.parse(dismissedAt);
  if (Number.isNaN(stamped)) return false;
  return stamped < nowMs - SNOOZE_MS;
}
