"use client";

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  Calendar as BigCalendar,
  dateFnsLocalizer,
  View,
  Views,
  SlotInfo,
} from "react-big-calendar";
import withDragAndDrop, {
  EventInteractionArgs,
} from "react-big-calendar/lib/addons/dragAndDrop";
import { format, parse, startOfWeek, getDay, addMinutes } from "date-fns";
import { enUS } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  User,
  MapPin,
  Loader2,
} from "lucide-react";
import { AppointmentCardData } from "./AppointmentCard";

// Import CSS for react-big-calendar
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

// Setup date-fns localizer
const locales = {
  "en-US": enUS,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales,
});

// Create DnD calendar
const DnDCalendar = withDragAndDrop(BigCalendar);

// Pending update type for deferred DB sync
export interface PendingDragUpdate {
  appointmentId: string;
  newDate: string;
  newTime: string;
  originalDate: string;
  originalTime: string;
}

// Calendar event interface
interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  appointment: AppointmentCardData;
  status: string;
}

// Status color mapping - matched to StatusBadge colors
const statusColors: Record<string, { bg: string; border: string; text: string }> = {
  pending: {
    bg: "bg-yellow-100",
    border: "border-yellow-500",
    text: "text-yellow-700",
  },
  confirmed: {
    bg: "bg-blue-100",
    border: "border-blue-500",
    text: "text-blue-700",
  },
  in_progress: {
    bg: "bg-purple-100",
    border: "border-purple-500",
    text: "text-purple-700",
  },
  completed: {
    bg: "bg-green-100",
    border: "border-green-500",
    text: "text-green-700",
  },
  cancelled: {
    bg: "bg-red-100",
    border: "border-red-500",
    text: "text-red-700",
  },
};

interface CalendarViewProps {
  appointments: AppointmentCardData[];
  loading: boolean;
  onAppointmentClick: (appointment: AppointmentCardData) => void;
  onDayClick: (date: Date, appointments: AppointmentCardData[]) => void;
  onSlotSelect: (date: Date, time: string) => void;
  onReschedule: (
    appointmentId: string,
    newDate: string,
    newTime: string
  ) => Promise<void>;
  onLocalReschedule?: (
    appointmentId: string,
    newDate: string,
    newTime: string,
    originalDate: string,
    originalTime: string
  ) => void;
  canEdit?: boolean;
}

