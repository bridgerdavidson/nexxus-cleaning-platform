'use client';

import type { Appointment } from '@/hooks/useHomeownerData';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { CalendarPlus } from 'lucide-react';
import {
  deriveHeroState,
  homeownerStatusLabel,
  cleanerDisplayName,
  formatCleaningWhen,
} from './home/home-presenters';
import { LiveCleaningProgress } from './home/LiveCleaningProgress';
import { RecentCleaningCard } from './home/RecentCleaningCard';

const TONE_TO_VARIANT = {
  default: 'default',
  secondary: 'secondary',
  positive: 'positive',
  caution: 'caution',
  critical: 'critical',
} as const;

export function HomeownerCleaningHero({
  appointment,
  onOpen,
}: {
  appointment: Appointment | null;
  /** Open the cleaning detail (set on the completed "recent cleaning" card). */
  onOpen?: (id: string) => void;
}) {
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

  // A finished cleaning is calm, not loud: one tappable summary card. The bold blue hero
  // (below) is reserved for what still needs attention (next / in-progress).
  if (state === 'complete') {
    return <RecentCleaningCard appointment={appointment} onOpen={onOpen} />;
  }

  const { label, tone } = homeownerStatusLabel(appointment.status);
  const cleaner = cleanerDisplayName(appointment);
  const heading = state === 'in_progress' ? 'Cleaning in progress' : 'Your next cleaning';

  return (
    <div className="rounded-card bg-gradient-to-br from-brand-600 to-brand-500 p-5 text-white shadow-soft-lg">
      <div className="flex items-start justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/85">{heading}</p>
        <Badge variant={TONE_TO_VARIANT[tone]} className="border-white/20 bg-white/20 text-white">
          {label}
        </Badge>
      </div>
      <p className="mt-2 text-xl font-extrabold tabular-nums">
        {formatCleaningWhen(appointment.scheduled_date, appointment.scheduled_time)}
      </p>
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
    </div>
  );
}
