import {
  CalendarPlus,
  UserCheck,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  AlarmClock,
  Bell,
  type LucideIcon,
} from 'lucide-react';
import type { NotificationEventType } from './eventTypes';

/**
 * Presentation metadata for each notification event_type: a short human label,
 * a tone (drives the icon color in the bell), and a lucide icon. Kept pure (no
 * React) so it's unit-testable and shared by the bell list + the live toast.
 *
 * No em dashes in labels (user-facing copy rule).
 */
export type NotificationTone = 'success' | 'error' | 'warning' | 'info';

export interface NotificationDescriptor {
  label: string;
  tone: NotificationTone;
  icon: LucideIcon;
}

const DESCRIPTORS: Record<NotificationEventType, NotificationDescriptor> = {
  homeowner_request_submitted: { label: 'New booking request', tone: 'info', icon: CalendarPlus },
  cleaner_assigned: { label: 'You were assigned a job', tone: 'info', icon: UserCheck },
  cleaner_force_assigned: { label: 'A job was assigned to you', tone: 'info', icon: UserCheck },
  cleaner_accepted: { label: 'Cleaner accepted the job', tone: 'success', icon: CheckCircle },
  cleaner_declined: { label: 'Cleaner declined the job', tone: 'error', icon: XCircle },
  cleaner_counter_proposed: { label: 'Cleaner proposed a new time', tone: 'warning', icon: Clock },
  chain_exhausted: { label: 'All cleaners declined, action needed', tone: 'error', icon: AlertTriangle },
  cleaner_response_overdue: { label: 'Cleaner response overdue', tone: 'warning', icon: AlarmClock },
};

const FALLBACK: NotificationDescriptor = { label: 'Update', tone: 'info', icon: Bell };

/** Describe any event_type for display. Unknown/future types get a safe fallback. */
export function describeNotification(eventType: string): NotificationDescriptor {
  return DESCRIPTORS[eventType as NotificationEventType] ?? FALLBACK;
}

const TONE_TO_TOAST: Record<NotificationTone, 'success' | 'error' | 'info'> = {
  success: 'success',
  error: 'error',
  warning: 'info',
  info: 'info',
};

/** Map a notification tone to a ToastContext variant (which has no 'warning'). */
export function toastVariantForTone(tone: NotificationTone): 'success' | 'error' | 'info' {
  return TONE_TO_TOAST[tone];
}
