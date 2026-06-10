/**
 * The scheduling cockpit shell: a drop-in replacement for the old CalendarView. Owns view +
 * focused-date state, maps appointments to events, and renders the active view inside a bounded
 * scroll area. Phase 2 is read-only (click an event -> open the detail panel via
 * onAppointmentClick); drag-to-reschedule, empty-slot create, and cross-cleaner reassign are
 * layered on in Phases 3-4. Mobile-specific layouts arrive in Phase 5 (agenda is the default).
 */
'use client';
import React, { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import type { AppointmentCardData } from '@/components/AppointmentCard';
import type { CalendarCleaner, CalendarEvent, ViewMode } from '@/lib/calendar/types';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useCalendarNavigation } from '@/hooks/useCalendarNavigation';
import { useIsMobile } from '@/hooks/useIsMobile';
import CalendarToolbar from './CalendarToolbar';
import CalendarLegend from './CalendarLegend';
import MonthView from './MonthView';
import WeekTimeGrid from './WeekTimeGrid';
import DayDispatchBoard from './DayDispatchBoard';
import AgendaList from './AgendaList';

export interface CalendarCockpitProps {
  appointments: AppointmentCardData[];
  loading?: boolean;
  onAppointmentClick: (appointment: AppointmentCardData) => void;
  onSlotSelect?: (date: Date, time: string) => void;
  onSlotSelectWithCleaner?: (date: Date, time: string, cleanerId: string) => void;
  canEdit?: boolean;
  canReassign?: boolean;
  cleaners?: CalendarCleaner[];
  role?: 'admin' | 'manager' | 'cleaner' | 'homeowner';
  initialView?: ViewMode;
  initialDate?: Date;
}

export default function CalendarCockpit({
  appointments,
  loading = false,
  onAppointmentClick,
  cleaners = [],
  role = 'admin',
  initialView,
  initialDate,
}: CalendarCockpitProps) {
  const isMobile = useIsMobile();
  const nav = useCalendarNavigation(initialView ?? (isMobile ? 'agenda' : 'week'), initialDate);
  const events = useCalendarEvents(appointments, role);

  const byId = useMemo(() => {
    const m = new Map<string, AppointmentCardData>();
    for (const a of appointments) m.set(a.id, a);
    return m;
  }, [appointments]);

  const handleEventClick = (ev: CalendarEvent) => {
    const apt = byId.get(ev.id);
    if (apt) onAppointmentClick(apt);
  };

  const openDay = (date: Date) => {
    nav.setCurrentDate(date);
    nav.setView('day');
  };

  const showLegend = nav.view !== 'agenda';

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
    </div>
  );
}
