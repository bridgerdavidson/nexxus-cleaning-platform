"use client";

import React, { useMemo } from "react";
import { AlertTriangle, Building2, ChevronRight, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { DeclineReason } from "@/hooks/useCleanerData";
import type { TodayData } from "./today-types";
import type { PayRequestRow } from "../earnings/derivePayRequests";
import { money2 } from "@/components/redesign/payments/payments-presenters";
import { formatTimeParts, formatJobWhen, propertyTitle, jobSubtitle, rowAddressLine, formatRespondBy } from "../shared/job-presenters";
import { JobRow } from "../shared/JobRow";
import { OfferActionsBar } from "../shared/OfferActionsBar";
import { deriveSeriesOffers } from "./deriveSeriesOffers";
import { SeriesOfferCard } from "./SeriesOfferCard";
import { CleanerNextUpCard } from "./CleanerNextUpCard";

function SectionHeader({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 px-0.5">
      <h2 className="text-sm font-bold">{title}</h2>
      {trailing}
    </div>
  );
}

/**
 * Money waiting on the cleaner: the org countered their pay request and the
 * thread cannot move until they respond. The full negotiation UI lives on
 * Earnings, but a cleaner who opens the app to "Nothing scheduled" has no
 * reason to go there, so Today carries the nudge. Renders in the empty state
 * too, for exactly that reason.
 */
function PayOffersSection({ rows, onOpen }: { rows: PayRequestRow[]; onOpen: () => void }) {
  return (
    <section>
      <SectionHeader
        title="Pay waiting on you"
        trailing={
          <span className="rounded-pill bg-caution-50 px-2 py-0.5 text-[11px] font-extrabold text-caution-700">
            {rows.length}
          </span>
        }
      />
      <div className="space-y-2.5">
        {rows.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={onOpen}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-card border border-border bg-card p-4 text-left shadow-soft-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {r.propertyLabel ?? r.jobLabel}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Your company offered a different amount. Tap to respond. · {r.ageLabel}
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="tabular-nums text-sm font-extrabold text-foreground">
                {money2(r.amountCents / 100)}
              </span>
              <ChevronRight aria-hidden className="h-4 w-4 text-muted-foreground" />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function CleanerTodayView({
  data,
  loading,
  error,
  onRetry,
  onContinueActive,
  onStartNext,
  startingNext,
  onAcceptOffer,
  onDeclineOffer,
  onAcceptSeries,
  onDeclineSeries,
  onOpenJob,
  onSeeTomorrow,
  todayStr,
  checklist,
  payOffers,
  onOpenPayOffers,
}: {
  data: TodayData;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  onContinueActive: () => void;
  onStartNext: (id: string) => void;
  startingNext: boolean;
  onAcceptOffer: (id: string, slotIndex: number) => Promise<unknown> | void;
  onDeclineOffer: (id: string, reason: DeclineReason, other?: string) => Promise<unknown> | void;
  onAcceptSeries: (seriesId: string) => Promise<unknown> | void;
  onDeclineSeries: (seriesId: string, reason: DeclineReason, other?: string) => Promise<unknown> | void;
  onOpenJob: (id: string) => void;
  onSeeTomorrow: () => void;
  todayStr: string;
  checklist?: React.ReactNode;
  /** Org counters waiting on this cleaner (derivePayRequests yourTurn). */
  payOffers?: PayRequestRow[];
  onOpenPayOffers?: () => void;
}) {
  const grouped = useMemo(() => deriveSeriesOffers(data.offers), [data.offers]);
  const offerCount = grouped.singles.length + grouped.series.length;
  const payOffersSection =
    payOffers && payOffers.length > 0 && onOpenPayOffers ? (
      <PayOffersSection rows={payOffers} onOpen={onOpenPayOffers} />
    ) : null;
  if (error) {
    return <ErrorState title="Couldn't load your day" onRetry={onRetry} />;
  }
  if (loading) {
    return (
      <div className="space-y-4 pt-2">
        <Skeleton className="h-40 w-full rounded-card" />
        <Skeleton className="h-20 w-full rounded-card" />
        <Skeleton className="h-16 w-full rounded-card" />
      </div>
    );
  }

  if (data.isEmpty) {
    // A pay offer must survive the empty state: "Nothing scheduled" is exactly
    // when the cleaner has no reason to wander to Earnings and find it.
    return (
      <div className={payOffersSection ? "space-y-7 pt-2" : "pt-10"}>
        {payOffersSection}
        <EmptyState
          icon={<Sparkles />}
          title="Nothing scheduled"
          description={
            data.isEmployee
              ? "When your office assigns you jobs, they'll show up here."
              : "When you have jobs or new offers, they'll show up here."
          }
        />
      </div>
    );
  }

  const activeAddress = data.activeJob ? rowAddressLine(data.activeJob) : null;

  return (
    <div className="space-y-7 pt-2">
      {data.activeJob && (
        <section>
          <div className="rounded-card bg-brand-600 p-4 text-white shadow-soft-lg">
            <div className="text-[10px] font-extrabold tracking-widest opacity-85">ACTIVE JOB</div>
            <div className="mt-0.5 text-lg font-extrabold">{propertyTitle(data.activeJob)}</div>
            <div className="text-xs opacity-90">{jobSubtitle(data.activeJob)}</div>
            {activeAddress && (
              <div className="mt-0.5 text-xs opacity-90">{activeAddress}</div>
            )}
            <button
              onClick={onContinueActive}
              className="mt-3 w-full rounded-pill bg-white py-3 text-sm font-extrabold text-brand-600 outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Continue job
            </button>
          </div>
        </section>
      )}

      {/* Pinned directly under the active card (or at the very top when nothing is
          active): the imminent job with one-tap Start + Directions. */}
      {data.nextUp && (
        <section>
          <h2 className="sr-only">Next up</h2>
          <CleanerNextUpCard
            appointment={data.nextUp}
            onStart={onStartNext}
            starting={startingNext}
            onOpenJob={onOpenJob}
          />
        </section>
      )}

      {payOffersSection}

      {checklist}

      {data.needsAttention.length > 0 && (
        <section>
          <SectionHeader
            title="Needs attention"
            trailing={
              <span className="inline-flex items-center gap-1 rounded-pill bg-caution-50 px-2 py-0.5 text-[11px] font-extrabold text-caution-700">
                <AlertTriangle className="size-3" aria-hidden />
                {data.needsAttention.length}
              </span>
            }
          />
          <div className="space-y-2.5">
            {data.needsAttention.map((j) => (
              <JobRow key={j.id} appointment={j} todayStr={todayStr} onClick={() => onOpenJob(j.id)} />
            ))}
          </div>
        </section>
      )}

      {offerCount > 0 && (
        <section>
          <SectionHeader
            title="Needs your response"
            trailing={
              <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[11px] font-extrabold text-brand-700">
                {offerCount}
              </span>
            }
          />
          <div className="space-y-3">
            {grouped.series.map((s) => (
              <SeriesOfferCard
                key={s.seriesId}
                series={s}
                onAcceptAll={onAcceptSeries}
                onDeclineAll={onDeclineSeries}
                onAcceptOne={(id, slot) => onAcceptOffer(id, slot)}
                onDeclineOne={(id, reason, other) => onDeclineOffer(id, reason, other)}
              />
            ))}
            {grouped.singles.map((o) => {
              const respondBy = formatRespondBy(o.response_deadline);
              const offerAddress = rowAddressLine(o);
              return (
                <div
                  key={o.id}
                  className="rounded-card border border-border bg-card p-4 shadow-soft-sm"
                >
                  <button
                    onClick={() => onOpenJob(o.id)}
                    className="block w-full rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-extrabold">
                        {formatJobWhen(o.scheduled_date, o.scheduled_time)}
                      </div>
                      {respondBy && (
                        <Badge variant="caution"><Clock />{respondBy}</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-semibold">{propertyTitle(o)}</div>
                    <div className="text-xs text-muted-foreground">{jobSubtitle(o)}</div>
                    {offerAddress && (
                      <div className="text-xs text-muted-foreground">{offerAddress}</div>
                    )}
                  </button>
                  <OfferActionsBar
                    appointment={o}
                    onAccept={(slot) => onAcceptOffer(o.id, slot)}
                    onDecline={(reason, other) => onDeclineOffer(o.id, reason, other)}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {data.todayJobs.length > 0 && (
        <section>
          <SectionHeader
            title={data.nextUp ? "Later today" : "Today"}
            trailing={
              <span className="ml-auto text-xs font-medium text-muted-foreground">
                {data.todayJobs.length} {data.todayJobs.length === 1 ? "job" : "jobs"}
              </span>
            }
          />
          <div className="space-y-2.5">
            {data.todayJobs.map((j) => (
              <JobRow key={j.id} appointment={j} todayStr={todayStr} onClick={() => onOpenJob(j.id)} />
            ))}
          </div>
        </section>
      )}

      {data.tomorrowCount > 0 && (
        <section>
          <SectionHeader title="Tomorrow" />
          <button
            onClick={onSeeTomorrow}
            className="flex w-full items-center gap-2 rounded-card border border-dashed border-border bg-card p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex-1 text-sm text-muted-foreground">
              <b className="text-foreground">
                {data.tomorrowCount} {data.tomorrowCount === 1 ? "job" : "jobs"}
              </b>
              {data.tomorrowFirstTime
                ? ` · first at ${formatTimeParts(data.tomorrowFirstTime).h} ${formatTimeParts(data.tomorrowFirstTime).ap}`
                : ""}
            </span>
            <ChevronRight aria-hidden className="h-5 w-5 text-muted-foreground" />
          </button>
        </section>
      )}

      {data.isEmployee && (
        <div className="flex items-start gap-2.5 rounded-card border border-border bg-muted/40 p-3.5 text-xs text-muted-foreground">
          <Building2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>Your office assigns your jobs. New assignments show up here and on your Schedule.</span>
        </div>
      )}
    </div>
  );
}
