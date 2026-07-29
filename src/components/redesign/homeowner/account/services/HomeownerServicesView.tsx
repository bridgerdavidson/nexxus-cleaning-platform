'use client';

import { ChevronRight, Sparkles } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { CatalogRowVM } from '@/components/redesign/cleaner/profile/profile-types';

export interface HomeownerServicesViewProps {
  rows: CatalogRowVM[];
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
  onOpen: (id: string) => void;
}

export function HomeownerServicesView({ rows, loading, error, onRetry, onOpen }: HomeownerServicesViewProps) {
  if (error) {
    return (
      <div className="py-8">
        <ErrorState title="Couldn't load services" onRetry={onRetry} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2.5 pt-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[68px] w-full rounded-card" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-8">
        <EmptyState
          icon={<Sparkles />}
          title="No services yet"
          description="Your cleaning company has not listed services yet."
        />
      </div>
    );
  }

  return (
    <div className="space-y-2.5 pt-1">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={() => onOpen(row.id)}
          className="flex w-full items-center gap-3 rounded-card border border-border bg-card p-3.5 text-left shadow-soft-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-50 text-brand-ink">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-bold text-foreground">{row.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {row.serviceTypeLabel} · {row.durationLabel}
            </span>
          </span>
          <span className="shrink-0 text-sm font-bold tabular-nums text-foreground">{row.priceLabel}</span>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      ))}
    </div>
  );
}
