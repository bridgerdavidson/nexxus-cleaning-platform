'use client';

import { useState } from 'react';
import { CalendarClock, ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { HomeownerSeries } from './derive-homeowner-series';
import type { HomeownerStatusTone } from './home-presenters';
import { formatCleaningWhen, homeownerStatusLabel } from './home-presenters';

const TONE_VARIANT: Record<HomeownerStatusTone, 'default' | 'secondary' | 'positive' | 'caution' | 'critical'> = {
  default: 'default',
  secondary: 'secondary',
  positive: 'positive',
  caution: 'caution',
  critical: 'critical',
};

function monthDay(ymd: string): string {
  const [y, m, d] = (ymd ?? '').split('-').map(Number);
  if (!y || !m || !d) return ymd ?? '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function seriesRange(start: string, end: string): string {
  return start === end ? monthDay(start) : `${monthDay(start)} to ${monthDay(end)}`;
}

export function HomeownerRepeatingCard({
  series,
  onOpenCleaning,
}: {
  series: HomeownerSeries;
  onOpenCleaning: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const service = series.first.service_type?.name ?? 'Cleaning';
  const propertyLabel = series.first.property?.name ?? series.first.property?.address ?? 'Your home';

  return (
    <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-3 rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <CalendarClock className="size-4 text-brand-600" aria-hidden />
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-brand-700">Repeating cleaning</span>
          </div>
          <div className="mt-1 text-sm font-bold">{service}</div>
          <div className="truncate text-xs text-muted-foreground">{propertyLabel}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{series.count} cleanings</Badge>
            <span className="text-xs font-medium text-muted-foreground">
              {seriesRange(series.startDate, series.endDate)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge variant={TONE_VARIANT[series.status.tone]}>{series.status.label}</Badge>
          <ChevronDown
            className={cn('size-5 text-muted-foreground transition-transform', expanded && 'rotate-180')}
            aria-hidden
          />
        </div>
      </button>

      {expanded && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-3">
          {series.occurrences.map((o) => {
            const st = homeownerStatusLabel(o.status);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => onOpenCleaning(o.id)}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-control px-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="text-sm font-medium">{formatCleaningWhen(o.scheduled_date, o.scheduled_time)}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge variant={TONE_VARIANT[st.tone]}>{st.label}</Badge>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
