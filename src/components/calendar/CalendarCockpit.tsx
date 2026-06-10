/**
 * The scheduling cockpit shell: a drop-in replacement for the old CalendarView. Owns view +
 * focused-date state, maps appointments to events, hosts the @dnd-kit context, and renders the
 * active view inside a bounded scroll area. Click an event -> open the detail panel. Drag a
 * Week chip onto a time slot -> reschedule (optimistic + instant via onReschedule). The Day
 * dispatch board's drag (time + cross-cleaner reassign) and mobile layouts arrive in later
 * phases.
 */
'use client';
import React, { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Loader2 } from 'lucide-react';
import type { AppointmentCardData } from '@/components/AppointmentCard';
import type { CalendarCleaner, CalendarEvent, ViewMode } from '@/lib/calendar/types';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useCalendarNavigation } from '@/hooks/useCalendarNavigation';
import { useIsMobile } from '@/hooks/useIsMobile';
import { minutesToTimeString } from '@/lib/calendar/timeGrid';
import { findConflicts, type ScheduleAppointment } from '@/lib/appointmentConflicts';
import CalendarToolbar from './CalendarToolbar';
import CalendarLegend from './CalendarLegend';
import CalendarDragLayer from './CalendarDragLayer';
import ReassignConfirmPopover, { type PendingReassign } from './ReassignConfirmPopover';
import MonthView from './MonthView';
import WeekTimeGrid from './WeekTimeGrid';
import DayDispatchBoard from './DayDispatchBoard';
import AgendaList from './AgendaList';

export interface CalendarCockpitProps {
  appointments: AppointmentCardData[];
  loading?: boolean;
  onAppointmentClick: (appointment: AppointmentCardData) => void;
  /** Persist a same-cleaner reschedule (optimistic update + toast handled by the caller). */
  onReschedule?: (eventId: string, newDate: string, newTime: string) => void | Promise<void>;
  /** Persist a cross-cleaner reassign from the dispatch board (caller handles optimistic + toast). */
  onReassign?: (eventId: string, cleanerId: string, force: boolean) => Promise<unknown>;
  onSlotSelect?: (date: Date, time: string) => void;
  onSlotSelectWithCleaner?: (date: Date, time: string, cleanerId: string) => void;
  canEdit?: boolean;
  canReassign?: boolean;
  cleaners?: CalendarCleaner[];
  role?: 'admin' | 'manager' | 'cleaner' | 'homeowner';
  initialView?: ViewMode;
  initialDate?: Date;
}

/** Decode an @dnd-kit droppable id into a reschedule/reassign target. */
function decodeDrop(
  overId: string,
): { date: string; minutes?: number; cleanerId?: string } | null {
  if (overId.startsWith('day:')) return { date: overId.slice(4) };
  if (overId.startsWith('slot:')) {
    const parts = overId.slice(5).split(':');
    if (parts.length === 2) return { date: parts[0], minutes: Number(parts[1]) };
    if (parts.length === 3)
      return { cleanerId: parts[0], date: parts[1], minutes: Number(parts[2]) };
  }
  return null;
}

