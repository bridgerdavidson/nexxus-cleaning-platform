'use client';

import type { Appointment } from '@/hooks/useHomeownerData';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import {
  homeownerStatusLabel,
  cleanerDisplayName,
  formatCleaningWhen,
} from '../home/home-presenters';
import { stripeNewChargeFlowUiEnabled } from '@/lib/stripe/flags';
import { paymentAlertBadge } from '../home/derivePaymentAlerts';

const TONE_TO_VARIANT = {
  default: 'default',
  secondary: 'secondary',
  positive: 'positive',
  caution: 'caution',
  critical: 'critical',
} as const;

export function CleaningRow({
  appointment,
  onClick,
}: {
  appointment: Appointment;
  onClick: () => void;
}) {
  const { label, tone } = homeownerStatusLabel(appointment.status);
  // A cleaning can be "all done" and still have an unresolved payment; the row
  // must not read as settled green when the card needs the homeowner's action.
  // Same flag gate as the home banner and the detail's recovery section.
  const payBadge = stripeNewChargeFlowUiEnabled() ? paymentAlertBadge(appointment) : null;
  const cleaner = cleanerDisplayName(appointment);
  const where = appointment.property?.address ?? appointment.property?.name ?? 'Your home';
  const service = appointment.service_type?.name ?? 'Cleaning';

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-card border border-border bg-card p-4 text-left shadow-soft-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-bold">{service}</span>
          <Badge variant={TONE_TO_VARIANT[tone]} className="shrink-0">
            {label}
          </Badge>
          {payBadge && (
            <Badge variant={payBadge.tone} className="shrink-0">
              {payBadge.label}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm font-medium tabular-nums text-muted-foreground">
          {formatCleaningWhen(appointment.scheduled_date, appointment.scheduled_time)}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {where}
          {cleaner ? ` · ${cleaner}` : ''}
        </p>
      </div>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
    </button>
  );
}
