import type { Appointment } from '@/hooks/useHomeownerData';

export type PaymentAlertVM = {
  /** Appointment id; the card opens this cleaning's detail (where R7 recovery lives). */
  id: string;
  tone: 'critical' | 'caution';
  title: string;
  description: string;
};

/** "2026-06-24" -> "June 24" without timezone drift (scheduled_date is a plain date). */
function cleaningDateLabel(scheduledDate: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(scheduledDate ?? '');
  if (!m) return null;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Whether this cleaning has a payment problem the HOMEOWNER can act on, and the
 * badge for it. Single source of truth for the home-page alert cards and the
 * Cleanings-list row badge, so the two surfaces can never disagree. Excludes
 * cancelled cleanings and self-pay (a comped booking keeps homeowner_id, but a
 * failed self-pay charge is the COMPANY card's failure, not the homeowner's).
 */
export function paymentAlertBadge(
  a: Appointment,
): { label: string; tone: 'critical' | 'caution' } | null {
  if (a.status === 'cancelled' || a.is_self_pay) return null;
  if (a.authorization_status === 'failed') return { label: 'Payment failed', tone: 'critical' };
  if (a.authorization_status === 'requires_action') return { label: 'Confirm payment', tone: 'caution' };
  return null;
}

/**
 * Home-page payment alerts: one card per live (non-cancelled) cleaning whose
 * charge failed or bounced on bank verification. Completed cleanings are
 * deliberately INCLUDED; a failed charge on a finished job is exactly the case
 * the homeowner must not miss. Copy mirrors HomeownerPaymentRecovery's states.
 */
export function derivePaymentAlerts(appointments: Appointment[]): PaymentAlertVM[] {
  return appointments
    .filter((a) => paymentAlertBadge(a) !== null)
    .map((a) => {
      const date = cleaningDateLabel(a.scheduled_date);
      const forCleaning = date ? `your cleaning on ${date}` : 'your recent cleaning';
      if (a.authorization_status === 'failed') {
        return {
          id: a.id,
          tone: 'critical' as const,
          title: 'Payment failed',
          description: `We couldn't charge your card for ${forCleaning}. Tap to update your card and finish payment.`,
        };
      }
      return {
        id: a.id,
        tone: 'caution' as const,
        title: 'Confirm your payment',
        description: `Your bank needs to verify your card for ${forCleaning}. Tap to update your card.`,
      };
    });
}
