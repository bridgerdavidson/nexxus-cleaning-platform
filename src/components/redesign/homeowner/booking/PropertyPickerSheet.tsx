'use client';

import { useEffect, useState } from 'react';
import { Home, Plus, Check } from 'lucide-react';
import { useHomeownerProperties } from '@/hooks/useHomeownerData';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { PropertyFormSheet } from '../account/properties/PropertyFormSheet';

export interface PropertyPickerSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function PropertyPickerSheet({ open, onOpenChange, selectedId, onSelect }: PropertyPickerSheetProps) {
  const { properties, loading } = useHomeownerProperties();
  const [addOpen, setAddOpen] = useState(false);
  const [selectNewest, setSelectNewest] = useState(false);

  // After adding a home, the list refetches (newest first); select it and close.
  useEffect(() => {
    if (selectNewest && properties.length) {
      onSelect(properties[0].id);
      setSelectNewest(false);
      onOpenChange(false);
    }
  }, [selectNewest, properties, onSelect, onOpenChange]);

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Choose a home</DrawerTitle>
            <DrawerDescription>Where should we clean?</DrawerDescription>
          </DrawerHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto px-4 pb-2">
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-card" />
              ))
            ) : properties.length === 0 ? (
              <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                No homes yet. Add one below.
              </p>
            ) : (
              properties.map((p) => {
                const active = selectedId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onSelect(p.id);
                      onOpenChange(false);
                    }}
                    className={
                      'flex w-full items-center gap-3 rounded-card border p-4 text-left transition-colors ' +
                      (active ? 'border-brand-600 bg-brand-50' : 'border-border bg-card hover:bg-muted')
                    }
                  >
                    <div className="grid size-10 shrink-0 place-items-center rounded-control bg-muted text-muted-foreground">
                      <Home className="size-5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-foreground">{p.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{p.address}</div>
                    </div>
                    {active && <Check className="size-5 shrink-0 text-brand-ink" aria-hidden />}
                  </button>
                );
              })
            )}
          </div>
          <div className="px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2">
            <Button variant="outline" className="w-full" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" aria-hidden /> Add a home
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      <PropertyFormSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={() => {
          setAddOpen(false);
          setSelectNewest(true);
        }}
      />
    </>
  );
}
