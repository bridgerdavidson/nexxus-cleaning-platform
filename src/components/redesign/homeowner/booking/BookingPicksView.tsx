'use client';

import { Home, Sparkles, Plus, X, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Property } from '@/hooks/useHomeownerData';
import type { ServiceType } from '@/hooks/useServices';
import type { BookingState } from './booking-types';
import { MAX_SLOTS } from './booking-types';
import { canReview, slotOrdinal, formatSlotLabel } from './deriveBooking';
import { serviceMetaLabel } from './ServicePickerSheet';

export interface BookingPicksViewProps {
  state: BookingState;
  property: Property | null;
  service: ServiceType | null;
  onOpenProperty: () => void;
  onOpenService: () => void;
  onAddTime: () => void;
  onRemoveTime: (idx: number) => void;
  onNotesChange: (v: string) => void;
  onReview: () => void;
}

function PickRow({
  icon,
  title,
  subtitle,
  placeholder,
  onClick,
}: {
  icon: React.ReactNode;
  title: string | null;
  subtitle: string | null;
  placeholder: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-card border border-border bg-card p-4 text-left shadow-soft-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-600">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        {title ? (
          <>
            <div className="truncate text-sm font-bold text-foreground">{title}</div>
            {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
          </>
        ) : (
          <div className="text-sm font-semibold text-muted-foreground">{placeholder}</div>
        )}
      </div>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

export function BookingPicksView({
  state,
  property,
  service,
  onOpenProperty,
  onOpenService,
  onAddTime,
  onRemoveTime,
  onNotesChange,
  onReview,
}: BookingPicksViewProps) {
  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg space-y-5 px-5 pt-4 pb-6">
          <p className="text-sm text-muted-foreground">
            Tell us what and when. The office confirms a time and assigns your cleaner.
          </p>

          <div className="space-y-2">
            <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Home</p>
            <PickRow
              icon={<Home className="size-5" aria-hidden />}
              title={property?.name ?? null}
              subtitle={property?.address ?? null}
              placeholder="Choose a home"
              onClick={onOpenProperty}
            />
          </div>

          <div className="space-y-2">
            <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Service</p>
            <PickRow
              icon={<Sparkles className="size-5" aria-hidden />}
              title={service?.name ?? null}
              subtitle={service ? serviceMetaLabel(service.base_price, service.duration_minutes) : null}
              placeholder="Choose a service"
              onClick={onOpenService}
            />
          </div>

          <div className="space-y-2">
            <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Preferred times
            </p>
            {state.slots.map((slot, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-card border border-border bg-card p-3.5"
              >
                <span className="text-xs font-extrabold text-brand-700">{slotOrdinal(idx)}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                  {formatSlotLabel(slot)}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveTime(idx)}
                  aria-label={`Remove ${slotOrdinal(idx)} time`}
                  className="grid size-11 shrink-0 place-items-center rounded-control text-muted-foreground hover:text-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            ))}
            {state.slots.length < MAX_SLOTS && (
              <button
                type="button"
                onClick={onAddTime}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-card border border-dashed border-border py-3 text-sm font-bold text-brand-700 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-4" aria-hidden />
                {state.slots.length === 0 ? 'Add a time' : 'Add a backup time'}
              </button>
            )}
          </div>

          <div className="space-y-2">
            <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Notes for your cleaner (optional)
            </p>
            <Textarea
              value={state.notes}
              onChange={(e) => onNotesChange(e.target.value)}
              placeholder="Anything specific they should know?"
              rows={3}
            />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-card px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <Button className="w-full" disabled={!canReview(state)} onClick={onReview}>
          Review request
        </Button>
      </div>
    </>
  );
}
