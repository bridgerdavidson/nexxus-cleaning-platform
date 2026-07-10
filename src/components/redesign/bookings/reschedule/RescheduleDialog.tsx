'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { useAuth } from '@/hooks/useAuth';
import { type AdminAppointment } from '@/hooks/useAdminData';
import { normalizeTimeHHMM, reaskTierHours } from '@/lib/appointments/rescheduleOutcome';
import { toYMD } from '@/components/redesign/homeowner/booking/time-options';
import { fmtTime, monthDay } from '../booking-vm';
import type { CleanerOption } from '../bookings-types';
import { EntityPickerField, type PickerItem } from '../new-booking/EntityPickerField';
import { useRankedCleaners } from '../new-booking/useRankedCleaners';
import { useRescheduleBooking } from './useRescheduleBooking';
import {
  ownedChips,
  timePillOptions,
  conflictFor,
  outcomeFor,
  outcomeLine,
  seriesLine,
  primaryLabel,
} from './deriveReschedule';

/** Prefill hint for opening the dialog from a proposal row or a window's
 *  "Pick a time" affordance. An empty object opens it seeded from the
 *  booking's current schedule (the plain "Reschedule" button). */
export interface RescheduleInit {
  date?: string;
  time?: string;
  windowId?: string;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function pillClass(selected: boolean): string {
  return (
    'rounded-pill border px-2.5 py-1.5 text-xs font-bold transition-colors ' +
    (selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-input bg-card hover:bg-muted')
  );
}

export function RescheduleDialog({
  appointment: a,
  appointments,
  cleaners,
  canHandleRequests,
  init,
  onOpenChange,
  onDone,
}: {
  appointment: AdminAppointment;
  appointments: AdminAppointment[];
  cleaners: CleanerOption[];
  canHandleRequests: boolean;
  init: RescheduleInit | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const open = init !== null;
  const { currentOrganization } = useAuth();
  const payoutModel = currentOrganization?.default_payout_model ?? null;
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [cleanerId, setCleanerId] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<string | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // A conflict 409 the SERVER detected on submit (another operator filled the
  // slot; the local appointments cache was stale). Keeps the dialog open with
  // the warning + "Reschedule anyway", mirroring the client-derived conflict.
  const [serverConflict, setServerConflict] = useState<{ label: string } | null>(null);
  const { reschedule, saving } = useRescheduleBooking(a.id);

  // Seed from init each time the dialog opens (init identity changes per open).
  useEffect(() => {
    setServerConflict(null);
    if (init) {
      const w = init.windowId ? ownedChips(a).find((c) => c.kind === 'window' && c.id === init.windowId) : null;
      setDate(init.date ?? w?.date ?? a.scheduled_date);
      setTime(init.time ?? (w ? normalizeTimeHHMM(w.startTime!) : normalizeTimeHHMM(a.scheduled_time)));
      setWindowId(init.windowId ?? null);
      setCleanerId(a.cleaner_id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [init]);

  // A server-detected conflict describes ONE specific selection; picking a
  // different date, time, or cleaner invalidates it.
  useEffect(() => {
    setServerConflict(null);
  }, [date, time, cleanerId]);

  const chips = ownedChips(a);
  const constraint = windowId ? (chips.find((c) => c.kind === 'window' && c.id === windowId) ?? null) : null;
  const pills = timePillOptions(constraint ? { startTime: constraint.startTime!, endTime: constraint.endTime! } : null);
  const offGridPill = time && !pills.some((p) => p.value === time) ? { value: time, label: fmtTime(time) } : null;
  const ranked = useRankedCleaners(cleaners, date && time ? { date, time, durationMinutes: a.duration_minutes || 60 } : null, a.id);
  const clientConflict = date && time && cleanerId ? conflictFor(appointments, { date, time, cleanerId }, a.id) : null;
  const conflict = clientConflict ?? serverConflict;
  const outcome = date && time ? outcomeFor(a, { date, time, cleanerId }, payoutModel) : null;
  const dirty = !!date && (date !== a.scheduled_date || time !== normalizeTimeHHMM(a.scheduled_time) || cleanerId !== (a.cleaner_id ?? null));

  const cleanerName = cleanerId ? (cleaners.find((c) => c.id === cleanerId)?.name ?? null) : null;
  const cleanerFirstName = cleanerName ? cleanerName.split(' ')[0] : null;
  const cleanerChanged = cleanerId !== (a.cleaner_id ?? null);
  const escalatedUnassigned = a.cleaner_confirmation_status === 'rejected';
  const tier = date && time ? reaskTierHours(date, time) : null;
  const series = seriesLine(a);

  const cleanerItems: PickerItem[] = ranked.map((r) => ({
    id: r.cleaner.id,
    label: r.cleaner.name,
    sublabel: r.isAvailable ? 'Free' : `Busy (${r.conflicts.length})`,
    badge: (
      <Badge variant={r.isAvailable ? 'positive' : 'caution'} className="ml-2">
        {r.isAvailable ? 'Free' : 'Busy'}
      </Badge>
    ),
  }));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const handleOpenChange = (v: boolean) => {
    if (!v && dirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(v);
  };

  const submit = async () => {
    if (!date || !time) return;
    try {
      const r = await reschedule({ scheduledDate: date, scheduledTime: time, cleanerId, force: !!conflict });
      toast.success(r.outcome === 'settled' ? 'Booking rescheduled' : 'Sent to the cleaner to confirm');
      onDone();
    } catch (e) {
      const err = e as Error & { conflict?: boolean; stale?: boolean };
      if (err.stale) {
        toast.error('This booking changed. Refresh and try again.');
        onDone();
      } else if (err.conflict) {
        // The server's race backstop: dialog stays open, the warning row
        // appears, and the primary button flips to "Reschedule anyway"
        // (the resubmit then carries force). The hook only tags a boolean,
        // so the label describes the selection rather than the other job.
        setServerConflict({ label: `Has a conflicting job at ${fmtTime(time)}` });
      } else {
        toast.error(err.message);
      }
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule</DialogTitle>
            <DialogDescription>
              {`${a.property?.name || a.property?.address || 'Property'} · ${a.service_type?.name ?? 'Cleaning'} · currently ${monthDay(a.scheduled_date)} at ${fmtTime(a.scheduled_time)}`}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {chips.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <Sparkles className="size-3.5" aria-hidden /> Cleaner suggested
                </div>
                <div className="flex flex-wrap gap-2">
                  {chips.map((c) => {
                    const active =
                      c.kind === 'time'
                        ? date === c.date && time === normalizeTimeHHMM(c.time!)
                        : windowId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          if (c.kind === 'time') {
                            setDate(c.date);
                            setTime(normalizeTimeHHMM(c.time!));
                            setWindowId(null);
                          } else {
                            setDate(c.date);
                            setTime(normalizeTimeHHMM(c.startTime!));
                            setWindowId(c.id);
                          }
                        }}
                        className={pillClass(active)}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Date</p>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-control border border-input bg-card px-3 py-2.5 text-left text-sm shadow-soft-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CalendarClock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    {date ? monthDay(date) : 'Pick a date'}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3" align="start">
                  <Calendar
                    mode="single"
                    selected={date ? new Date(`${date}T00:00:00`) : undefined}
                    onSelect={(d) => {
                      if (!d) return;
                      const next = toYMD(d);
                      setDate(next);
                      if (windowId && constraint && next !== constraint.date) setWindowId(null);
                      setDateOpen(false);
                    }}
                    disabled={{ before: today }}
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-1.5">
              <p className="px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Time</p>
              <div className="flex flex-wrap gap-2">
                {pills.map((p) => (
                  <button key={p.value} type="button" onClick={() => setTime(p.value)} className={pillClass(time === p.value)}>
                    {p.label}
                  </button>
                ))}
                {offGridPill ? (
                  // Non-interactive: it only displays the already-selected
                  // off-grid time (chip/window prefill), so it must not be
                  // a focusable button with no action.
                  <span key={`${offGridPill.value}-current`} className={pillClass(true)}>
                    {offGridPill.label}
                  </span>
                ) : null}
              </div>
            </div>

            {canHandleRequests ? (
              <EntityPickerField
                label="Cleaner"
                placeholder="Choose a cleaner"
                items={cleanerItems}
                value={cleanerId}
                onSelect={setCleanerId}
                searchPlaceholder="Search cleaners..."
                emptyText="No cleaners found."
              />
            ) : (
              <Field label="Cleaner">{cleanerName ?? 'Unassigned'}</Field>
            )}

            {conflict ? (
              <div className="flex items-start gap-2 rounded-control border border-caution-700/30 bg-caution-50 px-3 py-2 text-xs text-caution-700">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  {cleanerName ? `${cleanerName} ` : ''}
                  {conflict.label.charAt(0).toLowerCase() + conflict.label.slice(1)}. You can still save.
                </span>
              </div>
            ) : null}

            {outcome ? (
              <div className="rounded-control bg-muted/30 px-3 py-2 text-sm text-foreground">
                <p>{outcomeLine({ outcome, cleanerName, cleanerChanged, escalatedUnassigned, tier })}</p>
                {series ? <p className="mt-1 text-xs text-muted-foreground">{series}</p> : null}
              </div>
            ) : null}
          </div>

          <DialogFooter className="mt-6 gap-2">
            <Button variant="outline" onClick={() => (dirty ? setConfirmDiscard(true) : onDone())}>
              Cancel
            </Button>
            <Button
              loading={saving}
              disabled={!date || !time}
              onClick={submit}
            >
              {outcome ? primaryLabel(outcome, !!conflict, cleanerFirstName) : 'Confirm reschedule'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title="Discard changes?"
        description="This booking's schedule has unsaved changes."
        confirmLabel="Discard"
        onConfirm={() => {
          setConfirmDiscard(false);
          onDone();
        }}
      />
    </>
  );
}
