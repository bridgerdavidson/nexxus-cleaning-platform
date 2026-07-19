/**
 * Pure view-model derivation for the redesign operator notification bell.
 *
 * Reuses the shared, already-tested `describeNotification` (labels/icons/tone)
 * and `notificationTab` (deep-link routing) so this module only handles
 * grouping, relative time, click destinations, and inline-action shape. No
 * React, so it is unit-testable in isolation. The bell (container) renders these
 * view-models; the panel (presentational) is dumb.
 */
import {
  describeNotification,
  type NotificationDescriptor,
} from '@/lib/notifications/labels';
import { notificationTab, type NotificationRole } from '@/lib/notifications/navigation';
import { formatTimeTo12h } from '@/lib/formatTime';
import type { NotificationItem } from '@/hooks/useNotifications';

/** An inline action surfaced on a notification row. */
export interface NotificationAction {
  kind: 'accept' | 'assign';
  /** Present for `accept`: the counter-proposed time the operator confirms. */
  suggestedTimeId?: string;
  label: string;
}

export interface NotificationItemVM {
  id: string;
  eventType: string;
  descriptor: NotificationDescriptor;
  relative: string;
  unread: boolean;
  appointmentId: string | null;
  organizationId: string;
  /** Where a click on this row should navigate. */
  href: string;
  /** For operator roles: the booking the row targets, when the destination is
   * the booking detail. The bell opens the sheet in place via the shell host
   * instead of navigating to `href`. Null when the row routes elsewhere. */
  bookingId: string | null;
  action?: NotificationAction;
}

/** A run of notifications sharing one appointment, newest first. */
export interface NotificationGroupVM {
  key: string;
  latest: NotificationItemVM;
  items: NotificationItemVM[];
  /** items.length - 1 (how many older updates are folded behind the latest). */
  moreCount: number;
  unreadIds: string[];
  anyUnread: boolean;
}

