import React, {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  Search,
  Bell,
  ChevronRight,
  Loader2,
  Calendar,
  CheckSquare,
  Square,
  Trash2,
  XCircle,
  Plus,
  ChevronDown,
  List,
  CalendarDays,
  Clock,
  MapPin,
  History,
  SprayCan,
} from "lucide-react";
import { format } from "date-fns";
import AppointmentCard, { AppointmentCardData } from "./AppointmentCard";
import BulkActionConfirmModal from "./BulkActionConfirmModal";
import AddAppointmentModal from "./AddAppointmentModal";
import CalendarView, { PendingDragUpdate } from "./CalendarView";
import CalendarCockpit from "./calendar/CalendarCockpit";
import DayDetailSidebar from "./DayDetailSidebar";
import { updateAppointment } from "../hooks/useAdminData";
import { useReopenableModalUrl } from "../hooks/useReopenableModalUrl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ViewType = "list" | "calendar";

interface BookingsPageProps {
  appointments: AppointmentCardData[];
  loading: boolean;
  onCancelAppointment: (appointmentId: string) => Promise<void>;
  onDeleteAppointment: (appointmentId: string) => Promise<void>;
  /**
   * Bulk variants used by multi-select. When provided, the whole selection is
   * sent as ONE chunked, sequential operation instead of a per-row request
   * storm. Falls back to a sequential loop over the single-item handlers when
   * omitted (still never a concurrent fan-out).
   */
  onBulkDeleteAppointments?: (appointmentIds: string[]) => Promise<void>;
  onBulkCancelAppointments?: (appointmentIds: string[]) => Promise<void>;
  onRefreshAppointments?: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onAppointmentUpdated?: (appointmentId: string, updatedData: any) => void;
  /** Open the shared appointment-details panel (URL-driven, mounted at the dashboard page level). */
  onOpenAppointment: (appointmentId: string) => void;
  /** Count of admin/manager action items, used to render a slim "needs
   *  attention" banner that links back to the Action Center on the Overview. */
  actionCount?: number;
  onGoToActionCenter?: () => void;
  role: "admin" | "manager" | "homeowner";
  canEdit?: boolean;
  initialStatusFilter?: string;
  canApproveDecline?: boolean;
  /**
   * Show the in-header "New" button. Admin/manager dashboards set this false
   * because the create action now lives in the top nav bar (and a mobile FAB).
   * Defaults true so other callers keep the inline button.
   */
  showCreateButton?: boolean;
}

