"use client";

import React from "react";
import { ChevronRight, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { DeclineReason } from "@/hooks/useCleanerData";
import type { TodayData } from "./today-types";
import { formatTimeParts, propertyTitle, jobSubtitle, formatRespondBy } from "../shared/job-presenters";
import { JobRow } from "../shared/JobRow";
import { OfferActionsBar } from "../shared/OfferActionsBar";

function SectionHeader({ title, trailing }: { title: string; trailing?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 px-0.5">
      <h2 className="text-sm font-bold">{title}</h2>
      {trailing}
    </div>
  );
}

export function CleanerTodayView({
  data,
  loading,
  onContinueActive,
  onAcceptOffer,
  onDeclineOffer,
  onOpenJob,
  onSeeTomorrow,
}: {
  data: TodayData;
  loading: boolean;
  onContinueActive: () => void;
  onAcceptOffer: (id: string, slotIndex: number) => Promise<unknown> | void;
  onDeclineOffer: (id: string, reason: DeclineReason, other?: string) => Promise<unknown> | void;
  onOpenJob: (id: string) => void;
  onSeeTomorrow: () => void;
}) {
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
    return (
      <div className="pt-10">
        <EmptyState
          icon={<Sparkles />}
          title="Nothing scheduled"
          description="When you have jobs or new offers, they'll show up here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-7 pt-2">
      {data.activeJob && (
        <section>
          <div className="rounded-card bg-brand-600 p-4 text-white shadow-soft-lg">
            <div className="text-[10px] font-extrabold tracking-widest opacity-85">ACTIVE JOB</div>
            <div className="mt-0.5 text-lg font-extrabold">{propertyTitle(data.activeJob)}</div>
            <div className="text-xs opacity-90">{jobSubtitle(data.activeJob)}</div>
            <button
              onClick={onContinueActive}
              className="mt-3 w-full rounded-pill bg-white py-3 text-sm font-extrabold text-brand-600 outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              Continue job
            </button>
          </div>
        </section>
      )}

      {data.offers.length > 0 && (
        <section>
          <SectionHeader
            title="Needs your response"
            trailing={
              <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[11px] font-extrabold text-brand-700">
                {data.offers.length}
              </span>
            }
          />
          <div className="space-y-3">
            {data.offers.map((o) => {
              const t = formatTimeParts(o.scheduled_time);
              const respondBy = formatRespondBy(o.response_deadline);
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
                        {t.h} {t.ap}
                      </div>
                      {respondBy && (
                        <Badge variant="caution"><Clock />{respondBy}</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-sm font-semibold">{propertyTitle(o)}</div>
                    <div className="text-xs text-muted-foreground">{jobSubtitle(o)}</div>
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
            title="Today"
            trailing={
              <span className="ml-auto text-xs font-medium text-muted-foreground">
                {data.todayJobs.length} jobs
              </span>
            }
          />
          <div className="space-y-2.5">
            {data.todayJobs.map((j) => (
              <JobRow key={j.id} appointment={j} onClick={() => onOpenJob(j.id)} />
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
    </div>
  );
}
