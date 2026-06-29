import { describe, it, expect } from 'vitest';
import {
  relativeTime,
  operatorNotificationHref,
  deriveNotificationGroups,
} from './deriveNotifications';
import type { NotificationItem } from '@/hooks/useNotifications';

function item(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1',
    event_type: 'homeowner_request_submitted',
    payload: null,
    appointment_id: 'appt-1',
    organization_id: 'org-1',
    created_at: '2026-06-25T12:00:00.000Z',
    in_app_dispatched_at: null,
    ...over,
  };
}

const NOW = new Date('2026-06-25T12:00:00.000Z').getTime();

describe('relativeTime', () => {
  it('returns "just now" under 45s', () => {
    expect(relativeTime('2026-06-25T11:59:30.000Z', NOW)).toBe('just now');
  });
  it('returns minutes', () => {
    expect(relativeTime('2026-06-25T11:30:00.000Z', NOW)).toBe('30m ago');
  });
  it('returns hours', () => {
    expect(relativeTime('2026-06-25T09:00:00.000Z', NOW)).toBe('3h ago');
  });
  it('returns days under a week', () => {
    expect(relativeTime('2026-06-22T12:00:00.000Z', NOW)).toBe('3d ago');
  });
  it('falls back to a locale date past a week', () => {
    const out = relativeTime('2026-06-01T12:00:00.000Z', NOW);
    expect(out).not.toMatch(/ago|just now/);
    expect(out.length).toBeGreaterThan(0);
  });
  it('returns empty string for an unparseable date', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('');
  });
});

describe('operatorNotificationHref', () => {
  it('deep-links appointment events to the legacy drawer host, tab by type', () => {
    // cleaner_accepted -> bookings tab
    expect(
      operatorNotificationHref({ event_type: 'cleaner_accepted', appointment_id: 'a1' }),
    ).toBe('/admin-dashboard?tab=bookings&appointment=a1');
    // charge_failed (with appointment) -> payments tab
    expect(
      operatorNotificationHref({ event_type: 'charge_failed', appointment_id: 'a2' }),
    ).toBe('/admin-dashboard?tab=payments&appointment=a2');
    // homeowner_request_submitted -> home tab (Overview)
    expect(
      operatorNotificationHref({ event_type: 'homeowner_request_submitted', appointment_id: 'a3' }),
    ).toBe('/admin-dashboard?tab=home&appointment=a3');
  });

  it('routes appointment-less member_joined to redesign customers', () => {
    expect(
      operatorNotificationHref({ event_type: 'member_joined', appointment_id: null }),
    ).toBe('/app/admin-dashboard/customers');
  });

  it('routes appointment-less money events to redesign payments', () => {
    expect(
      operatorNotificationHref({ event_type: 'dispute_opened', appointment_id: null }),
    ).toBe('/app/admin-dashboard/payments');
  });

  it('falls back to the redesign overview for unknown appointment-less events', () => {
    expect(
      operatorNotificationHref({ event_type: 'something_new', appointment_id: null }),
    ).toBe('/app/admin-dashboard');
  });
});

describe('cleanerNotificationHref (via deriveNotificationGroups role="cleaner")', () => {
  it('routes appointment notifications to the in-redesign job detail', () => {
    const [g] = deriveNotificationGroups(
      [item({ appointment_id: 'appt-42', event_type: 'job_completed' })],
      NOW,
      'cleaner',
    );
    expect(g.latest.href).toBe('/app/cleaner-dashboard?job=appt-42');
  });

  it('routes cleaner_paid (no appointment) to the earnings screen', () => {
    const [g] = deriveNotificationGroups(
      [item({ appointment_id: null, event_type: 'cleaner_paid' })],
      NOW,
      'cleaner',
    );
    expect(g.latest.href).toBe('/app/cleaner-dashboard/earnings');
  });

  it('falls back to cleaner dashboard home for non-appointment, non-paid events', () => {
    const [g] = deriveNotificationGroups(
      [item({ appointment_id: null, event_type: 'something_else' })],
      NOW,
      'cleaner',
    );
    expect(g.latest.href).toBe('/app/cleaner-dashboard');
  });
});

