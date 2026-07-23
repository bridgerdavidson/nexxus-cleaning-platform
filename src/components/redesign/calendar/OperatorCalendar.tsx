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
import { Skeleton } from '@/components/ui/skeleton';
import { getUiPref, setUiPref } from '@/lib/uiPrefs';
import type { ViewMode } from '@/lib/calendar/types';
import type { CleanerOption } from '@/components/redesign/bookings/bookings-types';
import { RescheduleDialog, type RescheduleInit } from '@/components/redesign/bookings/reschedule/RescheduleDialog';
import { useOpenBookingDetail } from '@/components/redesign/bookings/useOpenBookingDetail';
import { operatorBookingParams } from '@/components/redesign/bookings/new-booking/useOpenOperatorBooking';
import { deriveCalendarEvents } from './deriveCalendar';
import { stepDate, useCalendarNavigation } from './useCalendarNavigation';
import { decodeDropId, dropToInit } from './calendarDrop';
import { CalendarToolbar } from './CalendarToolbar';
import { WeekView } from './WeekView';
import { DayView } from './DayView';
import { MonthView } from './MonthView';
import { AgendaView } from './AgendaView';
import { fromDateKey, toDateKey, weekDays } from '@/lib/calendar/dateRange';
import { selectionForMonth } from './monthCellSummary';
import { MobileCalendarBar, type MobileCalendarView } from './MobileCalendarBar';
import { MobileMonthView } from './MobileMonthView';
import { CalendarFilterSheet } from './CalendarFilterSheet';

const CALENDAR_VIEW_PREF = 'operator.calendar.view';

function isViewMode(v: string | null): v is ViewMode {
  return v === 'month' || v === 'week' || v === 'day' || v === 'agenda';
}

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

// First paint had no loading state, so an in-flight fetch showed an empty grid that
// reads as "no jobs". A calendar-shaped skeleton makes loading legible instead.
function CalendarSkeleton() {
  return (
    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-7">
      {Array.from({ length: 7 }).map((_, col) => (
        <div key={col} className="space-y-2">
          <Skeleton className="h-6 w-full rounded-control" />
          <Skeleton className="h-24 w-full rounded-control" />
          <Skeleton className="h-16 w-full rounded-control" />
        </div>
      ))}
    </div>
  );
}

export function OperatorCalendar() {
  const router = useRouter();
  const pathname = usePathname();
  const { currentOrgRole } = useAuth();
  const { appointments, loading, error, refetch } = useAdminAppointments();
  const { cleaners } = useAdminCleaners();
  const { permissions } = useManagerPermissions();

  const privileged = currentOrgRole === 'owner' || currentOrgRole === 'admin';
  const canEdit = privileged || !!permissions?.can_edit_bookings;
  const canHandleRequests = privileged || !!permissions?.can_handle_requests;

  const isMobile = useIsMobile();
  const { view, focusedDate, setView, next, prev, today, goToDate } = useCalendarNavigation('week');
  // An explicit pick is remembered device-locally so a return visit reopens on
  // the same view instead of always snapping back to Week.
  const viewPicked = useRef(false);
  const pickView = (v: ViewMode) => { viewPicked.current = true; setUiPref(CALENDAR_VIEW_PREF, v); setView(v); };
  // Until the user picks: mobile (below md) defaults to the mini month; desktop
  // restores the saved view. Reading the pref here (an effect, not render) keeps
  // it off the server render so there's no hydration mismatch.
  useEffect(() => {
    if (viewPicked.current) return;
    if (isMobile) { setView('month'); return; }
    const saved = getUiPref(CALENDAR_VIEW_PREF);
    if (isViewMode(saved)) setView(saved);
  }, [isMobile, setView]);
  const [cleanerFilter, setCleanerFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedDayKey, setSelectedDayKey] = useState(() => toDateKey(new Date()));
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  // Mobile renders only month/agenda; any other view value coerces to month.
  const mobileView: MobileCalendarView = view === 'agenda' ? 'agenda' : 'month';
  const filtersActive = cleanerFilter !== 'all' || statusFilter !== 'all';

  const mobileStep = (dir: -1 | 1) => {
    const nd = stepDate(mobileView, focusedDate, dir);
    goToDate(nd);
    if (mobileView === 'month') setSelectedDayKey(selectionForMonth(nd, nowMs));
  };
  const mobileToday = () => {
    today();
    setSelectedDayKey(toDateKey(new Date(nowMs)));
  };
  const selectDay = (key: string) => {
    setSelectedDayKey(key);
    const d = fromDateKey(key);
    if (d.getMonth() !== focusedDate.getMonth() || d.getFullYear() !== focusedDate.getFullYear()) goToDate(d);
  };

  if (isMobile) {
    return (
      <>
        <MobileCalendarBar
          view={mobileView}
          rangeLabel={rangeLabelFor(mobileView, focusedDate)}
          filtersActive={filtersActive}
          onView={(v) => pickView(v)}
          onPrev={() => mobileStep(-1)}
          onNext={() => mobileStep(1)}
          onToday={mobileToday}
          onOpenFilters={() => setFiltersOpen(true)}
        />
        {loading ? (
          <CalendarSkeleton />
        ) : mobileView === 'month' ? (
          <MobileMonthView
            events={events}
            focusedDate={focusedDate}
            selectedKey={selectedDayKey}
            nowMs={nowMs}
            canEdit={canEdit}
            onSelectDay={selectDay}
            onOpen={openBooking}
            onCreate={(d) => openNewBooking(d)}
          />
        ) : (
          <AgendaView events={events} focusedDate={focusedDate} nowMs={nowMs} onOpen={openBooking} />
        )}
        <CalendarFilterSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          cleaners={cleanerOptions}
          cleanerFilter={cleanerFilter}
          statusFilter={statusFilter}
          onCleanerFilter={setCleanerFilter}
          onStatusFilter={setStatusFilter}
        />
      </>
    );
  }

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

      {loading ? (
        <CalendarSkeleton />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          {view === 'week' && <WeekView events={events} focusedDate={focusedDate} nowMs={nowMs} canEdit={canEdit} onOpen={openBooking} onCreate={openNewBooking} />}
          {view === 'day' && <DayView events={events} focusedDate={focusedDate} nowMs={nowMs} canEdit={canEdit} onOpen={openBooking} onCreate={openNewBooking} />}
          {view === 'month' && <MonthView events={events} focusedDate={focusedDate} nowMs={nowMs} canEdit={canEdit} onOpen={openBooking} onCreate={(d) => openNewBooking(d)} onPickDay={(d) => { goToDate(d); pickView('day'); }} />}
          {view === 'agenda' && <AgendaView events={events} focusedDate={focusedDate} nowMs={nowMs} onOpen={openBooking} />}
        </DndContext>
      )}

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
