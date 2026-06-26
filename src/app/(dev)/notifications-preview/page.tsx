'use client';

import { useState } from 'react';
import { NotificationPanel } from '@/components/redesign/notifications/NotificationPanel';
import { deriveNotificationGroups } from '@/components/redesign/notifications/deriveNotifications';
import type { NotificationItem } from '@/hooks/useNotifications';

// Fixed "now" so relative-time labels are stable in screenshots.
const NOW = new Date('2026-06-25T18:00:00.000Z').getTime();

const ITEMS: NotificationItem[] = [
  {
    id: '1',
    event_type: 'cleaner_counter_proposed',
    payload: { cleaner_name: 'Wanda Jacobs', suggested_time_id: 'st1', suggested_time: '14:00', property_label: '123 Oak St' },
    appointment_id: 'ap1',
    organization_id: 'org1',
    created_at: '2026-06-25T17:58:00.000Z',
    in_app_dispatched_at: null,
  },
  {
    id: '2',
    event_type: 'chain_exhausted',
    payload: { property_label: '88 Pine Ave', scheduled_date: '2026-06-27', scheduled_time: '09:00' },
    appointment_id: 'ap2',
    organization_id: 'org1',
    created_at: '2026-06-25T17:30:00.000Z',
    in_app_dispatched_at: null,
  },
  {
    id: '3',
    event_type: 'cleaner_accepted',
    payload: { cleaner_name: 'Diego Torres', scheduled_date: '2026-06-26', scheduled_time: '10:00', property_label: '412 Pine St' },
    appointment_id: 'ap3',
    organization_id: 'org1',
    created_at: '2026-06-25T16:00:00.000Z',
    in_app_dispatched_at: null,
  },
  {
    id: '4',
    event_type: 'cleaner_assigned',
    payload: { property_label: '412 Pine St', scheduled_date: '2026-06-26', scheduled_time: '10:00' },
    appointment_id: 'ap3',
    organization_id: 'org1',
    created_at: '2026-06-25T15:00:00.000Z',
    in_app_dispatched_at: '2026-06-25T15:30:00.000Z',
  },
  {
    id: '5',
    event_type: 'cleaner_paid',
    payload: { amount_cents: 12000, property_label: '5 Birch Rd', scheduled_date: '2026-06-24' },
    appointment_id: 'ap4',
    organization_id: 'org1',
    created_at: '2026-06-24T12:00:00.000Z',
    in_app_dispatched_at: '2026-06-24T12:05:00.000Z',
  },
  {
    id: '6',
    event_type: 'member_joined',
    payload: { member_name: 'Priya Shah', member_role: 'homeowner' },
    appointment_id: null,
    organization_id: 'org1',
    created_at: '2026-06-23T12:00:00.000Z',
    in_app_dispatched_at: '2026-06-23T12:05:00.000Z',
  },
];

export default function NotificationsPreviewPage() {
  const groups = deriveNotificationGroups(ITEMS, NOW);
  const unreadCount = ITEMS.filter((n) => !n.in_app_dispatched_at).length;
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set(['ap3']));

  const toggleExpand = (key: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="redesign min-h-screen bg-background p-8 font-jakarta">
      <h1 className="mb-6 text-lg font-bold text-foreground">Notification panel preview</h1>
      <div className="flex flex-wrap gap-8">
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Populated</p>
          <div className="flex h-[32rem] w-[22rem] flex-col overflow-hidden rounded-card border border-border bg-popover shadow-soft-lg">
            <NotificationPanel
              groups={groups}
              loading={false}
              unreadCount={unreadCount}
              expandedKeys={expandedKeys}
              acceptingId={null}
              onOpen={() => {}}
              onAccept={() => {}}
              onToggleExpand={toggleExpand}
              onMarkAllRead={() => {}}
            />
          </div>
        </section>

        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Empty</p>
          <div className="flex h-[32rem] w-[22rem] flex-col overflow-hidden rounded-card border border-border bg-popover shadow-soft-lg">
            <NotificationPanel
              groups={[]}
              loading={false}
              unreadCount={0}
              expandedKeys={new Set()}
              acceptingId={null}
              onOpen={() => {}}
              onAccept={() => {}}
              onToggleExpand={() => {}}
              onMarkAllRead={() => {}}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
