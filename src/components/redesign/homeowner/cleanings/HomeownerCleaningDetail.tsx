'use client';

import { CalendarX, ChevronLeft } from 'lucide-react';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import type { Appointment } from '@/hooks/useHomeownerData';
import { HomeownerCleaningHero } from '../HomeownerCleaningHero';
import { formatCleaningWhen } from '../home/home-presenters';

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export function HomeownerCleaningDetail({
  appointment,
  loading,
  onClose,
}: {
  appointment: Appointment | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <MobileTakeover ariaLabel="Cleaning details" keyboardAware={false} onClosed={onClose}>
      {(close) => (
        <>
          <div className="flex items-center gap-2 border-b border-border px-2">
            <button
              onClick={close}
              aria-label="Back"
              className="grid size-11 place-items-center rounded-control text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-6" />
            </button>
            <div className="min-w-0 flex-1 py-2">
              <div className="truncate text-sm font-bold">
                {appointment?.service_type?.name ?? 'Cleaning'}
              </div>
            </div>
            <div className="w-1" />
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-lg space-y-5 px-5 pt-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
              {loading && !appointment ? (
                <>
                  <Skeleton className="h-40 w-full rounded-card" />
                  <Skeleton className="h-16 w-full rounded-card" />
                </>
              ) : !appointment ? (
                <div className="pt-10">
                  <EmptyState
                    icon={<CalendarX />}
                    title="Cleaning not available"
                    description="This cleaning may have been removed or is no longer on your account."
                  />
                </div>
              ) : (
                <>
                  <HomeownerCleaningHero appointment={appointment} />

                  <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
                    <div className="space-y-4">
                      <Field label="When">
                        {formatCleaningWhen(appointment.scheduled_date, appointment.scheduled_time)}
                      </Field>
                      <Separator />
                      <Field label="Where">
                        <div className="font-semibold">
                          {appointment.property?.name ?? 'Your home'}
                        </div>
                        {appointment.property?.address && (
                          <div className="text-muted-foreground">
                            {appointment.property.address}
                            {appointment.property.city ? `, ${appointment.property.city}` : ''}
                            {appointment.property.state ? `, ${appointment.property.state}` : ''}
                          </div>
                        )}
                      </Field>
                      <Separator />
                      <Field label="Service">
                        <div className="font-semibold">
                          {appointment.service_type?.name ?? 'Cleaning'}
                        </div>
                        {appointment.checklist?.name && (
                          <div className="text-muted-foreground">{appointment.checklist.name}</div>
                        )}
                      </Field>
                      {appointment.special_requests && (
                        <>
                          <Separator />
                          <Field label="Special requests">{appointment.special_requests}</Field>
                        </>
                      )}
                      <Separator />
                      <Field label="Price">
                        <span className="font-semibold tabular-nums">
                          {formatUsd(appointment.total_price)}
                        </span>
                      </Field>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </MobileTakeover>
  );
}