export default function CalendarCockpit({
  appointments,
  loading = false,
  onAppointmentClick,
  onReschedule,
  onReassign,
  cleaners = [],
  canEdit = true,
  canReassign = false,
  role = 'admin',
  initialView,
  initialDate,
}: CalendarCockpitProps) {
  const isMobile = useIsMobile();
  const nav = useCalendarNavigation(initialView ?? (isMobile ? 'agenda' : 'week'), initialDate);
  const events = useCalendarEvents(appointments, role);
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  const [pendingReassign, setPendingReassign] = useState<PendingReassign | null>(null);
  const [reassigning, setReassigning] = useState(false);

  const editable = canEdit && role !== 'cleaner' && !!onReschedule;

  const cleanerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of events) if (e.cleanerId && e.cleanerName) m.set(e.cleanerId, e.cleanerName);
    for (const c of cleaners) m.set(c.id, c.name);
    return m;
  }, [events, cleaners]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const apptsById = useMemo(() => {
    const m = new Map<string, AppointmentCardData>();
    for (const a of appointments) m.set(a.id, a);
    return m;
  }, [appointments]);

  const eventsById = useMemo(() => {
    const m = new Map<string, CalendarEvent>();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  const handleEventClick = (ev: CalendarEvent) => {
    const apt = apptsById.get(ev.id);
    if (apt) onAppointmentClick(apt);
  };

  const openDay = (date: Date) => {
    nav.setCurrentDate(date);
    nav.setView('day');
  };

  const handleDragStart = (e: DragStartEvent) => {
    setActiveEvent(eventsById.get(String(e.active.id)) ?? null);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const ev = activeEvent;
    setActiveEvent(null);
    if (!ev || !e.over) return;
    const target = decodeDrop(String(e.over.id));
    if (!target) return;

    const isCrossCleaner =
      target.cleanerId !== undefined && target.cleanerId !== (ev.cleanerId ?? '');

    // Cross-cleaner drop on the dispatch board: a reassign. Check conflicts client-side, then
    // confirm before firing (it returns the job to Pending and pings the new cleaner).
    if (isCrossCleaner) {
      if (!onReassign || !canReassign) return;
      const targetCleanerId = target.cleanerId as string;
      const targetSchedule: ScheduleAppointment[] = events
        .filter((x) => x.cleanerId === targetCleanerId)
        .map((x) => ({
          id: x.id,
          status: x.status,
          scheduled_date: x.date,
          scheduled_time: minutesToTimeString(x.startMin),
          duration_minutes: x.durationMin,
        }));
      const conflicts = findConflicts(
        targetSchedule,
        { date: ev.date, time: minutesToTimeString(ev.startMin), durationMinutes: ev.durationMin },
        { excludeAppointmentId: ev.id },
      );
      setPendingReassign({
        eventId: ev.id,
        customerLabel: ev.customerLabel,
        cleanerId: targetCleanerId,
        cleanerName: cleanerNameById.get(targetCleanerId) ?? 'this cleaner',
        hasConflict: conflicts.length > 0,
      });
      return;
    }

    // Same cleaner (or Week/Month): a time/date reschedule.
    if (!onReschedule) return;
    const newMinutes = target.minutes ?? ev.startMin;
    if (target.date === ev.date && newMinutes === ev.startMin) return; // no-op
    void onReschedule(ev.id, target.date, minutesToTimeString(newMinutes));
  };

  const confirmReassign = async () => {
    if (!pendingReassign || !onReassign) return;
    setReassigning(true);
    try {
      await onReassign(pendingReassign.eventId, pendingReassign.cleanerId, pendingReassign.hasConflict);
    } finally {
      setReassigning(false);
      setPendingReassign(null);
    }
  };

  const showLegend = nav.view !== 'agenda';
  const isDragActive = activeEvent !== null;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="space-y-2 border-b border-gray-100 p-3">
        <CalendarToolbar
          view={nav.view}
          currentDate={nav.currentDate}
          onView={nav.setView}
          onPrev={nav.goPrev}
          onNext={nav.goNext}
          onToday={nav.goToday}
        />
        {showLegend && <CalendarLegend />}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveEvent(null)}
      >
        <div className="relative h-[calc(100vh-300px)] min-h-[460px] overflow-auto">
          {loading && events.length === 0 ? (
            <div className="flex h-full items-center justify-center text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading calendar</span>
            </div>
          ) : nav.view === 'month' ? (
            <MonthView
              events={events}
              currentDate={nav.currentDate}
              onEventClick={handleEventClick}
              onDayOpen={openDay}
            />
          ) : nav.view === 'week' ? (
            <WeekTimeGrid
              events={events}
              currentDate={nav.currentDate}
              onEventClick={handleEventClick}
              onDayOpen={openDay}
              editable={editable}
              isDragActive={isDragActive}
            />
          ) : nav.view === 'day' ? (
            <DayDispatchBoard
              events={events}
              cleaners={cleaners}
              currentDate={nav.currentDate}
              onEventClick={handleEventClick}
              editable={editable}
              isDragActive={isDragActive}
            />
          ) : (
            <AgendaList
              events={events}
              currentDate={nav.currentDate}
              onEventClick={handleEventClick}
            />
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeEvent ? <CalendarDragLayer event={activeEvent} /> : null}
        </DragOverlay>
      </DndContext>

      {pendingReassign && (
        <ReassignConfirmPopover
          pending={pendingReassign}
          busy={reassigning}
          onConfirm={confirmReassign}
          onCancel={() => setPendingReassign(null)}
        />
      )}
    </div>
  );
}
