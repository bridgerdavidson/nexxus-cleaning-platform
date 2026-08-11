import { KpiStrip } from "./KpiStrip";
import { NeedsYouNowQueue } from "./NeedsYouNowQueue";
import { TodayPanel } from "./TodayPanel";
import { ErrorState } from "@/components/ui/error-state";
import type React from "react";
import type { OverviewKpis, QueueItem, TodayItem } from "./overview-types";

export type OperatorOverviewViewProps = {
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** Visible page header. When omitted, a screen-reader-only h1 is used instead. */
  greeting?: string;
  dateLabel?: string;
  kpis: OverviewKpis;
  unassigned: QueueItem[];
  declined: QueueItem[];
  counterProposed: QueueItem[];
  /** Cleaner response deadline passed with no answer (SLA blown). */
  overdue: QueueItem[];
  /** Completed jobs whose charge failed or needs authentication (uncollected money). */
  failedPayment: QueueItem[];
  /** Opens a booking's detail (deep-links to the Bookings screen). */
  onOpenBooking?: (appointmentId: string) => void;
  /** When set, the failed-payment group header links to the Payments screen. */
  paymentsHref?: string;
  /** Unified Today card rows (today's jobs ∪ in-progress jobs from any date). */
  todayItems: TodayItem[];
  /** Optional onboarding checklist or completion card rendered above the page header. */
  checklist?: React.ReactNode;
};

/** Pure presentational Overview: KPI strip + "Needs you now" centerpiece +
 *  Today/Active dispatch column. Fed by props (mock in preview; real hook data
 *  via OperatorOverview in the live page). */
export function OperatorOverviewView({
  loading,
  error,
  onRetry,
  greeting,
  dateLabel,
  kpis,
  unassigned,
  declined,
  counterProposed,
  overdue,
  failedPayment,
  onOpenBooking,
  paymentsHref,
  todayItems,
  checklist,
}: OperatorOverviewViewProps) {
  if (error) {
    return <ErrorState title="Couldn't load your dashboard" onRetry={onRetry} />;
  }
  return (
    <div className="space-y-5">
      {checklist}
      {greeting ? (
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting}</h1>
          {dateLabel ? <p className="mt-1 text-sm text-muted-foreground">{dateLabel}</p> : null}
        </header>
      ) : (
        <h1 className="sr-only">Operator Overview</h1>
      )}
      <KpiStrip kpis={kpis} loading={loading} />
      {/* min-w-0 on both grid items: without it the queue's nowrap row titles set the
          track's min-content width and blow the page out sideways on phones. */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <NeedsYouNowQueue
            unassigned={unassigned}
            declined={declined}
            counterProposed={counterProposed}
            overdue={overdue}
            failedPayment={failedPayment}
            loading={loading}
            onOpenBooking={onOpenBooking}
            paymentsHref={paymentsHref}
          />
        </div>
        <div className="min-w-0 lg:col-span-1">
          <TodayPanel items={todayItems} loading={loading} onOpenBooking={onOpenBooking} />
        </div>
      </div>
    </div>
  );
}
