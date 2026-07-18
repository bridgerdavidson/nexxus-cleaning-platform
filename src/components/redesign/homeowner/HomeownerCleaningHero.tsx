'use client';

import type { Appointment } from '@/hooks/useHomeownerData';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CalendarPlus, ChevronRight } from 'lucide-react';
import {
  deriveHeroState,
  homeownerStatusLabel,
  cleanerDisplayName,
  formatCleaningWhen,
  canBookAgain,
} from './home/home-presenters';
import { LiveCleaningProgress } from './home/LiveCleaningProgress';
import { RecentCleaningCard } from './home/RecentCleaningCard';
import { useOpenBooking } from './booking/useOpenBooking';

const TONE_TO_VARIANT = {
  default: 'default',
  secondary: 'secondary',
  positive: 'positive',
  caution: 'caution',
  critical: 'critical',
} as const;

const HERO_CARD_CLASS =
  'rounded-card bg-gradient-to-br from-brand-600 to-brand-500 p-5 text-white shadow-soft-lg';

export function HomeownerCleaningHero({
  appointment,
  onOpen,
}: {
  appointment: Appointment | null;
  /** Open the cleaning detail. When supplied, the whole hero is tap-to-open. */
  onOpen?: (id: string) => void;
}) {
  const openBooking = useOpenBooking();
  const state = deriveHeroState(appointment);

  if (state === 'empty' || !appointment) {
    return (
      <div className="rounded-card border border-border bg-card p-6 text-center shadow-soft-md">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-pill bg-muted text-muted-foreground">
          <CalendarPlus className="h-6 w-6" aria-hidden />
        </div>
        <p className="text-base font-semibold">No cleaning scheduled</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Request a cleaning and we will take it from here.
        </p>
      </div>
    );
  }

  // A finished cleaning is calm, not loud: one tappable summary card, plus a one-tap
  // "Book this again" (prefills the same home + service). The bold blue hero (below) is
  // reserved for what still needs attention (next / in-progress).
  if (state === 'complete') {
    return (
      <div className="flex flex-col gap-3">
        <RecentCleaningCard appointment={appointment} onOpen={onOpen} />
        {/* Home only (onOpen present). The detail sheet renders this hero as a static
            header with no onOpen and carries its own "Book again", so gating here keeps
            the detail from showing two identical primary CTAs. */}
        {onOpen && canBookAgain(appointment) && (
          <Button
            className="w-full"
            onClick={() =>
              openBooking({
                propertyId: appointment.property_id,
                serviceTypeId: appointment.service_type_id,
              })
            }
          >
            <CalendarPlus aria-hidden />
            Book this again
          </Button>
        )}
      </div>
    );
  }

  const { label, tone } = homeownerStatusLabel(appointment.status);
  const cleaner = cleanerDisplayName(appointment);
  const heading = state === 'in_progress' ? 'Cleaning in progress' : 'Your next cleaning';
  const when = formatCleaningWhen(appointment.scheduled_date, appointment.scheduled_time);
  const interactive = !!onOpen;

  const body = (
    <>
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/85">{heading}</p>
        <Badge variant={TONE_TO_VARIANT[tone]} className="border-white/20 bg-white/20 text-white">
          {label}
        </Badge>
      </div>
      <p className="mt-2 text-xl font-extrabold tabular-nums">{when}</p>
      <p className="text-sm text-white/90">
        {appointment.property?.address ?? appointment.property?.name ?? 'Your home'}
        {appointment.service_type?.name ? ` · ${appointment.service_type.name}` : ''}
      </p>
      {cleaner && (
        <div className="mt-4 flex items-center gap-3 border-t border-white/20 pt-3">
          <Avatar className="size-9">
            <AvatarFallback className="bg-white/30 text-white">{cleaner.charAt(0)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-semibold">{cleaner}</p>
            <p className="text-xs text-white/80">Your cleaner</p>
          </div>
        </div>
      )}
      {state === 'in_progress' && <LiveCleaningProgress appointment={appointment} />}
      {interactive && (
        <div className="mt-4 flex items-center justify-end gap-0.5 text-xs font-bold text-white/90">
          Details
          <ChevronRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </div>
      )}
    </>
  );

  if (!interactive) {
    return <div className={HERO_CARD_CLASS}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpen!(appointment.id)}
      aria-label={`${heading}: ${when}. ${label}. View details`}
      className={`group ${HERO_CARD_CLASS} block w-full text-left transition-all duration-base ease-out-soft active:scale-[.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
    >
      {body}
    </button>
  );
}