function payloadString(payload: NotificationItem['payload'], key: string): string | undefined {
  const v = payload?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Compact "just now / 5m ago / 3h ago / 2d ago / locale date". `now` is injected for testability. */
export function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.floor((now - then) / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Click destination for an operator notification.
 *
 * Appointment-scoped rows deep-link to the redesign booking detail
 * (`?booking=<id>` on the Bookings screen), except payment events, which land
 * on the Payments screen where the triage band surfaces them (Payments has no
 * per-appointment deep link). Appointment-less rows route to the most relevant
 * redesign screen.
 */
export function operatorNotificationHref(
  item: Pick<NotificationItem, 'event_type' | 'appointment_id'>,
): string {
  if (item.appointment_id) {
    const tab = notificationTab(item.event_type, 'admin');
    if (tab === 'payments') return '/admin/payments';
    return `/admin/bookings?booking=${item.appointment_id}`;
  }
  switch (item.event_type) {
    case 'member_joined':
      return '/admin/customers';
    case 'dispute_opened':
    case 'refund_failed':
    case 'cancelled_job_refunded':
    case 'self_pay_no_card':
    case 'clawback_blocked':
    case 'charge_failed':
    case 'authorization_failed':
    case 'authentication_required':
    case 'cancellation_fee_failed':
      return '/admin/payments';
    default:
      return '/admin';
  }
}

/**
 * Click destination for a cleaner notification.
 *
 * Appointment-scoped rows deep-link the in-redesign job detail (`?job=<id>`
 * opens the takeover via the layout-level host). Pay notifications go to the
 * Earnings screen. Everything else lands on the cleaner dashboard home.
 */
function cleanerNotificationHref(
  item: Pick<NotificationItem, 'event_type' | 'appointment_id'>,
): string {
  if (item.appointment_id) {
    return `/cleaner?job=${item.appointment_id}`;
  }
  if (item.event_type === 'cleaner_paid') {
    return '/cleaner/earnings';
  }
  return '/cleaner';
}

/**
 * Click destination for a homeowner notification. Appointment-scoped rows
 * deep-link the homeowner dashboard (its detail takeover opens on `?appointment=`,
 * built in Slice 2); a job_message routes to the conversation thread instead
 * (`?job=` opens the layout-mounted thread host, read-only after the window
 * closes); everything else lands on the homeowner home.
 */
function homeownerNotificationHref(
  item: Pick<NotificationItem, 'event_type' | 'appointment_id'>,
): string {
  if (item.appointment_id) {
    if (item.event_type === 'job_message') {
      return `/homeowner?job=${item.appointment_id}`;
    }
    return `/homeowner?appointment=${item.appointment_id}`;
  }
  return '/homeowner';
}

function notificationHref(
  item: Pick<NotificationItem, 'event_type' | 'appointment_id'>,
  role: NotificationRole,
): string {
  if (role === 'cleaner') return cleanerNotificationHref(item);
  if (role === 'homeowner') return homeownerNotificationHref(item);
  // admin and manager both use the operator console
  return operatorNotificationHref(item);
}

/** The booking a click should open in place (operator roles only): the same
 * appointment-scoped rows operatorNotificationHref sends to the booking
 * detail; payment-routed and appointment-less rows return null. */
function operatorBookingId(
  item: Pick<NotificationItem, 'event_type' | 'appointment_id'>,
  role: NotificationRole,
): string | null {
  if (role === 'cleaner' || role === 'homeowner') return null;
  if (!item.appointment_id) return null;
  return notificationTab(item.event_type, 'admin') === 'payments' ? null : item.appointment_id;
}

function deriveAction(item: NotificationItem): NotificationAction | undefined {
  if (item.event_type === 'cleaner_counter_proposed') {
    const suggestedTimeId = payloadString(item.payload, 'suggested_time_id');
    if (!suggestedTimeId) return undefined;
    const time = payloadString(item.payload, 'suggested_time');
    return {
      kind: 'accept',
      suggestedTimeId,
      label: time ? `Accept ${formatTimeTo12h(time)}` : 'Accept this time',
    };
  }
  if (item.event_type === 'chain_exhausted') {
    return { kind: 'assign', label: 'Assign cleaner' };
  }
  return undefined;
}

function toItemVM(item: NotificationItem, now: number, role: NotificationRole): NotificationItemVM {
  return {
    id: item.id,
    eventType: item.event_type,
    descriptor: describeNotification(item.event_type, item.payload),
    relative: relativeTime(item.created_at, now),
    unread: !item.in_app_dispatched_at,
    appointmentId: item.appointment_id,
    organizationId: item.organization_id,
    href: notificationHref(item, role),
    bookingId: operatorBookingId(item, role),
    action: deriveAction(item),
  };
}

/**
 * Group notifications by appointment (newest first), folding repeated updates
 * for the same job behind the latest. Items are expected newest-first (the hook
 * sorts by created_at desc), so the first row of each appointment is its latest.
 * Appointment-less rows stay solo.
 */
export function deriveNotificationGroups(
  items: NotificationItem[],
  now: number,
  role: NotificationRole = 'admin',
): NotificationGroupVM[] {
  const groups: NotificationGroupVM[] = [];
  const byAppointment = new Map<string, NotificationGroupVM>();

  for (const item of items) {
    const vm = toItemVM(item, now, role);
    if (item.appointment_id) {
      const existing = byAppointment.get(item.appointment_id);
      if (existing) {
        existing.items.push(vm);
        existing.moreCount = existing.items.length - 1;
        if (vm.unread) {
          existing.unreadIds.push(vm.id);
          existing.anyUnread = true;
        }
        continue;
      }
      const group: NotificationGroupVM = {
        key: item.appointment_id,
        latest: vm,
        items: [vm],
        moreCount: 0,
        unreadIds: vm.unread ? [vm.id] : [],
        anyUnread: vm.unread,
      };
      byAppointment.set(item.appointment_id, group);
      groups.push(group);
    } else {
      groups.push({
        key: `solo:${item.id}`,
        latest: vm,
        items: [vm],
        moreCount: 0,
        unreadIds: vm.unread ? [vm.id] : [],
        anyUnread: vm.unread,
      });
    }
  }

  return groups;
}
