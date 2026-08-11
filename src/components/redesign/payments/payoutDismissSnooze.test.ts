import { describe, it, expect } from 'vitest';
import {
  PAYOUT_DISMISS_SNOOZE_HOURS,
  dismissCutoffIso,
  isDismissalStale,
} from './payoutDismissSnooze';

const NOW = Date.parse('2026-08-11T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

describe('dismissCutoffIso', () => {
  it('is exactly the snooze window before now, in ISO form usable in a PostgREST filter', () => {
    expect(dismissCutoffIso(NOW)).toBe(
      new Date(NOW - PAYOUT_DISMISS_SNOOZE_HOURS * HOUR_MS).toISOString(),
    );
    // The or-filter embeds this raw: it must be a plain ISO string (no commas, ends in Z).
    expect(dismissCutoffIso(NOW)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('isDismissalStale', () => {
  it('null/undefined stamps are never stale (the row was never dismissed)', () => {
    expect(isDismissalStale(null, NOW)).toBe(false);
    expect(isDismissalStale(undefined, NOW)).toBe(false);
  });

  it('a stamp inside the window is not stale (still snoozed)', () => {
    const oneHourAgo = new Date(NOW - HOUR_MS).toISOString();
    expect(isDismissalStale(oneHourAgo, NOW)).toBe(false);
    const justInside = new Date(NOW - PAYOUT_DISMISS_SNOOZE_HOURS * HOUR_MS + 1000).toISOString();
    expect(isDismissalStale(justInside, NOW)).toBe(false);
  });

  it('a stamp older than the window is stale (the row resurfaces)', () => {
    const justOutside = new Date(NOW - PAYOUT_DISMISS_SNOOZE_HOURS * HOUR_MS - 1000).toISOString();
    expect(isDismissalStale(justOutside, NOW)).toBe(true);
    const daysOld = new Date(NOW - 72 * HOUR_MS).toISOString();
    expect(isDismissalStale(daysOld, NOW)).toBe(true);
  });

  it('agrees with the query cutoff: stale exactly when the stamp sorts before dismissCutoffIso', () => {
    const cutoff = dismissCutoffIso(NOW);
    const before = new Date(Date.parse(cutoff) - 1).toISOString();
    const after = new Date(Date.parse(cutoff) + 1).toISOString();
    expect(isDismissalStale(before, NOW)).toBe(true);
    expect(isDismissalStale(after, NOW)).toBe(false);
  });

  it('an unparseable stamp is treated as not stale (fail quiet, never fabricate a resurface)', () => {
    expect(isDismissalStale('not-a-date', NOW)).toBe(false);
  });
});
