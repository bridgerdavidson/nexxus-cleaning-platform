'use client';

import { AlertCircle, ChevronRight } from 'lucide-react';
import { stripeNewChargeFlowUiEnabled } from '@/lib/stripe/flags';
import type { Appointment } from '@/hooks/useHomeownerData';
import { derivePaymentAlerts } from './derivePaymentAlerts';

const TONE = {
  critical: { card: 'border-critical/30 bg-critical-50', text: 'text-critical-700' },
  caution: { card: 'border-caution/30 bg-caution-50', text: 'text-caution-700' },
} as const;

/**
 * Urgent payment alerts pinned to the top of the homeowner home page, so a
 * failed charge is unmissable without opening the cleaning. Tapping a card
 * opens that cleaning's detail takeover, where HomeownerPaymentRecovery offers
 * Update card / Pay now. Same alert treatment (critical/caution tokens,
 * AlertCircle) as the recovery card itself.
 */
export function HomeownerPaymentAlerts({
  appointments,
  onOpen,
}: {
  appointments: Appointment[];
  onOpen: (appointmentId: string) => void;
}) {
  if (!stripeNewChargeFlowUiEnabled()) return null;
  const alerts = derivePaymentAlerts(appointments);
  if (alerts.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-label="Payment alerts">
      {alerts.map((a) => {
        const tone = TONE[a.tone];
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => onOpen(a.id)}
            className={`w-full rounded-card border p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone.card}`}
          >
            <div className="flex items-start gap-3">
              <AlertCircle className={`mt-0.5 size-5 shrink-0 ${tone.text}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-bold ${tone.text}`}>{a.title}</div>
                <p className={`mt-0.5 text-sm ${tone.text}`}>{a.description}</p>
              </div>
              <ChevronRight className={`mt-0.5 size-5 shrink-0 ${tone.text}`} aria-hidden />
            </div>
          </button>
        );
      })}
    </section>
  );
}
