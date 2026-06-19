import { KpiStrip } from "./KpiStrip";
import { NeedsYouNowQueue } from "./NeedsYouNowQueue";
import { TodayActivePanel } from "./TodayActivePanel";
import type { ActiveItem, OverviewKpis, QueueItem, ScheduleItem } from "./overview-types";

export type OperatorOverviewViewProps = {
  loading?: boolean;
  /** Visible page header. When omitted, a screen-reader-only h1 is used instead. */
  greeting?: string;
  dateLabel?: string;
  kpis: OverviewKpis;
  unassigned: QueueItem[];
  declined: QueueItem[];
  counterProposed: QueueItem[];
  today: ScheduleItem[];
  activeNow: ActiveItem[];
};

/** Pure presentational Overview: KPI strip + "Needs you now" centerpiece +
 *  Today/Active dispatch column. Fed by props (mock in preview; real hook data
 *  via OperatorOverview in the live page). */
export function OperatorOverviewView({
  loading,
  greeting,
  dateLabel,
  kpis,
  unassigned,
  declined,
  counterProposed,
  today,
  activeNow,
}: OperatorOverviewViewProps) {
  return (
    <div className="max-w-[1700px] space-y-5">
      {greeting ? (
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{greeting}</h1>
          {dateLabel ? <p className="mt-1 text-sm text-muted-foreground">{dateLabel}</p> : null}
        </header>
      ) : (
        <h1 className="sr-only">Operator Overview</h1>
      )}
      <KpiStrip kpis={kpis} loading={loading} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NeedsYouNowQueue
            unassigned={unassigned}
            declined={declined}
            counterProposed={counterProposed}
            loading={loading}
          />
        </div>
        <div className="lg:col-span-1">
          <TodayActivePanel today={today} activeNow={activeNow} loading={loading} />
        </div>
      </div>
    </div>
  );
}
