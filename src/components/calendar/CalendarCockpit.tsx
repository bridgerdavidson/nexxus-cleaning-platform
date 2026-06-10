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
import CalendarToolbar from './CalendarToolbar';
import CalendarLegend from './CalendarLegend';
import CalendarDragLayer from './CalendarDragLayer';
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
  cleaners = [],
  canEdit = true,
  role = 'admin',
  initialView,
  initialDate,
}: CalendarCockpitProps) {
  const isMobile = useIsMobile();
  const nav = useCalendarNavigation(initialView ?? (isMobile ? 'agenda' : 'week'), initialDate);
  const events = useCalendarEvents(appointments, role);
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);

  const editable = canEdit && role !== 'cleaner' && !!onReschedule;

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
    if (!ev || !e.over || !onReschedule) return;
    const target = decodeDrop(String(e.over.id));
    if (!target) return;
    // Cross-cleaner moves are a reassign (Phase 4), not a plain reschedule. Ignore here.
    if (target.cleanerId && target.cleanerId !== (ev.cleanerId ?? '')) return;
    const newMinutes = target.minutes ?? ev.startMin;
    if (target.date === ev.date && newMinutes === ev.startMin) return; // no-op
    void onReschedule(ev.id, target.date, minutesToTimeString(newMinutes));
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
    </div>
  );
}
