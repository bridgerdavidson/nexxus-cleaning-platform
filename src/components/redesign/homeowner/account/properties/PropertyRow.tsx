'use client';

import { ChevronRight, Home } from 'lucide-react';
import type { Property } from '@/hooks/useHomeownerData';
import { propertyLocationLine, propertyStatsLabel } from './derive-properties';

export function PropertyRow({ property, onOpen }: { property: Property; onOpen: () => void }) {
  const loc = propertyLocationLine(property);
  const stats = propertyStatsLabel(property);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-card border border-border bg-card p-3.5 text-left shadow-soft-sm outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-control bg-brand-50 text-brand-600">
        {property.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={property.photo_url} alt="" className="size-full object-cover" />
        ) : (
          <Home className="size-5" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold text-foreground">{property.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {property.address}
          {loc ? ` · ${loc}` : ''}
        </span>
        {stats && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{stats}</span>}
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}
