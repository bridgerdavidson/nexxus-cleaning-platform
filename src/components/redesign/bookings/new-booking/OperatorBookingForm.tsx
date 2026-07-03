'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { useAdminCustomers, useAdminCleaners } from '@/hooks/useAdminData';
import { useServices } from '@/hooks/useServices';
import { useChecklists } from '@/hooks/useChecklists';
import { EMPTY_OPERATOR_BOOKING, type OperatorBookingState } from './operator-booking-types';
import {
  addSlot,
  removeSlotAt,
  isSelfPay,
  effectiveTotalUsd,
  canReview,
  canCreate,
} from './deriveOperatorBooking';
import { EntityPickerField, type PickerItem } from './EntityPickerField';
import { TimePickerPopover } from './TimePickerPopover';
import { BookingPaymentField } from './BookingPaymentField';
import { usePropertiesByOwner } from './usePropertiesByOwner';
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

export function OperatorBookingForm({ onDone }: { onDone: () => void }) {
  const { currentOrganizationId } = useAuth();
  const [state, setState] = useState<OperatorBookingState>(EMPTY_OPERATOR_BOOKING);
  const [page, setPage] = useState<'form' | 'review'>('form');
  const self = isSelfPay(state);

  const { customers } = useAdminCustomers();
  const { cleaners } = useAdminCleaners();
  const { services } = useServices();
  const { checklists } = useChecklists(state.serviceTypeId);
  const { properties } = usePropertiesByOwner(self ? null : state.customerId);

  const service = services.find((s) => s.id === state.serviceTypeId) ?? null;

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
  const propertyItems: PickerItem[] = properties.map((p) => ({
    id: p.id,
    label: p.name || p.address || 'Property',
    sublabel: [p.address, p.city, p.state].filter(Boolean).join(', '),
  }));
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

  const total = effectiveTotalUsd(state, service);

  async function handleCreate() {
    if (!service) return;
    try {
      await create({ state, service });
      toast.success('Booking created', { description: 'The cleaner has been offered this job.' });
      onDone();
    } catch (e) {
      toast.error('Could not create the booking', {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  const propertyName = properties.find((p) => p.id === state.propertyId)?.name ?? state.propertyId ?? '-';
  const customerName =
    customers.find((c) => c.id === state.customerId)?.first_name ?? (self ? 'Company (self-pay)' : '-');

  return (
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
                  onClick={() => patch({ billTo: b, customerId: null, propertyId: null })}
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
                <div className="flex flex-1 items-center rounded-control border border-input bg-card px-3 py-2.5 text-sm">
                  <span className="text-muted-foreground">$</span>
                  <input
                    type="number"
                    className="ml-1 w-full bg-transparent tabular-nums outline-none"
                    value={state.priceOverride ?? service?.base_price ?? ''}
                    onChange={(e) =>
                      patch({ priceOverride: e.target.value === '' ? null : Number(e.target.value) })
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
              {state.slots.length < 3 && (
                <TimePickerPopover
                  label={state.slots.length === 0 ? 'Add a time' : 'Add an alternate'}
                  onAdd={(slot) => patch({ slots: addSlot(state.slots, slot) })}
                />
              )}
            </div>

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

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border p-4">
            <span className="text-lg font-extrabold tabular-nums">{money(total)}</span>
            <Button disabled={!canReview(state)} onClick={() => setPage('review')}>
              Review &amp; create
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="divide-y divide-border rounded-card border border-border bg-card px-4">
              {[
                ['Bill to', self ? 'Company (self-pay)' : 'Customer'],
                ['Customer', customerName],
                ['Property', propertyName],
                ['Service', service?.name ?? '-'],
                ['Cleaner', cleanerName(cleaners.find((c) => c.id === state.cleanerId) ?? {})],
                ['Total', money(total)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5 text-sm">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="text-right font-semibold">{v}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1">
              {state.slots.map((s, i) => (
                <p key={i} className="text-sm">
                  <span className="text-muted-foreground">{slotOrdinal(i)} </span>
                  {formatSlotLabel(s)}
                </p>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 border-t border-border p-4">
            <Button variant="outline" onClick={() => setPage('form')}>
              Back
            </Button>
            <Button className="flex-1" loading={creating} disabled={!canCreate(state)} onClick={handleCreate}>
              Create booking
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
