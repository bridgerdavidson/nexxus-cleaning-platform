'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { useAdminCustomers, useAdminCleaners } from '@/hooks/useAdminData';
import { useServices } from '@/hooks/useServices';
import { useChecklists } from '@/hooks/useChecklists';
import { PropertyDetailSheet } from '@/components/redesign/properties/PropertyDetailSheet';
import { EMPTY_OPERATOR_BOOKING, type OperatorBookingState } from './operator-booking-types';
import type { NewBookingSeed } from './useOpenOperatorBooking';
import {
  addSlot,
  removeSlotAt,
  isSelfPay,
  effectiveTotalUsd,
  canReview,
  canCreateBooking,
} from './deriveOperatorBooking';
import { isRecurring, buildOccurrenceInput, previewOccurrences, recurrenceRecap } from './deriveRecurrence';
import { EntityPickerField, type PickerItem } from './EntityPickerField';
import { TimePickerPopover } from './TimePickerPopover';
import { BookingPaymentField } from './BookingPaymentField';
import { RecurrenceSection } from './RecurrenceSection';
import { usePropertiesByOwner, propertiesByOwnerKey } from './usePropertiesByOwner';
import { useRankedCleaners } from './useRankedCleaners';
import { useCreateOperatorBooking } from './useCreateOperatorBooking';
import { formatSlotLabel } from '@/components/redesign/homeowner/booking/deriveBooking';
import { slotOrdinal } from '@/components/redesign/homeowner/booking/deriveBooking';

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function serviceMeta(basePrice: number, minutes: number): string {
  const hrs = Math.round(minutes / 60);
  const dur = minutes >= 60 ? `${hrs} hr${hrs === 1 ? '' : 's'}` : `${minutes} min`;
  return `${money(basePrice)} · ${dur}`;
}

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-semibold">{children}</span>
    </div>
  );
}

