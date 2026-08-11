import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { BookingStatus } from './messages-types';

/** One role vocabulary for every messaging surface (D13). */
export const ROLE_LABEL: Record<string, string> = {
  homeowner: 'Homeowner',
  cleaner: 'Cleaner',
  manager: 'Manager',
  admin: 'Admin',
};

/** The muted role pill from the operator inbox row (the one sanctioned idiom). */
export function RolePill({ role }: { role: string }) {
  return (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground/65">
      {ROLE_LABEL[role] ?? role}
    </span>
  );
}

/**
 * status -> Badge variant, mirroring the bookings-presenters BADGE map (the
 * app-wide status-color source of truth; messages-pills.test.ts pins the two in
 * sync). Copy stays role-voiced per surface (audit section 5 decision), so this
 * map carries semantics only, never labels.
 */
export const BOOKING_STATUS_VARIANT = {
  pending: 'caution',
  confirmed: 'secondary',
  in_progress: 'default',
  completed: 'positive',
  cancelled: 'critical',
} as const satisfies Record<BookingStatus, NonNullable<BadgeProps['variant']>>;

/** Unread-count pill + sr-only announcement (D2). Renders nothing at zero. */
export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="flex shrink-0 items-center">
      <Badge
        variant="default"
        className="h-5 min-w-[1.25rem] justify-center rounded-full px-1.5 py-0 text-[10px] leading-5"
      >
        {count > 99 ? '99+' : count}
      </Badge>
      <span className="sr-only">{count} unread</span>
    </span>
  );
}
