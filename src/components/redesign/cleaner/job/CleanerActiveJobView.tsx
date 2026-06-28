'use client';

/**
 * CleanerActiveJobView — pure overview for an active job.
 *
 * No data fetching or side effects: it renders the job context, three tappable
 * section cards (Before / Checklist / After), and a persistent bottom Complete
 * bar. All state lives in the CleanerActiveJob container, which passes the
 * computed section summaries + photo gate down and the navigation callbacks up.
 */

import React from 'react';
import {
  Camera,
  ChevronRight,
  Clock,
  ListChecks,
  MapPin,
  MessageSquare,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CleanerAppointment } from '@/hooks/useCleanerData';
import type { ActiveJobGate } from './active-job-types';
import {
  propertyTitle,
  jobSubtitle,
  propertyAddress,
  formatJobWhen,
} from '../shared/job-presenters';
import { CleanerDirectionsButton } from '../shared/CleanerDirectionsButton';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single section card's display state: a human status line + a status pill. */
export interface SectionSummary {
  status: string;
  pillText: string;
  pillVariant: BadgeProps['variant'];
}

export interface CleanerActiveJobViewProps {
  appointment: CleanerAppointment;
  before: SectionSummary;
  checklist: SectionSummary;
  after: SectionSummary;
  gate: ActiveJobGate;
  onOpen: (screen: 'before' | 'checklist' | 'after') => void;
  onComplete: () => void;
  onSkipPhotos: () => void;
}

// ---------------------------------------------------------------------------
// Section card
// ---------------------------------------------------------------------------

function SectionCard({
  title,
  icon: Icon,
  summary,
  onClick,
}: {
  title: string;
  icon: LucideIcon;
  summary: SectionSummary;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[44px] w-full items-center gap-3 rounded-card border border-border bg-card p-4 text-left shadow-soft-sm',
        'transition-colors duration-base hover:bg-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-control bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{summary.status}</span>
      </span>
      <Badge variant={summary.pillVariant} className="shrink-0">
        {summary.pillText}
      </Badge>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CleanerActiveJobView({
  appointment,
  before,
  checklist,
  after,
  gate,
  onOpen,
  onComplete,
  onSkipPhotos,
}: CleanerActiveJobViewProps) {
  const addr = propertyAddress(appointment);
  const remainingHint = gate.remaining.join(', ');

  return (
    <div className="flex h-full flex-col bg-card">
      {/* ---- Scrollable body ---- */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-lg space-y-6 px-4 pt-5 pb-4">
          {/* Context block */}
          <section aria-label="Job details">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-brand-600">
              Active job
            </div>
            <h1 className="mt-1 text-lg font-bold leading-tight text-foreground">
              {propertyTitle(appointment)}
            </h1>
            {/* Customer name appears only here, via jobSubtitle */}
            <p className="text-sm text-muted-foreground">{jobSubtitle(appointment)}</p>

            {/* Icon-led meta rows: date-time + address */}
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="size-4 shrink-0" aria-hidden />
                <span>{formatJobWhen(appointment.scheduled_date, appointment.scheduled_time)}</span>
              </div>
              {addr && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin className="size-4 shrink-0" aria-hidden />
                  <span>{addr}</span>
                </div>
              )}
            </div>

            {/* Actions: Directions + Message office placeholder, side by side */}
            <div className="mt-4 flex items-stretch gap-3">
              <CleanerDirectionsButton address={addr ?? ''} className="flex-1" />
              {/* Office messaging arrives in Slice 5; placeholder kept visible
                  but disabled so the affordance is discoverable. */}
              <Button
                variant="outline"
                size="default"
                disabled
                aria-disabled="true"
                title="Coming soon"
                className="flex-1 gap-2"
              >
                <MessageSquare className="size-4" aria-hidden />
                Message office
              </Button>
            </div>
          </section>

          {/* Section cards */}
          <section aria-label="Job steps" className="space-y-3">
            <SectionCard
              title="Before photos"
              icon={Camera}
              summary={before}
              onClick={() => onOpen('before')}
            />
            <SectionCard
              title="Checklist"
              icon={ListChecks}
              summary={checklist}
              onClick={() => onOpen('checklist')}
            />
            <SectionCard
              title="After photos"
              icon={Camera}
              summary={after}
              onClick={() => onOpen('after')}
            />
          </section>
        </div>
      </div>

      {/* ---- Persistent Complete bar ---- */}
      <div
        className="border-t border-border bg-card px-4 pt-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
      >
        <div className="mx-auto w-full max-w-lg space-y-2">
          {!gate.canComplete && remainingHint && (
            <p className="text-center text-xs text-muted-foreground">{remainingHint}</p>
          )}
          <Button
            size="lg"
            className="w-full"
            disabled={!gate.canComplete}
            onClick={onComplete}
          >
            Complete job
          </Button>
          {!gate.canComplete && (
            <button
              type="button"
              onClick={onSkipPhotos}
              className="block min-h-[44px] w-full rounded-control text-center text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Can&apos;t add photos
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
