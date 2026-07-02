'use client';

import { Check, Sparkles } from 'lucide-react';
import { useServices } from '@/hooks/useServices';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

export interface ServicePickerSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedId: string | null;
  onSelect: (serviceTypeId: string) => void;
}

export function serviceMetaLabel(basePrice: number, durationMinutes: number): string {
  const price = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(basePrice);
  const hrs = Math.round(durationMinutes / 60);
  const dur = durationMinutes >= 60 ? `about ${hrs} hr${hrs === 1 ? '' : 's'}` : `${durationMinutes} min`;
  return `${price} · ${dur}`;
}

export function ServicePickerSheet({ open, onOpenChange, selectedId, onSelect }: ServicePickerSheetProps) {
  const { services, loading } = useServices();
  const active = services.filter((s) => s.is_active);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Choose a service</DrawerTitle>
          <DrawerDescription>What kind of cleaning?</DrawerDescription>
        </DrawerHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto px-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-card" />
            ))
          ) : active.length === 0 ? (
            <div className="py-6">
              <EmptyState
                icon={<Sparkles />}
                title="No services yet"
                description="Please contact your office."
              />
            </div>
          ) : (
            active.map((s) => {
              const on = selectedId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    onSelect(s.id);
                    onOpenChange(false);
                  }}
                  className={
                    'flex w-full items-center gap-3 rounded-card border p-4 text-left transition-colors ' +
                    (on ? 'border-brand-600 bg-brand-50' : 'border-border bg-card hover:bg-muted')
                  }
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-bold text-foreground">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {serviceMetaLabel(s.base_price, s.duration_minutes)}
                    </div>
                  </div>
                  {on && <Check className="size-5 shrink-0 text-brand-600" aria-hidden />}
                </button>
              );
            })
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