export default function BookingsPage({
  appointments,
  loading,
  onCancelAppointment,
  onDeleteAppointment,
  onBulkDeleteAppointments,
  onBulkCancelAppointments,
  onRefreshAppointments,
  onAppointmentUpdated,
  onOpenAppointment,
  actionCount,
  onGoToActionCenter,
  role,
  canEdit = true,
  initialStatusFilter,
  canApproveDecline = false,
  showCreateButton = true,
}: BookingsPageProps) {
  const [viewType, setViewType] = useState<ViewType>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(
    initialStatusFilter || "all",
  );
  const [upcomingDaysFilter, setUpcomingDaysFilter] = useState<number>(30);
  const [appointmentsTab, setAppointmentsTab] = useState<
    "upcoming" | "past" | "all"
  >("upcoming");
  const [showAddAppointmentModal, setShowAddAppointmentModal] = useState(false);
  // Keep the New Appointment modal in the URL (?modal=add-appointment) so a full reload reopens
  // it and AddAppointmentModal restores its saved draft. Only the no-preselection flow opened
  // from this host persists, so this is where the reopen marker is driven.
  const {
    isOpenFromUrl: addApptOpenFromUrl,
    openModalUrl: openAddApptUrl,
    closeModalUrl: closeAddApptUrl,
  } = useReopenableModalUrl("add-appointment");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Calendar-specific state
  const [showDayDetailSidebar, setShowDayDetailSidebar] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [dayAppointments, setDayAppointments] = useState<AppointmentCardData[]>(
    [],
  );
  const [preFilledDate, setPreFilledDate] = useState<string | undefined>();
  const [preFilledTime, setPreFilledTime] = useState<string | undefined>();

  // Selection state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkAction, setBulkAction] = useState<"cancel" | "delete">("delete");
  const [isBulkActionLoading, setIsBulkActionLoading] = useState(false);
  // Capture selected IDs when opening bulk modal so confirm uses the same set (avoids stale closure)
  const selectedIdsForBulkRef = useRef<Set<string>>(new Set());

  // Pending drag updates for deferred DB sync
  const [pendingDragUpdates, setPendingDragUpdates] = useState<
    Map<string, PendingDragUpdate>
  >(new Map());
  const pendingDragUpdatesRef = useRef<Map<string, PendingDragUpdate>>(
    new Map(),
  );

  // Debounce timer for flushing pending updates
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Local appointments state for optimistic updates
  const [localAppointments, setLocalAppointments] =
    useState<AppointmentCardData[]>(appointments);

  // Keep local appointments in sync with prop changes (but preserve local modifications)
  useEffect(() => {
    setLocalAppointments((prevLocal) => {
      // Merge prop appointments with any local modifications from pending updates
      const pendingIds = new Set(pendingDragUpdates.keys());

      return appointments.map((apt) => {
        // If this appointment has a pending update, keep the local version
        if (pendingIds.has(apt.id)) {
          const existingLocal = prevLocal.find((l) => l.id === apt.id);
          if (existingLocal) return existingLocal;
        }
        return apt;
      });
    });
  }, [appointments, pendingDragUpdates]);

  // Keep ref in sync with state for use in cleanup
  useEffect(() => {
    pendingDragUpdatesRef.current = pendingDragUpdates;
  }, [pendingDragUpdates]);

  // Function to flush pending updates to the database
  const flushPendingUpdates = useCallback(async () => {
    const updates = pendingDragUpdatesRef.current;
    if (updates.size === 0) return;

    const updatePromises = Array.from(updates.values()).map(async (update) => {
      try {
        const result = await updateAppointment(update.appointmentId, {
          scheduled_date: update.newDate,
          scheduled_time: update.newTime,
        });

        if (result.success && result.data && onAppointmentUpdated) {
          onAppointmentUpdated(update.appointmentId, result.data);
        }

        return { success: true, id: update.appointmentId };
      } catch (error) {
        console.error(
          `Failed to update appointment ${update.appointmentId}:`,
          error,
        );
        return { success: false, id: update.appointmentId, error };
      }
    });

    await Promise.all(updatePromises);

    // Clear pending updates
    setPendingDragUpdates(new Map());
  }, [onAppointmentUpdated]);

  // Debounced flush function - automatically saves pending updates after user stops dragging
  const debouncedFlushPendingUpdates = useCallback(() => {
    // Clear existing timer
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
    }

    // Set new timer - flush after 750ms of inactivity
    flushTimerRef.current = setTimeout(() => {
      flushPendingUpdates();
      flushTimerRef.current = null;
    }, 750);
  }, [flushPendingUpdates]);

  // Tab visibility change listener - flush pending updates when user switches tabs
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // User switched away - flush pending updates immediately
        // Clear any pending debounce timer since we're flushing now
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
          flushTimerRef.current = null;
        }
        flushPendingUpdates();
      }
    };

    const handleBeforeUnload = () => {
      // Page is about to close - try to flush pending updates synchronously
      // Clear any pending debounce timer since we're flushing now
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      if (pendingDragUpdatesRef.current.size > 0) {
        flushPendingUpdates();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // Clear debounce timer on unmount
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      // Flush on unmount as well
      if (pendingDragUpdatesRef.current.size > 0) {
        flushPendingUpdates();
      }
    };
  }, [flushPendingUpdates]);

  // Get today's date string in YYYY-MM-DD format
  const getTodayString = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Filter by search query
  const filterBySearch = (appointment: AppointmentCardData): boolean => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    const homeownerName = appointment.homeowner
      ? `${appointment.homeowner.first_name} ${appointment.homeowner.last_name}`.toLowerCase()
      : "";
    const cleanerName = appointment.cleaner_profile?.user_profile
      ? `${appointment.cleaner_profile.user_profile.first_name} ${appointment.cleaner_profile.user_profile.last_name}`.toLowerCase()
      : "";
    const propertyAddress = appointment.property
      ? `${appointment.property.address} ${appointment.property.city} ${appointment.property.state}`.toLowerCase()
      : "";
    const serviceName = appointment.service_type?.name.toLowerCase() || "";
    const checklistName = appointment.checklist?.name.toLowerCase() || "";

    return (
      homeownerName.includes(query) ||
      cleanerName.includes(query) ||
      propertyAddress.includes(query) ||
      serviceName.includes(query) ||
      checklistName.includes(query)
    );
  };

  // Filter by status
  const filterByStatus = (appointment: AppointmentCardData): boolean => {
    if (statusFilter === "all") return true;
    return appointment.status === statusFilter;
  };

  // Get filtered active appointments (in_progress)
  const filteredActiveAppointments = useMemo(() => {
    return localAppointments
      .filter(
        (apt) =>
          apt.status === "in_progress" &&
          filterBySearch(apt) &&
          filterByStatus(apt),
      )
      .sort((a, b) => {
        const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
        if (dateCompare !== 0) return dateCompare;
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localAppointments, searchQuery, statusFilter]);

  // Get filtered today's appointments (in progress only under Active Cleanings)
  const filteredTodaysAppointments = useMemo(() => {
    const today = getTodayString();
    return localAppointments
      .filter(
        (apt) =>
          apt.scheduled_date === today &&
          apt.status !== "in_progress" &&
          filterBySearch(apt) &&
          filterByStatus(apt),
      )
      .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localAppointments, searchQuery, statusFilter]);

  // Get filtered upcoming appointments within time frame
  const filteredUpcomingAppointments = useMemo(() => {
    const today = getTodayString();
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    // Calculate end date based on filter
    const endDate = new Date(todayDate);
    if (upcomingDaysFilter !== -1) {
      endDate.setDate(endDate.getDate() + upcomingDaysFilter);
    }

    return localAppointments
      .filter((apt) => {
        // Must be after today
        if (apt.scheduled_date <= today) return false;

        // Check time frame filter (if not "All")
        if (upcomingDaysFilter !== -1) {
          const [year, month, day] = apt.scheduled_date.split("-").map(Number);
          const aptDate = new Date(year, month - 1, day);
          if (aptDate > endDate) return false;
        }

        // Must not be completed/cancelled for upcoming view
        if (apt.status === "completed" || apt.status === "cancelled")
          return false;

        return filterBySearch(apt) && filterByStatus(apt);
      })
      .sort((a, b) => {
        const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
        if (dateCompare !== 0) return dateCompare;
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localAppointments, searchQuery, statusFilter, upcomingDaysFilter]);

  // Get filtered past appointments
  const filteredPastAppointments = useMemo(() => {
    const today = getTodayString();

    return localAppointments
      .filter((apt) => {
        // Must be before today OR completed/cancelled
        if (apt.scheduled_date >= today) {
          if (apt.status !== "completed" && apt.status !== "cancelled") {
            return false;
          }
        }

        return filterBySearch(apt) && filterByStatus(apt);
      })
      .sort((a, b) => {
        // Reverse chronological (most recent first)
        const dateCompare = b.scheduled_date.localeCompare(a.scheduled_date);
        if (dateCompare !== 0) return dateCompare;
        return b.scheduled_time.localeCompare(a.scheduled_time);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localAppointments, searchQuery, statusFilter]);

  // Get filtered all appointments
  const filteredAllAppointments = useMemo(() => {
    return localAppointments
      .filter((apt) => filterBySearch(apt) && filterByStatus(apt))
      .sort((a, b) => {
        // Chronological (oldest to newest)
        const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
        if (dateCompare !== 0) return dateCompare;
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localAppointments, searchQuery, statusFilter]);

  // Combined appointments for selection and calendar view (used by calendar view)
  const allFilteredAppointments = useMemo(() => {
    return [
      ...filteredActiveAppointments,
      ...filteredTodaysAppointments,
      ...filteredUpcomingAppointments,
      ...filteredPastAppointments,
    ];
  }, [
    filteredActiveAppointments,
    filteredTodaysAppointments,
    filteredUpcomingAppointments,
    filteredPastAppointments,
  ]);

  // Appointments currently displayed in the list view (depends on active tab) — used for Select All
  const displayedAppointmentsForTab = useMemo(() => {
    if (appointmentsTab === "upcoming") return filteredUpcomingAppointments;
    if (appointmentsTab === "past") return filteredPastAppointments;
    return filteredAllAppointments;
  }, [
    appointmentsTab,
    filteredUpcomingAppointments,
    filteredPastAppointments,
    filteredAllAppointments,
  ]);

  // Get unique statuses for filter dropdown
  const availableStatuses = useMemo(() => {
    const statuses = new Set(localAppointments.map((apt) => apt.status));
    return Array.from(statuses);
  }, [localAppointments]);

  // Time frame filter options
  const timeFrameOptions = [
    { value: 7, label: "7 Days" },
    { value: 14, label: "14 Days" },
    { value: 30, label: "30 Days" },
    { value: 60, label: "60 Days" },
    { value: 90, label: "90 Days" },
    { value: -1, label: "All" },
  ];

  // Handle appointment card click — defers to the dashboard-level panel host.
  const handleAppointmentClick = (appointment: AppointmentCardData) => {
    onOpenAppointment(appointment.id);
  };

  // Selection handlers
  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
    setSelectedIds(new Set());
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === displayedAppointmentsForTab.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayedAppointmentsForTab.map((apt) => apt.id)));
    }
  };

  const handleBulkCancel = () => {
    selectedIdsForBulkRef.current = new Set(selectedIds);
    setBulkAction("cancel");
    setShowBulkModal(true);
  };

  const handleBulkDelete = () => {
    selectedIdsForBulkRef.current = new Set(selectedIds);
    setBulkAction("delete");
    setShowBulkModal(true);
  };

  const confirmBulkAction = async () => {
    const idsToProcess = Array.from(selectedIdsForBulkRef.current);
    if (idsToProcess.length === 0) {
      setShowBulkModal(false);
      return;
    }

    setIsBulkActionLoading(true);
    try {
      if (bulkAction === "cancel") {
        if (onBulkCancelAppointments) {
          await onBulkCancelAppointments(idsToProcess);
        } else {
          // Defensive fallback: sequential, never a concurrent fan-out.
          for (const id of idsToProcess) {
            await onCancelAppointment(id);
          }
        }
      } else {
        if (onBulkDeleteAppointments) {
          await onBulkDeleteAppointments(idsToProcess);
        } else {
          for (const id of idsToProcess) {
            await onDeleteAppointment(id);
          }
        }
      }
      setSelectedIds(new Set());
      setIsSelectMode(false);
      setShowBulkModal(false);
    } finally {
      setIsBulkActionLoading(false);
    }
  };

  // Calendar handlers
  const handleCalendarAppointmentClick = useCallback(
    (appointment: AppointmentCardData) => {
      onOpenAppointment(appointment.id);
    },
    [onOpenAppointment],
  );

  const handleDayClick = useCallback(
    (date: Date, appointments: AppointmentCardData[]) => {
      setSelectedDate(date);
      setDayAppointments(appointments);
      setShowDayDetailSidebar(true);
    },
    [],
  );

  const handleSlotSelect = useCallback(
    (date: Date, time: string) => {
      // Pre-fill date and time for quick add
      setPreFilledDate(format(date, "yyyy-MM-dd"));
      setPreFilledTime(time);
      setShowAddAppointmentModal(true);
      openAddApptUrl();
    },
    [openAddApptUrl],
  );

  // After a card-hold failure in the booking wizard, jump to the appointment drawer to fix the card.
  // This is ONE navigation that drops the `?modal=add-appointment` marker and sets `?appointment=`
  // in the same push — using the panel hook's openAppointment alone would keep the modal marker and
  // reopen a blank wizard behind the drawer. Also clears the state-driven open.
  const openAppointmentFromModal = useCallback(
    (id: string) => {
      setShowAddAppointmentModal(false);
      setPreFilledDate(undefined);
      setPreFilledTime(undefined);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("modal");
      params.set("appointment", id);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Immediate DB reschedule (legacy fallback)
  const handleReschedule = useCallback(
    async (appointmentId: string, newDate: string, newTime: string) => {
      const result = await updateAppointment(appointmentId, {
        scheduled_date: newDate,
        scheduled_time: newTime,
      });

      if (result.success) {
        // Update the appointment in state
        if (onAppointmentUpdated && result.data) {
          onAppointmentUpdated(appointmentId, result.data);
        } else if (onRefreshAppointments) {
          onRefreshAppointments();
        }
      } else {
        alert("Failed to reschedule appointment: " + result.error);
      }
    },
    [onAppointmentUpdated, onRefreshAppointments],
  );

  // Local reschedule handler for deferred DB sync
  const handleLocalReschedule = useCallback(
    (
      appointmentId: string,
      newDate: string,
      newTime: string,
      originalDate: string,
      originalTime: string,
    ) => {
      // Update local appointments state immediately (optimistic update)
      setLocalAppointments((prev) =>
        prev.map((apt) =>
          apt.id === appointmentId
            ? { ...apt, scheduled_date: newDate, scheduled_time: newTime }
            : apt,
        ),
      );

      // Add to pending updates for later DB sync
      setPendingDragUpdates((prev) => {
        const newMap = new Map(prev);
        newMap.set(appointmentId, {
          appointmentId,
          newDate,
          newTime,
          originalDate,
          originalTime,
        });
        return newMap;
      });

      // Trigger debounced flush - will save to DB after 750ms of inactivity
      debouncedFlushPendingUpdates();
    },
    [debouncedFlushPendingUpdates],
  );

  const handleDayDetailAppointmentClick = useCallback(
    (appointment: AppointmentCardData) => {
      setShowDayDetailSidebar(false);
      onOpenAppointment(appointment.id);
    },
    [onOpenAppointment],
  );

  const handleDayDetailAddAppointment = useCallback(() => {
    if (selectedDate) {
      setPreFilledDate(format(selectedDate, "yyyy-MM-dd"));
      setPreFilledTime(undefined); // Will use default time
      setShowDayDetailSidebar(false);
      setShowAddAppointmentModal(true);
      openAddApptUrl();
    }
  }, [selectedDate, openAddApptUrl]);

  const handleOpenAddAppointmentModal = useCallback(() => {
    // Clear pre-filled values when opening normally
    setPreFilledDate(undefined);
    setPreFilledTime(undefined);
    setShowAddAppointmentModal(true);
    openAddApptUrl();
  }, [openAddApptUrl]);

  // Check if all displayed (current tab) are selected
  const isAllSelected =
    displayedAppointmentsForTab.length > 0 &&
    selectedIds.size === displayedAppointmentsForTab.length;
  const isSomeSelected = selectedIds.size > 0 && !isAllSelected;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-4xl font-bold text-gray-900">Bookings</h2>
        <div className="flex items-center gap-3">
          {/* View Toggle Buttons */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewType("list")}
              className={`p-2 rounded-md transition-colors ${
                viewType === "list"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              title="List View"
            >
              <List className="w-5 h-5" />
            </button>
            <button
              onClick={() => setViewType("calendar")}
              className={`p-2 rounded-md transition-colors ${
                viewType === "calendar"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
              title="Calendar View"
            >
              <CalendarDays className="w-5 h-5" />
            </button>
          </div>
          {/* Add New Appointment Button. Admin/manager move this into the top
              nav bar (showCreateButton=false); homeowner/other callers keep it. */}
          {canEdit && showCreateButton && (
            <button
              onClick={handleOpenAddAppointmentModal}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors whitespace-nowrap shadow-md"
            >
              <Plus className="w-5 h-5" />
              <span>New</span>
            </button>
          )}
        </div>
      </div>

      {/* Search Input - Own line on mobile */}
      <div className="flex-1 relative md:hidden">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search by homeowner, cleaner, property, or service..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
        />
      </div>

      {/* Filters Row */}
      <div className="flex flex-row gap-3 overflow-x-auto">
        {/* Search Input - Desktop only (in same line as filters) */}
        <div className="hidden md:flex flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by homeowner, cleaner, property, or service..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
          />
        </div>

        {/* Status Filter Dropdown */}
        {availableStatuses.length > 0 && (
          <div className="relative flex-shrink-0 min-w-[140px]">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm appearance-none"
            >
              <option value="all">All Statuses</option>
              {availableStatuses.map((status) => (
                <option key={status} value={status}>
                  {status.charAt(0).toUpperCase() +
                    status.slice(1).replace("_", " ")}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}

        {/* Select Many Button - Only show if can edit */}
        {canEdit && (
          <button
            onClick={toggleSelectMode}
            className={`px-4 py-2.5 rounded-full font-medium transition-colors whitespace-nowrap border border-gray-300 flex-shrink-0 ${
              isSelectMode
                ? "bg-gray-600 text-white hover:bg-gray-700 border-gray-600"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {isSelectMode ? "Cancel Selection" : "Select Many"}
          </button>
        )}
      </div>

      {/* List View Content */}
      {viewType === "list" && (
        <>
          {/* Bulk Action Bar */}
          {isSelectMode && (
            <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  {/* Select All Checkbox */}
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    {isAllSelected ? (
                      <CheckSquare className="w-5 h-5 text-primary-600" />
                    ) : isSomeSelected ? (
                      <div className="w-5 h-5 border-2 border-primary-600 rounded bg-primary-100 flex items-center justify-center">
                        <div className="w-2.5 h-0.5 bg-primary-600" />
                      </div>
                    ) : (
                      <Square className="w-5 h-5 text-gray-400" />
                    )}
                    <span className="font-medium text-gray-700">
                      {isAllSelected ? "Deselect All" : "Select All"}
                    </span>
                  </button>

                  <span className="text-sm text-gray-600">
                    {selectedIds.size} appointment
                    {selectedIds.size !== 1 ? "s" : ""} selected
                  </span>
                </div>

                {/* Bulk Actions */}
                {selectedIds.size > 0 && (
                  <div className="flex gap-2">
                    {/* Cancel Selected */}
                    {canEdit && (
                      <button
                        onClick={handleBulkCancel}
                        className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-medium"
                      >
                        <XCircle className="w-4 h-4" />
                        Cancel Selected
                      </button>
                    )}

                    {/* Delete Selected */}
                    {canEdit && (
                      <button
                        onClick={handleBulkDelete}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete Selected
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Appointments Sections */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-600">
                Loading appointments...
              </span>
            </div>
          ) : (
            <div className="space-y-8">
              {/* The Action Center lives on the Overview now (single home). On
                  the Bookings tab we show a slim banner that points to it. */}
              {(role === "admin" || role === "manager") &&
                (actionCount ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={onGoToActionCenter}
                    className="w-full flex items-center justify-between gap-3 rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 text-left hover:bg-primary-100 transition-colors"
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <span className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary-100 text-primary-700 shrink-0">
                        <Bell className="w-5 h-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-gray-900">
                          {actionCount} {actionCount === 1 ? "item needs" : "items need"} your attention
                        </span>
                        <span className="block text-xs text-gray-600">
                          Handle them in the Action Center on the Overview.
                        </span>
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-sm font-semibold text-primary-700 shrink-0">
                      <span className="hidden sm:inline">Go to Overview</span>
                      <ChevronRight className="w-4 h-4" />
                    </span>
                  </button>
                )}

              {/* Active Cleanings Section - always expanded on Bookings */}
              {filteredActiveAppointments.length > 0 && (
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <SprayCan className="w-5 h-5 text-primary-600" />
                    Active Cleanings
                    <span className="text-sm font-normal text-gray-500">
                      ({filteredActiveAppointments.length})
                    </span>
                  </h3>
                  <div className="space-y-4">
                    {filteredActiveAppointments.map((appointment) => (
                      <AppointmentCard
                        key={appointment.id}
                        appointment={appointment}
                        onClick={() => handleAppointmentClick(appointment)}
                        isSelectMode={isSelectMode}
                        isSelected={selectedIds.has(appointment.id)}
                        onToggleSelect={() => toggleSelection(appointment.id)}
                        role={role}
                        canApproveDecline={canApproveDecline}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Today's Appointments Section */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary-600" />
                  Today&apos;s Appointments
                  <span className="text-sm font-normal text-gray-500">
                    ({filteredTodaysAppointments.length})
                  </span>
                </h3>
                {filteredTodaysAppointments.length > 0 ? (
                  <div className="space-y-4">
                    {filteredTodaysAppointments.map((appointment) => (
                      <AppointmentCard
                        key={appointment.id}
                        appointment={appointment}
                        onClick={() => handleAppointmentClick(appointment)}
                        isSelectMode={isSelectMode}
                        isSelected={selectedIds.has(appointment.id)}
                        onToggleSelect={() => toggleSelection(appointment.id)}
                        role={role}
                        canApproveDecline={canApproveDecline}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
                    <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600">
                      No appointments scheduled for today
                    </p>
                  </div>
                )}
              </div>

              {/* Appointments Tabs Section */}
              <div>
                {/* Tabs */}
                <div className="flex gap-2 border-b border-gray-200 mb-4">
                  <button
                    onClick={() => setAppointmentsTab("upcoming")}
                    className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                      appointmentsTab === "upcoming"
                        ? "border-primary-600 text-primary-600"
                        : "border-transparent text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    Upcoming
                    <span className="ml-2 text-gray-500 font-normal">
                      ({filteredUpcomingAppointments.length})
                    </span>
                  </button>
                  <button
                    onClick={() => setAppointmentsTab("past")}
                    className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                      appointmentsTab === "past"
                        ? "border-primary-600 text-primary-600"
                        : "border-transparent text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    Past
                    <span className="ml-2 text-gray-500 font-normal">
                      ({filteredPastAppointments.length})
                    </span>
                  </button>
                  <button
                    onClick={() => setAppointmentsTab("all")}
                    className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                      appointmentsTab === "all"
                        ? "border-primary-600 text-primary-600"
                        : "border-transparent text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    All
                    <span className="ml-2 text-gray-500 font-normal">
                      ({filteredAllAppointments.length})
                    </span>
                  </button>
                </div>

                {/* Tab Content */}
                {appointmentsTab === "upcoming" && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                        <MapPin className="w-5 h-5 text-primary-600" />
                        Upcoming Appointments
                      </h3>
                      {/* Time Frame Filter */}
                      <div className="relative flex-shrink-0 min-w-[120px]">
                        <select
                          value={upcomingDaysFilter}
                          onChange={(e) =>
                            setUpcomingDaysFilter(Number(e.target.value))
                          }
                          className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm appearance-none"
                        >
                          {timeFrameOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                      </div>
                    </div>
                    {filteredUpcomingAppointments.length > 0 ? (
                      <div className="space-y-4">
                        {filteredUpcomingAppointments.map((appointment) => (
                          <AppointmentCard
                            key={appointment.id}
                            appointment={appointment}
                            onClick={() => handleAppointmentClick(appointment)}
                            isSelectMode={isSelectMode}
                            isSelected={selectedIds.has(appointment.id)}
                            onToggleSelect={() =>
                              toggleSelection(appointment.id)
                            }
                            role={role}
                            canApproveDecline={canApproveDecline}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
                        <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-600">
                          No upcoming appointments
                          {upcomingDaysFilter !== -1
                            ? ` in the next ${upcomingDaysFilter} days`
                            : ""}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {appointmentsTab === "past" && (
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
                      <History className="w-5 h-5 text-primary-600" />
                      Past Appointments
                    </h3>
                    {filteredPastAppointments.length > 0 ? (
                      <div className="space-y-4">
                        {filteredPastAppointments.map((appointment) => (
                          <AppointmentCard
                            key={appointment.id}
                            appointment={appointment}
                            onClick={() => handleAppointmentClick(appointment)}
                            isSelectMode={isSelectMode}
                            isSelected={selectedIds.has(appointment.id)}
                            onToggleSelect={() =>
                              toggleSelection(appointment.id)
                            }
                            role={role}
                            canApproveDecline={canApproveDecline}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
                        <History className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-600">No past appointments</p>
                      </div>
                    )}
                  </div>
                )}

                {appointmentsTab === "all" && (
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
                      <Calendar className="w-5 h-5 text-primary-600" />
                      All Appointments
                    </h3>
                    {filteredAllAppointments.length > 0 ? (
                      <div className="space-y-4">
                        {filteredAllAppointments.map((appointment) => (
                          <AppointmentCard
                            key={appointment.id}
                            appointment={appointment}
                            onClick={() => handleAppointmentClick(appointment)}
                            isSelectMode={isSelectMode}
                            isSelected={selectedIds.has(appointment.id)}
                            onToggleSelect={() =>
                              toggleSelection(appointment.id)
                            }
                            role={role}
                            canApproveDecline={canApproveDecline}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 bg-white rounded-xl border border-gray-200">
                        <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-600">No appointments found</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Calendar View Content (new scheduling cockpit; drag/reassign wired in later phases) */}
      {viewType === "calendar" && (
        <CalendarCockpit
          appointments={allFilteredAppointments}
          loading={loading}
          onAppointmentClick={handleCalendarAppointmentClick}
          canEdit={canEdit}
          role={role}
        />
      )}

      {/* Day Detail Sidebar (for calendar view) */}
      <DayDetailSidebar
        isOpen={showDayDetailSidebar}
        onClose={() => setShowDayDetailSidebar(false)}
        selectedDate={selectedDate}
        appointments={dayAppointments}
        onAppointmentClick={handleDayDetailAppointmentClick}
        onAddAppointment={handleDayDetailAddAppointment}
        canEdit={canEdit}
      />

      {/* Bulk Action Confirmation Modal */}
      <BulkActionConfirmModal
        isOpen={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        onConfirm={confirmBulkAction}
        count={selectedIds.size}
        action={bulkAction}
        isLoading={isBulkActionLoading}
      />

      {/* Add Appointment Modal */}
      <AddAppointmentModal
        isOpen={showAddAppointmentModal || addApptOpenFromUrl}
        onClose={() => {
          setShowAddAppointmentModal(false);
          setPreFilledDate(undefined);
          setPreFilledTime(undefined);
          closeAddApptUrl();
        }}
        onAppointmentCreated={() => {
          if (onRefreshAppointments) {
            onRefreshAppointments();
          }
        }}
        preFilledDate={preFilledDate}
        preFilledTime={preFilledTime}
        onOpenAppointment={openAppointmentFromModal}
      />
    </div>
  );
}
