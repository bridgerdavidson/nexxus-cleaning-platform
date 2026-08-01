'use client';

import { useState } from 'react';
import { ChevronLeft, Home, Pencil, Trash2 } from 'lucide-react';
import { MobileTakeover } from '@/components/redesign/shared/MobileTakeover';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import type { Property } from '@/hooks/useHomeownerData';
import { propertyLocationLine, propertyStatsLabel } from './derive-properties';
import { PropertyFormSheet } from './PropertyFormSheet';
import { DeletePropertySheet } from './DeletePropertySheet';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export function HomeownerPropertyDetail({
  property,
  loading,
  onClose,
}: {
  property: Property | null;
  loading: boolean;
  onClose: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const stats = property ? propertyStatsLabel(property) : '';
  const loc = property ? propertyLocationLine(property) : '';

  return (
    <MobileTakeover ariaLabel="Property details" keyboardAware={false} onClosed={onClose}>
      {(close) => (
        <>
          <div className="flex items-center gap-2 border-b border-border px-2">
            <button
              onClick={close}
              aria-label="Back"
              className="grid size-11 place-items-center rounded-control text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-6" />
            </button>
            <div className="min-w-0 flex-1 py-2">
              <div className="truncate text-sm font-bold">{property?.name ?? 'Property'}</div>
            </div>
            <div className="w-1" />
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-lg space-y-5 px-5 pt-5 pb-[max(env(safe-area-inset-bottom),1.25rem)]">
              {loading && !property ? (
                <>
                  <Skeleton className="h-40 w-full rounded-card" />
                  <Skeleton className="h-16 w-full rounded-card" />
                </>
              ) : !property ? (
                <div className="pt-10">
                  <EmptyState
                    icon={<Home />}
                    title="Property not available"
                    description="This property may have been removed from your account."
                  />
                </div>
              ) : (
                <>
                  {property.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={property.photo_url}
                      alt=""
                      className="h-44 w-full rounded-card object-cover"
                    />
                  ) : (
                    <div className="grid h-44 w-full place-items-center rounded-card bg-brand-50 text-brand-ink">
                      <Home className="size-10" aria-hidden />
                    </div>
                  )}

                  <div className="rounded-card border border-border bg-card p-4 shadow-soft-sm">
                    <div className="space-y-4">
                      <Field label="Address">
                        <div className="font-semibold">{property.address}</div>
                        {(loc || property.zip_code) && (
                          <div className="text-muted-foreground">
                            {[loc, property.zip_code].filter(Boolean).join(' ')}
                          </div>
                        )}
                      </Field>
                      {stats && (
                        <>
                          <Separator />
                          <Field label="Details">{stats}</Field>
                        </>
                      )}
                      {property.special_instructions && (
                        <>
                          <Separator />
                          <Field label="Special requests">{property.special_instructions}</Field>
                        </>
                      )}
                      {property.access_instructions && (
                        <>
                          <Separator />
                          <Field label="Access">{property.access_instructions}</Field>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Button variant="outline" className="w-full" onClick={() => setEditOpen(true)}>
                      <Pencil className="size-4" aria-hidden /> Edit property
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full text-critical-700"
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2 className="size-4" aria-hidden /> Delete property
                    </Button>
                  </div>

                  <PropertyFormSheet
                    open={editOpen}
                    onOpenChange={setEditOpen}
                    property={property}
                    onSaved={() => {}}
                  />
                  <DeletePropertySheet
                    open={deleteOpen}
                    onOpenChange={setDeleteOpen}
                    propertyId={property.id}
                    propertyName={property.name}
                    onDeleted={close}
                  />
                </>
              )}
            </div>
          </div>
        </>
      )}
    </MobileTakeover>
  );
}
