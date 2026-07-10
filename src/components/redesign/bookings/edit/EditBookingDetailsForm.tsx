'use client';

import { useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { type AdminAppointment } from '@/hooks/useAdminData';
import { useServices } from '@/hooks/useServices';
import { useChecklists } from '@/hooks/useChecklists';
import { EntityPickerField, type PickerItem } from '../new-booking/EntityPickerField';
import { fmtTime, monthDay } from '../booking-vm';
import { seedEditDetails, type EditDetailsState } from './seedEditDetails';
import { buildDetailsPatch } from './buildDetailsPatch';
import { useEditBookingDetails } from './useEditBookingDetails';

const NO_CHECKLIST = '__none__';

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function serviceMeta(basePrice: number, minutes: number): string {
  const hrs = Math.round(minutes / 60);
  const dur = minutes >= 60 ? `${hrs} hr${hrs === 1 ? '' : 's'}` : `${minutes} min`;
  return `${money(basePrice)} · ${dur}`;
}

function isDirty(a: EditDetailsState, b: EditDetailsState): boolean {
  return (
    a.serviceTypeId !== b.serviceTypeId ||
    a.checklistId !== b.checklistId ||
    a.overrideEnabled !== b.overrideEnabled ||
    a.overrideTotal !== b.overrideTotal ||
    a.specialRequests !== b.specialRequests ||
    a.notes !== b.notes
  );
}

/**
 * The Edit-details body-swap form (design spec: docs/superpowers/specs/
 * 2026-07-09-reschedule-edit-booking-design.md, "Edit details" section).
 * Rendered by BookingDetailSheet's DetailBody as a child of SheetContent, so
 * it mounts fresh (and re-seeds) every time the sheet is reopened.
 */
export function EditBookingDetailsForm({
  appointment,
  onDone,
}: {
  appointment: AdminAppointment;
  onDone: () => void;
}) {
  // Frozen at mount so a realtime refetch mid-edit can't shift the dirty
  // baseline out from under the operator.
  const [initial] = useState(() => seedEditDetails(appointment));
  const [state, setState] = useState<EditDetailsState>(initial);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { save, saving } = useEditBookingDetails(appointment.id);

  const { services } = useServices();
  const { checklists } = useChecklists(state.serviceTypeId);

  const patch = (p: Partial<EditDetailsState>) => setState((s) => ({ ...s, ...p }));
  const dirty = isDirty(state, initial);

  // The general list only offers active services (matching the create
  // flow); the booking's original service is always selectable too, even
  // when it has since been deactivated or (rarely) deleted from the org's
  // service list entirely.
  const currentService = services.find((s) => s.id === appointment.service_type_id) ?? null;
  const serviceItems: PickerItem[] = useMemo(() => {
    const items: PickerItem[] = services
      .filter((s) => s.is_active)
      .map((s) => ({ id: s.id, label: s.name, sublabel: serviceMeta(s.base_price, s.duration_minutes) }));
    if (appointment.service_type_id && !items.some((i) => i.id === appointment.service_type_id)) {
      items.unshift({
        id: appointment.service_type_id,
        label: `${currentService?.name ?? appointment.service_type?.name ?? 'Service'} (inactive)`,
        sublabel: currentService ? serviceMeta(currentService.base_price, currentService.duration_minutes) : undefined,
      });
    }
    return items;
  }, [services, appointment.service_type_id, appointment.service_type, currentService]);

  // useChecklists is scoped to state.serviceTypeId, so the booking's original
  // checklist can only be "missing" here while still selected in state when
  // the service hasn't changed and the checklist row was deleted outright
  // (checklists have no is_active concept).
  const currentChecklistMissing =
    state.serviceTypeId === appointment.service_type_id &&
    !!appointment.checklist_id &&
    !checklists.some((c) => c.id === appointment.checklist_id);

  const checklistItems: PickerItem[] = useMemo(() => {
    const items: PickerItem[] = [{ id: NO_CHECKLIST, label: 'No checklist' }];
    if (currentChecklistMissing && appointment.checklist_id) {
      items.push({
        id: appointment.checklist_id,
        label: `${appointment.checklist?.name ?? 'Checklist'} (inactive)`,
      });
    }
    for (const c of checklists) items.push({ id: c.id, label: c.name });
    return items;
  }, [checklists, currentChecklistMissing, appointment.checklist_id, appointment.checklist]);

  const service = services.find((s) => s.id === state.serviceTypeId) ?? currentService;
  const checklist = checklists.find((c) => c.id === state.checklistId) ?? null;
  const checklistAdder = checklist
    ? checklist.price_adder
    : currentChecklistMissing && state.checklistId === appointment.checklist_id
      ? (appointment.checklist?.price_adder ?? 0)
      : 0;
  const systemTotal = service ? service.base_price + checklistAdder : 0;

  async function handleSave() {
    if (!state.serviceTypeId) return;
    try {
      const body = buildDetailsPatch(state);
      await save(body);
      toast.success('Booking updated');
      onDone();
    } catch (e) {
      const err = e as Error & { stale?: boolean; paidGuard?: boolean };
      if (err.paidGuard) {
        toast.error('A payment already exists for this booking, so its price cannot change.');
      } else if (err.stale) {
        toast.error('This booking changed. Refresh and try again.');
      } else {
        toast.error(err.message || 'Could not save changes');
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SheetHeader className="border-b border-border p-4 pr-12">
        <SheetTitle>Edit details</SheetTitle>
        <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarClock className="size-4" aria-hidden />
          {monthDay(appointment.scheduled_date)} at {fmtTime(appointment.scheduled_time)}
        </div>
        <p className="text-xs text-muted-foreground">Use Reschedule to change the date or time.</p>
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
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
          value={state.checklistId ?? NO_CHECKLIST}
          items={checklistItems}
          onSelect={(id) => patch({ checklistId: id === NO_CHECKLIST ? null : id })}
          disabled={!state.serviceTypeId}
          searchPlaceholder="Search checklists..."
        />

        {/* Price + override, mirroring OperatorBookingForm's block. */}
        <div className="space-y-1.5">
          <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Price</p>
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center rounded-control border border-input bg-card px-3 py-2.5 text-sm transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring">
              <span className="text-muted-foreground">$</span>
              <input
                type="number"
                min={0}
                className="ml-1 w-full appearance-none border-0 bg-transparent tabular-nums outline-none [appearance:textfield] focus:outline-none focus:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-outer-spin-button]:m-0"
                value={state.overrideEnabled ? (state.overrideTotal ?? '') : systemTotal}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    // Clearing the field reverts to the system price rather than
                    // sending an enabled-override with no total (the same
                    // inconsistent pair seedEditDetails treats as noise).
                    patch({ overrideEnabled: false, overrideTotal: null });
                  } else {
                    patch({ overrideEnabled: true, overrideTotal: Math.max(0, Number(raw)) });
                  }
                }}
              />
            </div>
            {state.overrideEnabled && (
              <Button variant="ghost" size="sm" onClick={() => patch({ overrideEnabled: false, overrideTotal: null })}>
                Reset
              </Button>
            )}
          </div>
          <p className="px-0.5 text-xs text-muted-foreground">
            Changing the service or checklist updates the price, and the service updates the duration, unless you
            override.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Special requests
          </p>
          <Textarea
            value={state.specialRequests}
            onChange={(e) => patch({ specialRequests: e.target.value })}
            placeholder="Visible to the cleaner"
            rows={2}
          />
        </div>

        <div className="space-y-1.5">
          <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Internal notes
          </p>
          <Textarea
            value={state.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="Not visible to the customer or cleaner"
            rows={2}
          />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-border p-4">
        <Button variant="outline" onClick={() => (dirty ? setConfirmDiscard(true) : onDone())}>
          Cancel
        </Button>
        <Button className="flex-1" loading={saving} disabled={!state.serviceTypeId} onClick={handleSave}>
          Save changes
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard changes?"
        description="This booking's details have unsaved changes."
        confirmLabel="Discard"
        onConfirm={() => {
          setConfirmDiscard(false);
          onDone();
        }}
      />
    </div>
  );
}
