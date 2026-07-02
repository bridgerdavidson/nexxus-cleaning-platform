'use client';

import { Home, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { Property } from '@/hooks/useHomeownerData';
import { PropertyRow } from './PropertyRow';

export interface HomeownerPropertiesViewProps {
  properties: Property[];
  loading: boolean;
  onOpen: (id: string) => void;
  onAdd: () => void;
}

export function HomeownerPropertiesView({
  properties,
  loading,
  onOpen,
  onAdd,
}: HomeownerPropertiesViewProps) {
  if (loading) {
    return (
      <div className="space-y-2.5 pt-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[68px] w-full rounded-card" />
        ))}
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div className="py-8">
        <EmptyState
          icon={<Home />}
          title="No properties yet"
          description="Add a home so we know where to clean."
          action={
            <Button onClick={onAdd}>
              <Plus className="size-4" aria-hidden /> Add property
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={onAdd} className="gap-1.5">
          <Plus className="size-4" aria-hidden /> Add property
        </Button>
      </div>
      <div className="space-y-2.5">
        {properties.map((p) => (
          <PropertyRow key={p.id} property={p} onOpen={() => onOpen(p.id)} />
        ))}
      </div>
    </div>
  );
}
