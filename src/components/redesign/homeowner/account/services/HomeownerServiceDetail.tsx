'use client';

import { CalendarPlus, Check, ChevronLeft, PackageOpen } from 'lucide-react';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useService } from '@/hooks/useServices';
import { useChecklists } from '@/hooks/useChecklists';
import { toCatalogDetail } from '@/components/redesign/cleaner/profile/deriveCatalog';
import { useOpenBooking } from '../../booking/useOpenBooking';

const REQUEST_CTA_CLASS =
  'flex w-full items-center justify-center gap-2 rounded-control bg-brand-600 py-3 text-sm font-bold text-white shadow-soft-sm transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function HomeownerServiceDetail({
  serviceId,
  onClose,
}: {
  serviceId: string;
  onClose: () => void;
}) {
  const { service, loading } = useService(serviceId);
  const { checklists, loading: checklistsLoading } = useChecklists(serviceId);
  const detail = service ? toCatalogDetail(service, checklists) : null;
  const openBooking = useOpenBooking();

  return (
    <MobileTakeover ariaLabel="Service details" keyboardAware={false} onClosed={onClose}>
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
              <div className="truncate text-sm font-bold">{detail?.name ?? 'Service'}</div>
            </div>
            <div className="w-1" />
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-lg space-y-4 px-5 pt-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
              {loading && !detail ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-48 rounded-pill" />
                  <Skeleton className="h-28 w-full rounded-card" />
                  <Skeleton className="h-28 w-full rounded-card" />
                </div>
              ) : !detail ? (
                <div className="pt-10">
                  <EmptyState
                    icon={<PackageOpen />}
                    title="Service not found"
                    description="This service may have been removed."
                  />
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5 text-sm font-semibold text-muted-foreground">
                    <span className="tabular-nums text-foreground">{detail.priceRangeLabel}</span>
                    <span aria-hidden>&middot;</span>
                    <span>{detail.durationLabel}</span>
                    <span aria-hidden>&middot;</span>
                    <span>{detail.serviceTypeLabel}</span>
                  </div>

                  {detail.description && (
                    <p className="px-0.5 text-sm leading-relaxed text-muted-foreground">
                      {detail.description}
                    </p>
                  )}

                  {checklistsLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-28 w-full rounded-card" />
                      <Skeleton className="h-28 w-full rounded-card" />
                    </div>
                  ) : detail.tiers.length === 0 ? (
                    <p className="px-0.5 pt-1 text-sm text-muted-foreground">
                      This service does not list checklists.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {detail.tiers.map((tier) => {
                        const included = tier.adderLabel === 'Included';
                        return (
                          <div
                            key={tier.id}
                            className="rounded-card border border-border bg-card p-4 shadow-soft-sm"
                          >
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <span className="text-[15px] font-extrabold text-foreground">
                                {tier.name}
                              </span>
                              <span
                                className={
                                  'rounded-pill px-2.5 py-0.5 text-xs font-bold ' +
                                  (included
                                    ? 'bg-positive-50 text-positive-700'
                                    : 'bg-brand-50 text-brand-700')
                                }
                              >
                                {tier.adderLabel}
                              </span>
                            </div>
                            {tier.tasks.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No tasks listed.</p>
                            ) : (
                              <ul className="space-y-2">
                                {tier.tasks.map((task) => (
                                  <li
                                    key={task.id}
                                    className="flex items-start gap-2.5 text-sm text-foreground/90"
                                  >
                                    <Check className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                                    <span>{task.task}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => openBooking({ serviceTypeId: serviceId })}
                      className={REQUEST_CTA_CLASS}
                    >
                      <CalendarPlus className="size-4" aria-hidden />
                      Request this cleaning
                    </button>
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