export default function CalendarView({
  appointments,
  loading,
  onAppointmentClick,
  onDayClick,
  onSlotSelect,
  onReschedule,
  onLocalReschedule,
  canEdit = true,
}: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [currentView, setCurrentView] = useState<View>(Views.MONTH);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingEventId, setDraggingEventId] = useState<string | null>(null);
  const [isActuallyDragging, setIsActuallyDragging] = useState(false);
  const dragTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dragStartTimeRef = useRef<number>(0);
  const dragStartPositionRef = useRef<{ x: number; y: number } | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
      }
    };
  }, []);

  // Convert appointments to calendar events
  const events: CalendarEvent[] = useMemo(() => {
    return appointments.map((apt) => {
      // Parse date and time
      const [year, month, day] = apt.scheduled_date.split("-").map(Number);
      const [hours, minutes] = apt.scheduled_time.split(":").map(Number);

      const start = new Date(year, month - 1, day, hours, minutes);
      // Default duration 60 minutes if not specified
      const end = addMinutes(start, 60);

      // Build title
      const homeownerName = apt.homeowner
        ? `${apt.homeowner.first_name} ${apt.homeowner.last_name}`
        : "Unknown";
      const serviceName = apt.service_type?.name || "Service";

      return {
        id: apt.id,
        title: `${homeownerName} - ${serviceName}`,
        start,
        end,
        appointment: apt,
        status: apt.status,
      };
    });
  }, [appointments]);

  // Get appointments for a specific date
  const getAppointmentsForDate = useCallback(
    (date: Date) => {
      const dateStr = format(date, "yyyy-MM-dd");
      return appointments.filter((apt) => apt.scheduled_date === dateStr);
    },
    [appointments]
  );

  // Custom event style - includes dragging state
  const eventStyleGetter = useCallback(
    (event: CalendarEvent) => {
      const colors = statusColors[event.status] || statusColors.pending;
      const isBeingDragged = isActuallyDragging && draggingEventId === event.id;
      return {
        className: `${colors.bg} ${colors.border} ${colors.text} border-l-4 rounded-md px-1 py-1.5 text-xs font-medium overflow-hidden cursor-pointer hover:opacity-90 transition-opacity`,
        style: {
          backgroundColor: "transparent",
          border: "none",
          outline: "none",
          boxShadow: isBeingDragged 
            ? "0 8px 25px -5px rgba(0, 0, 0, 0.25), 0 10px 10px -5px rgba(0, 0, 0, 0.1)"
            : undefined,
          transform: isBeingDragged ? "scale(1.05) rotate(2deg)" : undefined,
          zIndex: isBeingDragged ? 1000 : undefined,
          cursor: isActuallyDragging ? "grabbing" : "grab",
        },
      };
    },
    [draggingEventId, isActuallyDragging]
  );

  // Custom event component
  const EventComponent = useCallback(
    ({ event }: { event: CalendarEvent }) => {
      const colors = statusColors[event.status] || statusColors.pending;
      const apt = event.appointment;
      const homeownerName = apt.homeowner
        ? `${apt.homeowner.first_name} ${apt.homeowner.last_name}`
        : "Unknown";

      return (
        <div
          className={`${colors.bg} ${colors.text} border-l-4 ${colors.border} rounded-r px-1.5 py-1.5 h-full overflow-hidden`}
        >
          <div className="font-medium text-xs truncate">{homeownerName}</div>
          {currentView !== Views.MONTH && (
            <div className="text-xs opacity-75 truncate">
              {apt.service_type?.name}
            </div>
          )}
        </div>
      );
    },
    [currentView]
  );

  // Handle event click
  const handleSelectEvent = useCallback(
    (event: CalendarEvent) => {
      // Always open side panel on select event
      onAppointmentClick(event.appointment);
    },
    [onAppointmentClick]
  );

  // Handle slot selection (clicking on an empty slot)
  const handleSelectSlot = useCallback(
    (slotInfo: SlotInfo) => {
      if (!canEdit) return;

      const { start, action } = slotInfo;

      // For month view, clicking a day opens day detail
      if (currentView === Views.MONTH && action === "click") {
        const dayAppointments = getAppointmentsForDate(start);
        onDayClick(start, dayAppointments);
        return;
      }

      // For week/day view or double-click, open quick add
      if (action === "doubleClick" || currentView !== Views.MONTH) {
        const dateStr = format(start, "yyyy-MM-dd");
        const timeStr = format(start, "HH:mm");
        onSlotSelect(start, timeStr);
      }
    },
    [canEdit, currentView, getAppointmentsForDate, onDayClick, onSlotSelect]
  );


  // Handle drag start - for visual feedback
  const handleDragStart = useCallback(
    ({ event }: { event: CalendarEvent }) => {
      dragStartTimeRef.current = Date.now();
      setDraggingEventId(event.id);
      
      // Set a timeout to show visual drag effect only after holding for a moment
      // This prevents the effect from showing on quick clicks
      dragTimeoutRef.current = setTimeout(() => {
        setIsDragging(true);
        setIsActuallyDragging(true);
      }, 300);
    },
    []
  );

  // Handle event drag and drop
  const handleEventDrop = useCallback(
    async ({ event, start }: EventInteractionArgs<CalendarEvent>) => {
      const dragDuration = Date.now() - dragStartTimeRef.current;
      
      // Clear dragging state and timeout
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
        dragTimeoutRef.current = null;
      }

      const wasActuallyDragging = isActuallyDragging;
      
      setDraggingEventId(null);
      setIsDragging(false);
      setIsActuallyDragging(false);
      dragStartTimeRef.current = 0;

      // If this was a quick click/release, the onSelectEvent will handle opening side panel
      // Only proceed with rescheduling if user actually dragged
      if (!wasActuallyDragging || dragDuration < 300) {
        return;
      }

      // Proceed with drag and drop
      if (!canEdit) return;

      const newDate = format(start as Date, "yyyy-MM-dd");
      const newTime = format(start as Date, "HH:mm:ss");
      const originalDate = event.appointment.scheduled_date;
      const originalTime = event.appointment.scheduled_time;

      // If local reschedule handler is provided, use deferred update pattern
      if (onLocalReschedule) {
        onLocalReschedule(event.id, newDate, newTime, originalDate, originalTime);
      } else {
        // Fallback to immediate DB update (legacy behavior)
        try {
          await onReschedule(event.id, newDate, newTime);
        } catch (error) {
          console.error("Failed to reschedule:", error);
        }
      }
    },
    [canEdit, onReschedule, onLocalReschedule, isActuallyDragging]
  );

  // Navigation handlers
  const handleNavigate = useCallback((date: Date) => {
    setCurrentDate(date);
  }, []);

  const handleViewChange = useCallback((view: View) => {
    setCurrentView(view);
  }, []);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const goBack = useCallback(() => {
    const newDate = new Date(currentDate);
    if (currentView === Views.MONTH) {
      newDate.setMonth(newDate.getMonth() - 1);
    } else if (currentView === Views.WEEK) {
      newDate.setDate(newDate.getDate() - 7);
    } else {
      newDate.setDate(newDate.getDate() - 1);
    }
    setCurrentDate(newDate);
  }, [currentDate, currentView]);

  const goForward = useCallback(() => {
    const newDate = new Date(currentDate);
    if (currentView === Views.MONTH) {
      newDate.setMonth(newDate.getMonth() + 1);
    } else if (currentView === Views.WEEK) {
      newDate.setDate(newDate.getDate() + 7);
    } else {
      newDate.setDate(newDate.getDate() + 1);
    }
    setCurrentDate(newDate);
  }, [currentDate, currentView]);

  // Custom toolbar
  const CustomToolbar = () => {
    const label =
      currentView === Views.MONTH
        ? format(currentDate, "MMMM yyyy")
        : currentView === Views.WEEK
        ? `Week of ${format(currentDate, "MMM d, yyyy")}`
        : format(currentDate, "EEEE, MMMM d, yyyy");

    return (
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToToday}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Today
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={goBack}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={goForward}
              className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 ml-2">{label}</h2>
        </div>

        {/* View Selector */}
        <div className="flex items-center bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => setCurrentView(Views.MONTH)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              currentView === Views.MONTH
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Month
          </button>
          <button
            onClick={() => setCurrentView(Views.WEEK)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              currentView === Views.WEEK
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Week
          </button>
          <button
            onClick={() => setCurrentView(Views.DAY)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              currentView === Views.DAY
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Day
          </button>
          <button
            onClick={() => setCurrentView(Views.AGENDA)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              currentView === Views.AGENDA
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Agenda
          </button>
        </div>
      </div>
    );
  };

  // Status legend
  const StatusLegend = () => {
    const solidColors: Record<string, string> = {
      pending: "bg-yellow-400",
      confirmed: "bg-blue-400",
      in_progress: "bg-purple-400",
      completed: "bg-green-400",
      cancelled: "bg-red-400",
    };

    return (
      <div className="flex flex-wrap items-center gap-3 mb-4 text-xs">
        <span className="text-gray-500 font-medium">Status:</span>
        {Object.entries(statusColors).map(([status]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded ${solidColors[status]}`} />
            <span className="text-gray-600 capitalize">
              {status.replace("_", " ")}
            </span>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-600">Loading calendar...</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <CustomToolbar />
      <StatusLegend />

      <div className={`calendar-container ${isActuallyDragging ? 'is-dragging' : ''}`} style={{ height: "calc(100vh - 350px)", minHeight: "500px" }}>
        {/* Drag overlay - only show when using immediate DB update (legacy behavior) */}
        {isDragging && !onLocalReschedule && !draggingEventId && (
          <div className="absolute inset-0 bg-white/50 z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow-lg">
              <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
              <span className="text-sm font-medium text-gray-700">
                Updating...
              </span>
            </div>
          </div>
        )}
        <DnDCalendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          date={currentDate}
          view={currentView}
          onNavigate={handleNavigate}
          onView={handleViewChange}
          onSelectEvent={handleSelectEvent}
          onSelectSlot={handleSelectSlot}
          onEventDrop={handleEventDrop}
          onDragStart={handleDragStart}
          selectable={canEdit}
          resizable={false}
          draggableAccessor={() => canEdit}
          eventPropGetter={eventStyleGetter}
          components={{
            event: EventComponent,
            toolbar: () => null, // Using custom toolbar above
          }}
          views={[Views.MONTH, Views.WEEK, Views.DAY, Views.AGENDA]}
          step={30}
          timeslots={2}
          min={new Date(2024, 0, 1, 6, 0, 0)} // 6 AM
          max={new Date(2024, 0, 1, 22, 0, 0)} // 10 PM
          popup
          popupOffset={{ x: 0, y: 0 }}
          dayLayoutAlgorithm="overlap"
        />
      </div>

      {/* Calendar tip */}
      <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
        <div className="flex items-start gap-2">
          <CalendarIcon className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <span className="font-medium">Tips:</span>{" "}
            {currentView === Views.MONTH
              ? "Click a day to view appointments. Double-click to add new."
              : "Click a time slot to add a new appointment. Drag events to reschedule."}
          </div>
        </div>
      </div>

      {/* Custom drag and drop styles */}
      <style jsx global>{`
        /* Remove all white borders and outlines from calendar events */
        .calendar-container .rbc-event {
          outline: none !important;
          border: none !important;
          border-right: none !important;
        }

        .calendar-container .rbc-event:focus {
          outline: none !important;
          border: none !important;
        }

        .calendar-container .rbc-selected {
          outline: none !important;
          border: none !important;
        }

        .calendar-container .rbc-event-content {
          outline: none !important;
          border: none !important;
        }

        /* Completely hide drag preview - doesn't work properly */
        .calendar-container .rbc-addons-dnd-drag-row {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
        }

        /* Source event during drag - make it slightly transparent */
        .calendar-container.is-dragging .rbc-addons-dnd-dragged-event {
          opacity: 0.5 !important;
          filter: brightness(0.9);
        }

        /* Drop target highlight - only when actually dragging */
        .calendar-container.is-dragging .rbc-addons-dnd-over {
          background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.25) 100%) !important;
          box-shadow: inset 0 0 0 3px rgba(59, 130, 246, 0.6) !important;
          border-radius: 6px;
          transition: all 0.2s ease;
          animation: pulse-drop 1s ease-in-out infinite;
        }

        /* Hide drop target when not dragging */
        .calendar-container:not(.is-dragging) .rbc-addons-dnd-over {
          background-color: transparent !important;
          box-shadow: none !important;
        }

        @keyframes pulse-drop {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.85;
          }
        }

        /* Time view drop highlights */
        .calendar-container.is-dragging .rbc-day-slot .rbc-addons-dnd-over {
          background-color: rgba(59, 130, 246, 0.2) !important;
          border-left: 3px solid #3b82f6 !important;
        }

        /* Dragging cursor */
        .calendar-container.is-dragging {
          cursor: grabbing !important;
        }

        .calendar-container.is-dragging * {
          cursor: grabbing !important;
        }
      `}</style>
    </div>
  );
}

