import {
  CalendarPlus,
  CalendarClock,
  UserCheck,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  AlarmClock,
  Banknote,
  PlayCircle,
  Sparkles,
  ShieldAlert,
  CreditCard,
  Bell,
  UserPlus,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import { formatTimeTo12h, formatDateShort } from '../formatTime';
import type { NotificationEventType } from './eventTypes';

/**
 * Presentation metadata for a notification row: a two-line label (bold `title`
 * + muted `detail`), a tone (drives the bell icon color), and a lucide icon.
 * Pure (no React) so it's unit-testable and shared by the bell list + the live
 * toast. `describeNotification` reads the denormalized fields written into the
 * row's `payload` at emit time; every field is optional, so a row with no
 * context still renders sensible generic copy. No em dashes (user-facing copy).
 */
export type NotificationTone = 'success' | 'error' | 'warning' | 'info';

export interface NotificationDescriptor {
  title: string;
  detail?: string;
  tone: NotificationTone;
  icon: LucideIcon;
}

type Payload = Record<string, unknown> | null | undefined;

function str(payload: Payload, key: string): string | undefined {
  const v = payload?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(payload: Payload, key: string): number | undefined {
  const v = payload?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function money(cents: number | undefined): string | undefined {
  if (cents === undefined) return undefined;
  return `$${(cents / 100).toFixed(2)}`;
}

/** "MM/DD/YY at h:mm AM/PM", or whichever half is present. */
function whenLabel(date?: string, time?: string): string | undefined {
  const d = date ? formatDateShort(date) : '';
  const t = time ? formatTimeTo12h(time) : '';
  if (d && t) return `${d} at ${t}`;
  return d || t || undefined;
}

function joinDetail(...parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((p): p is string => !!p && p.trim().length > 0);
  return kept.length ? kept.join(' • ') : undefined;
}

function dueDateLabel(iso?: string): string | undefined {
  if (!iso) return undefined;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function build(eventType: NotificationEventType, payload: Payload): NotificationDescriptor {
  const cleaner = str(payload, 'cleaner_name');
  const nextCleaner = str(payload, 'next_cleaner_name');
  const customer = str(payload, 'customer_name');
  const property = str(payload, 'property_label');
  const date = str(payload, 'scheduled_date');
  const time = str(payload, 'scheduled_time');
  const when = whenLabel(date, time);
  const dateShort = date ? formatDateShort(date) : undefined;
  const timeShort = time ? formatTimeTo12h(time) : undefined;
  const amount = money(num(payload, 'amount_cents'));

  switch (eventType) {
    case 'homeowner_request_submitted':
      return {
        title: customer ? `New booking request from ${customer}` : 'New booking request',
        detail: joinDetail(property, when),
        tone: 'info',
        icon: CalendarPlus,
      };

    case 'cleaner_assigned':
      return {
        title: 'New job assigned to you',
        detail: joinDetail(property, when),
        tone: 'info',
        icon: UserCheck,
      };

    case 'cleaner_force_assigned':
      return {
        title: 'A job was assigned to you',
        detail: joinDetail(property, when),
        tone: 'info',
        icon: UserCheck,
      };

    case 'cleaner_accepted': {
      const forHomeowner = str(payload, 'audience') === 'homeowner';
      if (forHomeowner) {
        return {
          title: cleaner ? `${cleaner} is confirmed for your cleaning` : 'Your cleaning is confirmed',
          detail: when,
          tone: 'success',
          icon: CheckCircle,
        };
      }
      return {
        title: cleaner ? `${cleaner} accepted a job` : 'Cleaner accepted the job',
        detail: joinDetail(when, property),
        tone: 'success',
        icon: CheckCircle,
      };
    }

    case 'cleaner_declined': {
      const reassigned = !!nextCleaner;
      return {
        title: cleaner ? `${cleaner} declined a job` : 'Cleaner declined the job',
        detail: reassigned ? `Reassigned to ${nextCleaner}` : 'Needs a new cleaner',
        tone: reassigned ? 'warning' : 'error',
        icon: XCircle,
      };
    }

    case 'chain_exhausted':
      return {
        title: 'All cleaners declined, action needed',
        detail: joinDetail(property, when),
        tone: 'error',
        icon: AlertTriangle,
      };

    case 'cleaner_counter_accepted':
      return {
        title: 'Your proposed time was accepted',
        detail: joinDetail(when, property),
        tone: 'success',
        icon: CheckCircle,
      };

    case 'appointment_rescheduled': {
      // Historical rows have no flag; treat missing as the old re-confirm meaning.
      const requiresConfirmation = payload?.['requires_confirmation'] !== false;
      return {
        title: 'A job was rescheduled',
        detail: requiresConfirmation ? joinDetail(when, 'Please re-confirm') : joinDetail(when, property),
        tone: requiresConfirmation ? 'warning' : 'info',
        icon: CalendarClock,
      };
    }

    case 'appointment_time_changed':
      return {
        title: when ? `Your cleaning moved to ${when}` : 'Your cleaning was moved',
        detail: property,
        tone: 'info',
        icon: CalendarClock,
      };

    case 'cleaner_counter_proposed': {
      const suggested = whenLabel(str(payload, 'suggested_date'), str(payload, 'suggested_time'));
      const count = num(payload, 'suggested_times_count');
      const detail =
        suggested ??
        (count && count > 0
          ? `${count} alternative ${count === 1 ? 'time' : 'times'}`
          : undefined);
      return {
        title: cleaner ? `${cleaner} proposed a new time` : 'Cleaner proposed a new time',
        detail,
        tone: 'warning',
        icon: Clock,
      };
    }

    case 'cleaner_response_overdue':
      return {
        title: cleaner ? `${cleaner} hasn't responded` : 'Cleaner response overdue',
        detail: joinDetail('Response overdue', property),
        tone: 'warning',
        icon: AlarmClock,
      };

    case 'cleaner_paid':
      return {
        title: amount ? `You were paid ${amount}` : 'You were paid',
        detail: joinDetail(property, dateShort),
        tone: 'success',
        icon: Banknote,
      };

    case 'job_started':
      return {
        title: cleaner ? `${cleaner} started the cleaning` : 'Cleaning started',
        detail: joinDetail(property, timeShort),
        tone: 'info',
        icon: PlayCircle,
      };

    case 'job_completed':
      return {
        title: cleaner ? `${cleaner} finished the cleaning` : 'Cleaning completed',
        detail: property,
        tone: 'success',
        icon: Sparkles,
      };

    case 'job_message': {
      const sender = str(payload, 'sender_name');
      return {
        title: sender ? `New message from ${sender}` : 'New message',
        detail: str(payload, 'snippet'),
        tone: 'info',
        icon: MessageSquare,
      };
    }

    case 'dispute_opened': {
      const due = dueDateLabel(str(payload, 'evidence_due_by'));
      return {
        title: 'Payment dispute opened',
        detail: joinDetail(amount, due ? `respond by ${due}` : undefined),
        tone: 'error',
        icon: ShieldAlert,
      };
    }

    case 'authorization_failed':
      return {
        title: customer ? `Card hold failed for ${customer}` : 'Card hold failed',
        detail: joinDetail(property, amount),
        tone: 'error',
        icon: CreditCard,
      };

    case 'authentication_required': {
      const forHomeowner = str(payload, 'audience') === 'homeowner';
      if (forHomeowner) {
        return {
          title: 'Confirm your card to secure your booking',
          detail: joinDetail(property, when),
          tone: 'warning',
          icon: ShieldAlert,
        };
      }
      return {
        title: customer ? `Card needs verification for ${customer}` : 'Card needs identity verification',
        detail: joinDetail(property, amount),
        tone: 'warning',
        icon: ShieldAlert,
      };
    }

    case 'charge_failed': {
      const needsAuth = str(payload, 'reason') === 'authentication_required';
      if (str(payload, 'audience') === 'homeowner') {
        if (needsAuth) {
          return {
            title: 'Confirm your payment',
            detail: joinDetail('Your bank needs to verify your card', property, when),
            tone: 'warning',
            icon: ShieldAlert,
          };
        }
        return {
          title: 'Payment failed',
          detail: joinDetail("We couldn't charge your card for your cleaning", amount, when),
          tone: 'error',
          icon: CreditCard,
        };
      }
      if (needsAuth) {
        return {
          title: customer ? `Card needs verification for ${customer}` : 'Card needs identity verification',
          detail: joinDetail('Completed job not yet paid', property, amount),
          tone: 'warning',
          icon: ShieldAlert,
        };
      }
      return {
        title: customer ? `Payment failed for ${customer}` : 'Payment failed for a completed job',
        detail: joinDetail(property, amount),
        tone: 'error',
        icon: CreditCard,
      };
    }

    case 'cancellation_fee_failed': {
      const reason = str(payload, 'reason');
      const why =
        reason === 'no_card'
          ? 'No saved card'
          : reason === 'ach_payer'
            ? 'Customer pays by bank'
            : reason === 'no_customer' || reason === 'tenant_not_ready'
              ? 'Not chargeable'
              : 'Card declined';
      return {
        title: customer ? `Cancellation fee not collected from ${customer}` : 'Cancellation fee not collected',
        detail: joinDetail(why, amount),
        tone: 'warning',
        icon: CreditCard,
      };
    }

    case 'self_pay_no_card':
      return {
        title: 'Company payment method needed',
        detail: joinDetail('A completed self-pay job has nothing to charge', property),
        tone: 'error',
        icon: CreditCard,
      };

    case 'cancelled_job_refunded':
      return {
        title: customer ? `Refund issued to ${customer}` : 'Refund issued for a cancelled job',
        detail: joinDetail('Bank payment settled after the cancellation', amount),
        tone: 'info',
        icon: Banknote,
      };

    case 'refund_failed':
      return {
        title: customer ? `Refund to ${customer} did not go through` : 'A refund did not go through',
        detail: joinDetail('The customer has not received the money', amount),
        tone: 'error',
        icon: AlertTriangle,
      };

    case 'clawback_blocked':
      return {
        title: cleaner ? `Payout recovery needs review for ${cleaner}` : 'Payout recovery needs review',
        detail: joinDetail('The money already reached their bank', amount),
        tone: 'warning',
        icon: AlertTriangle,
      };

    case 'member_joined': {
      const name = str(payload, 'member_name');
      const memberRole = str(payload, 'member_role');
      const isCustomer = memberRole === 'homeowner';
      const roleText = memberRole
        ? memberRole.charAt(0).toUpperCase() + memberRole.slice(1)
        : undefined;
      return {
        title: name
          ? isCustomer
            ? `${name} joined as a customer`
            : `${name} joined your team`
          : isCustomer
            ? 'A new customer joined'
            : 'A new team member joined',
        detail: isCustomer ? undefined : roleText,
        tone: 'info',
        icon: UserPlus,
      };
    }

    default:
      return FALLBACK;
  }
}

const FALLBACK: NotificationDescriptor = { title: 'Update', tone: 'info', icon: Bell };

const KNOWN_TYPES = new Set<string>([
  'homeowner_request_submitted',
  'cleaner_assigned',
  'cleaner_force_assigned',
  'cleaner_counter_accepted',
  'appointment_rescheduled',
  'cleaner_accepted',
  'cleaner_declined',
  'chain_exhausted',
  'cleaner_counter_proposed',
  'cleaner_response_overdue',
  'cleaner_paid',
  'job_started',
  'job_completed',
  'dispute_opened',
  'authorization_failed',
  'authentication_required',
  'charge_failed',
  'cancellation_fee_failed',
  'self_pay_no_card',
  'cancelled_job_refunded',
  'refund_failed',
  'clawback_blocked',
  'job_message',
  'appointment_time_changed',
  'member_joined',
]);

/**
 * Describe a notification for display. Unknown/future event types get a safe
 * fallback so an unrecognized row never crashes the bell.
 */
export function describeNotification(
  eventType: string,
  payload?: Payload,
): NotificationDescriptor {
  if (!KNOWN_TYPES.has(eventType)) return FALLBACK;
  return build(eventType as NotificationEventType, payload);
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