describe('deriveNotificationGroups', () => {
  it('groups consecutive notifications by appointment, newest as latest', () => {
    const items = [
      item({ id: 'a', appointment_id: 'appt-1', created_at: '2026-06-25T11:59:00.000Z' }),
      item({ id: 'b', appointment_id: 'appt-1', created_at: '2026-06-25T11:00:00.000Z' }),
      item({ id: 'c', appointment_id: 'appt-2', created_at: '2026-06-25T10:00:00.000Z' }),
    ];
    const groups = deriveNotificationGroups(items, NOW);
    expect(groups).toHaveLength(2);
    expect(groups[0].key).toBe('appt-1');
    expect(groups[0].latest.id).toBe('a');
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].moreCount).toBe(1);
    expect(groups[1].key).toBe('appt-2');
    expect(groups[1].moreCount).toBe(0);
  });

  it('keeps appointment-less notifications as solo groups', () => {
    const groups = deriveNotificationGroups(
      [item({ id: 'x', appointment_id: null, event_type: 'member_joined' })],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('solo:x');
    expect(groups[0].moreCount).toBe(0);
  });

  it('tracks unread ids and anyUnread per group', () => {
    const items = [
      item({ id: 'a', appointment_id: 'appt-1', in_app_dispatched_at: null }),
      item({ id: 'b', appointment_id: 'appt-1', in_app_dispatched_at: '2026-06-25T11:00:00.000Z' }),
    ];
    const [g] = deriveNotificationGroups(items, NOW);
    expect(g.unreadIds).toEqual(['a']);
    expect(g.anyUnread).toBe(true);
    expect(g.latest.unread).toBe(true);
    expect(g.items[1].unread).toBe(false);
  });

  it('builds a display descriptor and relative time on each item', () => {
    const [g] = deriveNotificationGroups(
      [item({ event_type: 'homeowner_request_submitted', payload: { customer_name: 'Sarah' } })],
      NOW,
    );
    expect(g.latest.descriptor.title).toBe('New booking request from Sarah');
    expect(g.latest.relative).toBe('just now');
    expect(g.latest.href).toBe('/admin-dashboard?tab=home&appointment=appt-1');
  });

  it('exposes an accept action for counter-proposals with a suggested time id', () => {
    const [g] = deriveNotificationGroups(
      [
        item({
          event_type: 'cleaner_counter_proposed',
          payload: { suggested_time_id: 'st-1', suggested_time: '14:00' },
        }),
      ],
      NOW,
    );
    expect(g.latest.action?.kind).toBe('accept');
    expect(g.latest.action?.suggestedTimeId).toBe('st-1');
    expect(g.latest.action?.label.startsWith('Accept')).toBe(true);
  });

  it('omits the accept action when the suggested time id is missing', () => {
    const [g] = deriveNotificationGroups(
      [item({ event_type: 'cleaner_counter_proposed', payload: { suggested_time: '14:00' } })],
      NOW,
    );
    expect(g.latest.action).toBeUndefined();
  });

  it('exposes an assign action for an exhausted chain', () => {
    const [g] = deriveNotificationGroups(
      [item({ event_type: 'chain_exhausted' })],
      NOW,
    );
    expect(g.latest.action?.kind).toBe('assign');
    expect(g.latest.action?.label).toBe('Assign cleaner');
  });
});

describe('homeownerNotificationHref (via deriveNotificationGroups role="homeowner")', () => {
  it('deep-links appointment notifications to the homeowner dashboard', () => {
    const [g] = deriveNotificationGroups(
      [item({ appointment_id: 'appt-7', event_type: 'job_started' })],
      NOW,
      'homeowner',
    );
    expect(g.latest.href).toBe('/app/homeowner-dashboard?appointment=appt-7');
  });

  it('falls back to the homeowner dashboard for appointment-less events', () => {
    const [g] = deriveNotificationGroups(
      [item({ appointment_id: null, event_type: 'something_else' })],
      NOW,
      'homeowner',
    );
    expect(g.latest.href).toBe('/app/homeowner-dashboard');
  });
});
