// src/lib/bookings/routingHistoryVm.test.ts
import { describe, expect, it } from 'vitest';
import { buildRoutingTimeline, type RoutingLogRow } from './routingHistoryVm';

const NOW = new Date('2026-07-16T15:00:00');

const row = (over: Partial<RoutingLogRow>): RoutingLogRow => ({
  id: 'r1',
  cleaner_id: 'c1',
  cleaner_name: 'Marcus Lee',
  attempt_index: 1,
  sent_at: '2026-07-12T14:05:00',
  deadline_at: '2026-07-12T18:05:00',
  response: 'pending',
  responded_at: null,
  decline_reason: null,
  ...over,
});

describe('buildRoutingTimeline', () => {
  it('sorts by attempt_index and uses the resolved names', () => {
    const items = buildRoutingTimeline(
      [
        row({ id: 'r2', cleaner_id: 'c2', cleaner_name: 'Wanda Jones', attempt_index: 2, deadline_at: '2026-07-16T17:00:00' }),
        row({ id: 'r1', attempt_index: 1, response: 'declined', responded_at: '2026-07-12T15:00:00' }),
      ],
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['r1', 'r2']);
    expect(items[0].name).toBe('Marcus Lee');
    expect(items[1].name).toBe('Wanda Jones');
  });

  it('falls back for cleaners whose profile is no longer visible', () => {
    const [item] = buildRoutingTimeline([row({ cleaner_name: null })], NOW);
    expect(item.name).toBe('Former cleaner');
  });

  it('maps declined with reason and responded time', () => {
    const [item] = buildRoutingTimeline(
      [row({ response: 'declined', responded_at: '2026-07-12T15:00:00', decline_reason: 'Schedule conflict' })],
      NOW,
    );
    expect(item.badgeVariant).toBe('critical');
    expect(item.badgeLabel).toBe('Declined');
    expect(item.metaLine).toBe('Attempt 1 · offered Jul 12, 2:05 PM · responded Jul 12, 3:00 PM');
    expect(item.declineReason).toBe('Schedule conflict');
    expect(item.current).toBe(false);
  });

  it('maps accepted', () => {
    const [item] = buildRoutingTimeline(
      [row({ response: 'accepted', responded_at: '2026-07-12T15:00:00' })],
      NOW,
    );
    expect(item.badgeVariant).toBe('positive');
    expect(item.badgeLabel).toBe('Accepted');
    expect(item.metaLine).toBe('Attempt 1 · offered Jul 12, 2:05 PM · responded Jul 12, 3:00 PM');
  });

  it('maps expired with the no-response note', () => {
    const [item] = buildRoutingTimeline([row({ response: 'expired' })], NOW);
    expect(item.badgeVariant).toBe('secondary');
    expect(item.badgeLabel).toBe('Expired');
    expect(item.metaLine).toBe('Attempt 1 · offered Jul 12, 2:05 PM · no response by deadline');
  });

  it('pending shows a same-day deadline as time only', () => {
    const [item] = buildRoutingTimeline([row({ deadline_at: '2026-07-16T17:00:00' })], NOW);
    expect(item.badgeVariant).toBe('info');
    expect(item.badgeLabel).toBe('Respond by 5:00 PM');
    expect(item.current).toBe(true);
  });

  it('pending shows a cross-day deadline with the date', () => {
    const [item] = buildRoutingTimeline([row({ deadline_at: '2026-07-17T09:00:00' })], NOW);
    expect(item.badgeLabel).toBe('Respond by Jul 17, 9:00 AM');
  });

  it('pending past its deadline reads as overdue, not "Respond by" a past time', () => {
    const [item] = buildRoutingTimeline([row({ deadline_at: '2026-07-16T11:00:00' })], NOW);
    expect(item.badgeVariant).toBe('caution');
    expect(item.badgeLabel).toBe('Response overdue');
    expect(item.current).toBe(true);
  });

  it('marks only the last pending row as current', () => {
    const items = buildRoutingTimeline(
      [
        row({ id: 'r1', attempt_index: 1, response: 'expired' }),
        row({ id: 'r2', attempt_index: 2 }),
        row({ id: 'r3', attempt_index: 3 }),
      ],
      NOW,
    );
    expect(items.map((i) => i.current)).toEqual([false, false, true]);
  });
});
