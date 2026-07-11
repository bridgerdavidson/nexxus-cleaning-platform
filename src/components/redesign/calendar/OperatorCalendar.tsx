// src/components/redesign/calendar/OperatorCalendar.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useAdminAppointments, useAdminCleaners, type AdminAppointment } from '@/hooks/useAdminData';
import { useAuth } from '@/hooks/useAuth';
import { useManagerPermissions } from '@/hooks/useManagerPermissions';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ErrorState } from '@/components/ui/error-state';
import type { ViewMode } from '@/lib/calendar/types';
import type { CleanerOption } from '@/components/redesign/bookings/bookings-types';
import { RescheduleDialog, type RescheduleInit } from '@/components/redesign/bookings/reschedule/RescheduleDialog';
import { useOpenBookingDetail } from '@/components/redesign/bookings/useOpenBookingDetail';
import { operatorBookingParams } from '@/components/redesign/bookings/new-booking/useOpenOperatorBooking';
import { deriveCalendarEvents } from './deriveCalendar';
import { useCalendarNavigation } from './useCalendarNavigation';
import { decodeDropId, dropToInit } from './calendarDrop';
import { CalendarToolbar } from './CalendarToolbar';
import { WeekView } from './WeekView';
import { DayView } from './DayView';
import { MonthView } from './MonthView';
import { AgendaView } from './AgendaView';
import { weekDays } from '@/lib/calendar/dateRange';

function rangeLabelFor(view: string, date: Date): string {
  if (view === 'month') return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (view === 'day') return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  if (view === 'agenda') return 'Upcoming';
  const days = weekDays(date, 1);
  const a = days[0], b = days[6];
  const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const right =
    a.getMonth() === b.getMonth()
      ? `${b.getDate()}, ${b.getFullYear()}`
      : b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${left} to ${right}`;
}

export function OperatorCalendar() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentOrgRole } = useAuth();
  const { appointments, error, refetch } = useAdminAppointments();
  const { cleaners } = useAdminCleaners();
  const { permissions } = useManagerPermissions();

  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  const canEdit = privileged || !!permissions?.can_edit_bookings;
  const canHandleRequests = privileged || !!permissions?.can_handle_requests;

  const isMobile = useIsMobile();
  const { view, focusedDate, setView, next, prev, today, goToDate } = useCalendarNavigation('week');
  // Mobile (below md) defaults to Agenda, but never clobbers an explicit choice.
  const viewPicked = useRef(false);
  const pickView = (v: ViewMode) => { viewPicked.current = true; setView(v); };
  useEffect(() => { if (isMobile && !viewPicked.current) setView('agenda'); }, [isMobile, setView]);
  const [cleanerFilter, setCleanerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [reschedule, setReschedule] = useState<{ appointment: AdminAppointment; init: RescheduleInit } | null>(null);

  // Tick the now-line every 60s.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const cleanerOptions: CleanerOption[] = useMemo(
    () => cleaners.map((c) => ({ id: c.id, name: `${c.user_profile?.first_name ?? ''} ${c.user_profile?.last_name ?? ''}`.trim() || 'Cleaner' })),
    [cleaners],
  );

  const filtered = useMemo(
    () => appointments.filter((a) =>
      (cleanerFilter === 'all' || a.cleaner_id === cleanerFilter) &&
      (statusFilter === 'all' || a.status === statusFilter),
    ),
    [appointments, cleanerFilter, statusFilter],
  );
  const events = useMemo(() => deriveCalendarEvents(filtered), [filtered]);

  const openBooking = useOpenBookingDetail();

  const openNewBooking = (date?: string, time?: string) => {
    const qs = new URLSearchParams(operatorBookingParams(date || time ? { date, time } : undefined)).toString();
    router.replace(`${pathname}?${qs}`, { scroll: false });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const decoded = decodeDropId(e.over?.id as string | undefined);
    if (!decoded) return;
    const eventId = (e.active.data.current as { eventId?: string } | undefined)?.eventId;
    const appt = eventId ? appointments.find((a) => a.id === eventId) : null;
    if (!appt) return;
    setReschedule({ appointment: appt, init: dropToInit(decoded) });
  };

  if (error) return <ErrorState title="Couldn't load the calendar" onRetry={() => void refetch()} />;

  const rangeLabel = rangeLabelFor(view, focusedDate);

  return (
    <>
      <CalendarToolbar
        view={view}
        rangeLabel={rangeLabel}
        cleaners={cleanerOptions}
        cleanerFilter={cleanerFilter}
        statusFilter={statusFilter}
        canCreate={canEdit}
        onView={pickView}
        onPrev={prev}
        onNext={next}
        onToday={today}
        onCleanerFilter={setCleanerFilter}
        onStatusFilter={setStatusFilter}
        onNewBooking={() => openNewBooking()}
      />

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {view === 'week' && <WeekView events={events} focusedDate={focusedDate} nowMs={nowMs} canEdit={canEdit} onOpen={openBooking} onCreate={openNewBooking} />}
        {view === 'day' && <DayView events={events} focusedDate={focusedDate} nowMs={nowMs} canEdit={canEdit} onOpen={openBooking} onCreate={openNewBooking} />}
        {view === 'month' && <MonthView events={events} focusedDate={focusedDate} nowMs={nowMs} canEdit={canEdit} onOpen={openBooking} onCreate={(d) => openNewBooking(d)} onPickDay={(d) => { goToDate(d); pickView('day'); }} />}
        {view === 'agenda' && <AgendaView events={events} focusedDate={focusedDate} nowMs={nowMs} onOpen={openBooking} />}
      </DndContext>

      {reschedule ? (
        <RescheduleDialog
          appointment={reschedule.appointment}
          appointments={appointments}
          cleaners={cleanerOptions}
          canHandleRequests={canHandleRequests}
          init={reschedule.init}
          onOpenChange={(o) => { if (!o) setReschedule(null); }}
          onDone={() => { setReschedule(null); void refetch(); }}
        />
      ) : null}
    </>
  );
}
