'use client';

import { useMemo } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useHomeownerAppointments } from '@/hooks/useHomeownerData';
import { useHomeownerRequests } from '@/hooks/useHomeownerRequests';
import { pickHeroAppointment } from './home-presenters';
import { HomeownerCleaningHero } from '../HomeownerCleaningHero';
import { PendingRequestCard } from './PendingRequestCard';
import { useOpenCleaning } from '../cleanings/useOpenCleaning';
import { useOpenBooking } from '../booking/useOpenBooking';

function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function HomeownerHome() {
  const { appointments, loading } = useHomeownerAppointments();
  const { requests, cancelRequest, cancelling } = useHomeownerRequests();
  const openCleaning = useOpenCleaning();
  const openBooking = useOpenBooking();
  const hero = useMemo(() => pickHeroAppointment(appointments, todayStr()), [appointments]);

  return (
    <div className="flex flex-col gap-4 pb-8">
      {loading ? (
        <div className="h-40 animate-pulse rounded-card bg-muted" aria-hidden />
      ) : (
        <HomeownerCleaningHero appointment={hero} onOpen={openCleaning} />
      )}

      <button
        type="button"
        onClick={() => openBooking()}
        className="flex w-full items-center justify-center gap-2 rounded-control border border-border bg-card py-3 text-sm font-bold text-brand-600 shadow-soft-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CalendarPlus className="size-4" aria-hidden />
        Request a cleaning
      </button>

      {requests.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Pending requests
          </h2>
          {requests.map((r) => (
            <PendingRequestCard
              key={r.id}
              request={r}
              onCancel={cancelRequest}
              cancelling={cancelling}
            />
          ))}
        </section>
      )}

      {/* Persistent request FAB (phone-first; clears the bottom nav). */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg">
        <div className="pointer-events-auto absolute bottom-[88px] right-4">
          <button
            type="button"
            onClick={() => openBooking()}
            className="flex items-center gap-2 rounded-pill bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-soft-lg transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CalendarPlus className="size-4" aria-hidden />
            Request
          </button>
        </div>
      </div>
    </div>
  );
}
