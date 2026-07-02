'use client';

import { ChevronRight } from 'lucide-react';
import type { Appointment } from '@/hooks/useHomeownerData';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useHomeownerJobPhotos } from '@/hooks/useHomeownerJobPhotos';
import { useHomeownerJobProgress } from '@/hooks/useHomeownerJobProgress';
import {
  formatCleaningWhen,
  cleanerDisplayName,
  recentCleaningTaskLabel,
  recentCleaningPaymentBadge,
} from './home-presenters';

const TONE_TO_VARIANT = {
  default: 'default',
  secondary: 'secondary',
  positive: 'positive',
  caution: 'caution',
  critical: 'critical',
} as const;

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

/**
 * The Home "recent cleaning" summary for a COMPLETED cleaning: one calm card (the bold blue
 * hero is reserved for next / in-progress cleanings, so salience follows urgency). Shows
 * when/where, a payment pill, the after-photo strip when present, and a cleaner + task/amount
 * footer.
 *
 * When `onOpen` is supplied (the Home screen) the whole card is a button that opens the full
 * Cleanings detail (`?appointment=`), with a "Details" affordance. When omitted (rendered AS the
 * detail's own header) it is a static, non-interactive summary, so it never links to itself.
 */
export function RecentCleaningCard({
  appointment,
  onOpen,
}: {
  appointment: Appointment;
  onOpen?: (id: string) => void;
}) {
  const { afterPhotos } = useHomeownerJobPhotos(appointment.id);
  const { doneCount, totalCount } = useHomeownerJobProgress(
    appointment.id,
    appointment.checklist_id ?? null,
  );

  const pay = recentCleaningPaymentBadge(appointment.payment_status);
  const cleaner = cleanerDisplayName(appointment);
  const taskLabel = recentCleaningTaskLabel(doneCount, totalCount);
  const statLine = [taskLabel, formatUsd(appointment.total_price)].filter(Boolean).join(' · ');
  const when = formatCleaningWhen(appointment.scheduled_date, appointment.scheduled_time);
  const where =
    (appointment.property?.address ?? appointment.property?.name ?? 'Your home') +
    (appointment.service_type?.name ? ` · ${appointment.service_type.name}` : '');
  const interactive = !!onOpen;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Recent cleaning
        </p>
        <Badge variant={TONE_TO_VARIANT[pay.tone]}>{pay.label}</Badge>
      </div>

      <p className="mt-2 text-lg font-extrabold tabular-nums text-foreground">{when}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{where}</p>

      {afterPhotos.length > 0 && (
        <div className="mt-4 flex gap-2 overflow-hidden">
          {afterPhotos.slice(0, 4).map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.id}
              src={p.photo_url}
              alt=""
              className="size-16 flex-none rounded-control object-cover"
            />
          ))}
          {afterPhotos.length > 4 && (
            <div className="grid size-16 flex-none place-items-center rounded-control bg-muted text-xs font-bold text-muted-foreground">
              +{afterPhotos.length - 4}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
        {cleaner && (
          <Avatar className="size-9">
            <AvatarFallback className="bg-muted text-muted-foreground">
              {cleaner.charAt(0)}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="min-w-0 flex-1">
          {cleaner && <p className="truncate text-sm font-semibold text-foreground">{cleaner}</p>}
          {statLine && (
            <p className="truncate text-xs tabular-nums text-muted-foreground">{statLine}</p>
          )}
        </div>
        {interactive && (
          <span className="flex shrink-0 items-center gap-0.5 text-xs font-bold text-brand-700">
            Details
            <ChevronRight
              className="size-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
        )}
      </div>
    </>
  );

  if (!interactive) {
    return (
      <div className="w-full rounded-card border border-border bg-card p-5 shadow-soft-sm">{body}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen!(appointment.id)}
      aria-label={`View your recent cleaning on ${when}`}
      className="group w-full rounded-card border border-border bg-card p-5 text-left shadow-soft-sm transition-all duration-base ease-out-soft hover:shadow-soft-md active:scale-[.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {body}
    </button>
  );
}