export function OperatorBookingForm({
  prefill,
  onDone,
}: {
  prefill?: NewBookingSeed;
  onDone: () => void;
}) {
  const { currentOrganizationId, currentOrgRole } = useAuth();
  const { permissions } = useManagerPermissions();
  const queryClient = useQueryClient();
  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  const canAddProperty = privileged || !!permissions?.can_edit_properties;
  const [addPropertyOpen, setAddPropertyOpen] = useState(false);
  const [state, setState] = useState<OperatorBookingState>(() => {
    const base: OperatorBookingState =
      prefill?.date || prefill?.time
        ? {
            ...EMPTY_OPERATOR_BOOKING,
            slots: [
              {
                date: prefill.date ?? EMPTY_OPERATOR_BOOKING.slots[0]?.date ?? '',
                // A date-only prefill (month-view day click) has no time; default to
                // 09:00 so the seeded slot is complete and editable rather than an
                // empty-time slot that reads as filled but has no time.
                time: prefill.time ?? '09:00',
              },
            ],
          }
        // Copy (not the shared constant reference) since the seeding below mutates `base`.
        : { ...EMPTY_OPERATOR_BOOKING };
    // Book-from-property seeding (customer, property, bill-to). Applied in the initializer
    // (not an effect) so it can never be clobbered by a later render.
    if (prefill?.billTo === 'customer' || prefill?.billTo === 'self_pay') base.billTo = prefill.billTo;
    if (prefill?.customerId) base.customerId = prefill.customerId;
    if (prefill?.propertyId) base.propertyId = prefill.propertyId;
    return base;
  });
  const [page, setPage] = useState<'form' | 'review'>('form');
  const self = isSelfPay(state);

  const { customers } = useAdminCustomers();
  const { cleaners } = useAdminCleaners();
  const { services } = useServices();
  const { checklists } = useChecklists(state.serviceTypeId);
  const { properties, loading: propertiesLoading } = usePropertiesByOwner(self ? null : state.customerId);

  const service = services.find((s) => s.id === state.serviceTypeId) ?? null;
  const checklist = checklists.find((c) => c.id === state.checklistId) ?? null;

  const candidate = useMemo(() => {
    const primary = state.slots[0];
    if (!primary || !service) return null;
    return { date: primary.date, time: primary.time, durationMinutes: service.duration_minutes };
  }, [state.slots, service]);
  const rankedCleaners = useRankedCleaners(cleaners, candidate);

  const { create, creating } = useCreateOperatorBooking();

  const patch = (p: Partial<OperatorBookingState>) => setState((s) => ({ ...s, ...p }));

  const cleanerName = (c: { user_profile?: { first_name?: string | null; last_name?: string | null } | null }) =>
    `${c.user_profile?.first_name ?? ''} ${c.user_profile?.last_name ?? ''}`.trim() || 'Cleaner';

  const customerItems: PickerItem[] = customers.map((c) => ({
    id: c.id,
    label: `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || c.email,
    sublabel: c.email,
  }));
  const propertyItems: PickerItem[] = properties.map((p) => {
    const ownerName = p.owner ? `${p.owner.first_name ?? ''} ${p.owner.last_name ?? ''}`.trim() : '';
    return {
      id: p.id,
      label: p.name || p.address || 'Property',
      sublabel: [p.address, p.city, p.state].filter(Boolean).join(', '),
      // In self-pay every org property is shown; label who owns it (a homeowner name,
      // or "Company" for org-owned rows) so the operator can tell them apart.
      badge: self ? (
        p.owner_id && ownerName ? (
          <span className="ml-2 shrink-0 rounded-pill bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {ownerName}
          </span>
        ) : (
          <span className="ml-2 shrink-0 rounded-pill bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
            Company
          </span>
        )
      ) : undefined,
    };
  });
  const serviceItems: PickerItem[] = services
    .filter((s) => s.is_active)
    .map((s) => ({ id: s.id, label: s.name, sublabel: serviceMeta(s.base_price, s.duration_minutes) }));
  const checklistItems: PickerItem[] = checklists.map((c) => ({ id: c.id, label: c.name }));
  const cleanerItems: PickerItem[] = rankedCleaners.map((r) => {
    const payable = (r.cleaner.payout_percent ?? 0) > 0 && !!r.cleaner.stripe_connect_onboarding_complete;
    return {
      id: r.cleaner.id,
      label: cleanerName(r.cleaner),
      sublabel: r.isAvailable ? 'Available' : `Busy (${r.conflicts.length})`,
      badge: (
        <Badge variant={r.isAvailable ? 'positive' : 'caution'} className="ml-2">
          {r.isAvailable ? 'Free' : 'Busy'}
        </Badge>
      ),
      disabled: self && !payable,
    };
  });

  const total = effectiveTotalUsd(state, service, checklist);

  // Assigning an unconfigured cleaner is ALLOWED (warned, not blocked): the
  // operator hits this at scheduling time instead of the cleaner mid-job. Their
  // settlement defers until pay is set, so nothing silently pays a default.
  const selectedCleaner = state.cleanerId ? cleaners.find((c) => c.id === state.cleanerId) ?? null : null;
  const selectedCleanerPayNotSet = !!selectedCleaner && selectedCleaner.payout_configured_at == null;

  const recurring = isRecurring(state);
  const primarySlot = state.slots[0] ?? null;
  const occurrences = useMemo(() => {
    if (!recurring || !service) return [];
    const input = buildOccurrenceInput(state, service.duration_minutes);
    return input ? previewOccurrences(input) : [];
  }, [recurring, state, service]);

  async function handleCreate() {
    if (!service) return;
    try {
      const result = await create({ state, service, checklist });
      toast.success(result.recurring ? `${result.count} cleaning${result.count === 1 ? '' : 's'} scheduled` : 'Booking created', {
        description: result.recurring
          ? 'The cleaner has been offered the whole series.'
          : 'The cleaner has been offered this job.',
      });
      onDone();
    } catch (e) {
      toast.error('Could not create the booking', {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  const propertyName = properties.find((p) => p.id === state.propertyId)?.name ?? state.propertyId ?? '-';
  const selectedCustomer = customers.find((c) => c.id === state.customerId);
  const customerName = selectedCustomer
    ? `${selectedCustomer.first_name ?? ''} ${selectedCustomer.last_name ?? ''}`.trim()
    : self
      ? 'Company (self-pay)'
      : '-';

  return (
    <>
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="border-b border-border p-4 pr-12">
        <SheetTitle>{page === 'review' ? 'Review & create' : 'New booking'}</SheetTitle>
      </SheetHeader>

      {page === 'form' ? (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {/* Bill to */}
            <div className="flex overflow-hidden rounded-control border border-border text-sm font-bold">
              {(['customer', 'self_pay'] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() =>
                    patch({
                      billTo: b,
                      customerId: null,
                      propertyId: null,
                      cleanerId: null,
                      recurrence: EMPTY_OPERATOR_BOOKING.recurrence,
                    })
                  }
                  className={
                    'flex-1 py-2 transition-colors ' +
                    (state.billTo === b ? 'bg-brand-600 text-white' : 'bg-card hover:bg-muted')
                  }
                >
                  {b === 'customer' ? 'Bill the customer' : 'Company pays'}
                </button>
              ))}
            </div>

            {!self && (
              <EntityPickerField
                label="Customer"
                placeholder="Choose a customer"
                value={state.customerId}
                items={customerItems}
                onSelect={(id) => patch({ customerId: id, propertyId: null })}
                searchPlaceholder="Search customers..."
              />
            )}

            <EntityPickerField
              label="Property"
              placeholder={self ? 'Choose an org property' : 'Choose a property'}
              value={state.propertyId}
              items={propertyItems}
              onSelect={(id) => patch({ propertyId: id })}
              searchPlaceholder="Search properties..."
              disabled={!self && !state.customerId}
              emptyText={!self && !state.customerId ? 'Choose a customer first.' : 'No properties.'}
            />

            {!self && !!state.customerId && !propertiesLoading && properties.length === 0 && canAddProperty && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-brand-700"
                onClick={() => setAddPropertyOpen(true)}
              >
                + Add a property
              </Button>
            )}

            <EntityPickerField
              label="Service"
              placeholder="Choose a service"
              value={state.serviceTypeId}
              items={serviceItems}
              onSelect={(id) => patch({ serviceTypeId: id, checklistId: null })}
              searchPlaceholder="Search services..."
            />

            <EntityPickerField
              label="Checklist"
              placeholder="Choose a checklist"
              value={state.checklistId}
              items={checklistItems}
              onSelect={(id) => patch({ checklistId: id })}
              disabled={!state.serviceTypeId}
              emptyText={!state.serviceTypeId ? 'Choose a service first.' : 'No checklists.'}
            />

            {/* Price + override */}
            <div className="space-y-1.5">
              <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Price</p>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center rounded-control border border-input bg-card px-3 py-2.5 text-sm transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring">
                  <span className="text-muted-foreground">$</span>
                  <input
                    type="number"
                    min={0}
                    className="ml-1 w-full appearance-none border-0 bg-transparent tabular-nums outline-none [appearance:textfield] focus:outline-none focus:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-outer-spin-button]:m-0"
                    value={state.priceOverride ?? (service ? service.base_price + (checklist?.price_adder ?? 0) : '')}
                    onChange={(e) =>
                      patch({
                        priceOverride: e.target.value === '' ? null : Math.max(0, Number(e.target.value)),
                      })
                    }
                  />
                </div>
                {state.priceOverride != null && (
                  <Button variant="ghost" size="sm" onClick={() => patch({ priceOverride: null })}>
                    Reset
                  </Button>
                )}
              </div>
            </div>

            {/* Times */}
            <div className="space-y-2">
              <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Date &amp; time
              </p>
              {state.slots.map((slot, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded-control border border-border bg-card p-2.5"
                >
                  <span className="text-xs font-extrabold text-brand-700">{slotOrdinal(idx)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{formatSlotLabel(slot)}</span>
                  <button
                    type="button"
                    onClick={() => patch({ slots: removeSlotAt(state.slots, idx) })}
                    aria-label="Remove time"
                    className="grid size-7 place-items-center rounded-control text-muted-foreground hover:text-critical"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              ))}
              {state.slots.length === 0 && (
                <TimePickerPopover
                  label="Add a time"
                  onAdd={(slot) => patch({ slots: addSlot(state.slots, slot) })}
                />
              )}
              {/* Alternates only apply to a one-time booking; a series uses the single start. */}
              {state.slots.length >= 1 && state.slots.length < 3 && !recurring && (
                <TimePickerPopover
                  label="Add an alternate"
                  onAdd={(slot) => patch({ slots: addSlot(state.slots, slot) })}
                />
              )}
            </div>

            {/* Repeat (customer-billed only; the recurring route requires a homeowner) */}
            {!self && (
              <RecurrenceSection
                value={state.recurrence}
                startSlot={primarySlot}
                occurrences={occurrences}
                onChange={(p) => patch({ recurrence: { ...state.recurrence, ...p } })}
              />
            )}

            {/* Cleaner offer */}
            <div>
              <EntityPickerField
                label="Cleaner (offer)"
                placeholder="Offer to a cleaner"
                value={state.cleanerId}
                items={cleanerItems}
                onSelect={(id) => patch({ cleanerId: id })}
                searchPlaceholder="Search cleaners..."
              />
              {state.cleanerId && (
                <p className="mt-1 px-0.5 text-xs text-muted-foreground">
                  We will offer this to the cleaner. If they decline, it routes to the next one.
                </p>
              )}
              {selectedCleanerPayNotSet && (
                <div className="mt-2 flex items-start gap-2 rounded-control border border-caution-700/30 bg-caution-50 px-3 py-2 text-xs text-caution-700">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    This cleaner has no pay set, so they will not be paid for this job until you
                    set it in Cleaners &amp; team. You can still book the job.
                  </span>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Notes (optional)
              </p>
              <Textarea
                value={state.notes}
                onChange={(e) => patch({ notes: e.target.value })}
                placeholder="Anything the cleaner should know?"
                rows={2}
              />
            </div>

            {/* Payment */}
            <BookingPaymentField
              billTo={state.billTo}
              customerId={state.customerId}
              organizationId={currentOrganizationId ?? null}
              value={state.paymentValue}
              onChange={(v) => patch({ paymentValue: v })}
              onSelfPayChange={(info) => patch({ selfPayHasMethod: info.hasMethod, method: info.method })}
            />
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-border p-4">
            <span className="shrink-0 text-lg font-extrabold tabular-nums">{money(total)}</span>
            <Button className="flex-1" disabled={!canReview(state)} onClick={() => setPage('review')}>
              Review &amp; create
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="divide-y divide-border rounded-card border border-border bg-card px-4 shadow-soft-sm">
              <ReviewRow label="Bill to">{self ? 'Company (self-pay)' : 'Customer'}</ReviewRow>
              {!self && <ReviewRow label="Customer">{customerName}</ReviewRow>}
              <ReviewRow label="Property">{propertyName}</ReviewRow>
              <ReviewRow label="Service">{service?.name ?? '-'}</ReviewRow>
              {recurring ? (
                <>
                  <ReviewRow label="Starts">{primarySlot ? formatSlotLabel(primarySlot) : '-'}</ReviewRow>
                  <ReviewRow label="Repeats">
                    <span className="text-right">
                      {primarySlot
                        ? recurrenceRecap(state.recurrence, primarySlot.date, primarySlot.time, occurrences)
                        : '-'}
                    </span>
                  </ReviewRow>
                  <ReviewRow label="Cleanings">{occurrences.length}</ReviewRow>
                </>
              ) : (
                <ReviewRow label="Preferred times">
                  <span className="flex flex-col items-end gap-0.5">
                    {state.slots.map((s, i) => (
                      <span key={i}>
                        <span className="text-muted-foreground">{slotOrdinal(i)} </span>
                        {formatSlotLabel(s)}
                      </span>
                    ))}
                  </span>
                </ReviewRow>
              )}
              <ReviewRow label="Cleaner">
                {cleanerName(cleaners.find((c) => c.id === state.cleanerId) ?? {})}
              </ReviewRow>
              <ReviewRow label={recurring ? 'Total each' : 'Total'}>{money(total)}</ReviewRow>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 border-t border-border p-4">
            <Button variant="outline" onClick={() => setPage('form')}>
              Back
            </Button>
            <Button
              className="flex-1"
              loading={creating}
              disabled={!canCreateBooking(state, occurrences.length)}
              onClick={handleCreate}
            >
              {recurring ? `Create ${occurrences.length} cleaning${occurrences.length === 1 ? '' : 's'}` : 'Create booking'}
            </Button>
          </div>
        </>
      )}
    </div>

    <PropertyDetailSheet
      open={addPropertyOpen}
      onOpenChange={setAddPropertyOpen}
      property={null}
      mode="create"
      createOwnerId={state.customerId}
      onSaved={(p) => {
        patch({ propertyId: p.id });
        void queryClient.invalidateQueries({
          queryKey: propertiesByOwnerKey(currentOrganizationId, state.customerId),
        });
      }}
    />
    </>
  );
}
