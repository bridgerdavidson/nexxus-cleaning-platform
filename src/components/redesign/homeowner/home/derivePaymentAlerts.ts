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
 * Home-page payment alerts: one card per live (non-cancelled) cleaning whose
 * charge failed or bounced on bank verification. Completed cleanings are
 * deliberately INCLUDED; a failed charge on a finished job is exactly the case
 * the homeowner must not miss. Copy mirrors HomeownerPaymentRecovery's states.
 */
export function derivePaymentAlerts(appointments: Appointment[]): PaymentAlertVM[] {
  return appointments
    .filter((a) => a.status !== 'cancelled')
    .filter((a) => a.authorization_status === 'failed' || a.authorization_status === 'requires_action')
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
