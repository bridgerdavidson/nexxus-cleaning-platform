"use client";

import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import {
  SprayCan,
  Calendar,
  MapPin,
  MessageCircle,
  DollarSign,
  Clock,
  CheckCircle,
  Star,
  Loader2,
  Home,
  Search,
  List,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ArrowLeft,
  History,
  Briefcase,
  User,
  AlertCircle,
  TrendingUp,
  Wallet,
  Landmark,
  ArrowDownToLine,
} from "lucide-react";
import {
  useCleanerAppointments,
  useCleanerStats,
  useCleanerPayouts,
  useCleanerProjectedEarnings,
  useCleanerStripeSummary,
  useCleanerEarningsHistory,
  updateAppointmentStatus,
} from "../../hooks/useCleanerData";
import { useConversations } from "../../hooks/useConversations";
import { useServices } from "../../hooks/useServices";
import { formatDateTimeTo12h, formatTimeTo12h } from "../../lib/formatTime";
import {
  DASHBOARD_HERO_BACKGROUND,
  dashboardHeroCardDesktopClass,
  dashboardHeroCardMobileClass,
} from "../../lib/dashboardHero";
import TopBar from "../../components/TopBar";
import MobileNavigation from "../../components/MobileNavigation";
import MobileSidebar from "../../components/MobileSidebar";
import DesktopSidebar from "../../components/DesktopSidebar";
import MessagesPage from "../../components/MessagesPage";
import AppointmentCard, {
  AppointmentCardData,
} from "../../components/AppointmentCard";
import AppointmentSidePanel from "../../components/AppointmentSidePanel";
import CalendarView from "../../components/CalendarView";
import DayDetailSidebar from "../../components/DayDetailSidebar";
import StatusBadge from "../../components/StatusBadge";
import ServicesPage from "../../components/ServicesPage";
import ActiveJobPage from "../../components/ActiveJobPage";
import SettingsHub from "../../components/SettingsHub";
import PendingConfirmationsSection from "../../components/PendingConfirmationsSection";
import { format, startOfWeek, endOfWeek } from "date-fns";
import StripeConnectionCard from "../../components/StripeConnectionCard";
import {
  CLEANER_DASHBOARD_TAB_IDS,
  usePersistedDashboardTab,
} from "../../hooks/usePersistedDashboardTab";

type ViewType = "list" | "calendar";

type EarningsRangePreset = {
  label: string;
  get: () => { start: string; end: string };
};

/** Module scope so earnings UI can use stable preset list; `get()` is evaluated when matching. */
const EARNINGS_RANGE_PRESETS: EarningsRangePreset[] = [
  {
    label: "This Week",
    get: () => {
      const now = new Date();
      return {
        start: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        end: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      };
    },
  },
  {
    label: "Last Week",
    get: () => {
      const now = new Date();
      const lastWeek = new Date(now);
      lastWeek.setDate(now.getDate() - 7);
      return {
        start: format(startOfWeek(lastWeek, { weekStartsOn: 1 }), "yyyy-MM-dd"),
        end: format(endOfWeek(lastWeek, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      };
    },
  },
  {
    label: "This Month",
    get: () => {
      const now = new Date();
      return {
        start: format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd"),
        end: format(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd"),
      };
    },
  },
  {
    label: "Last 30 Days",
    get: () => {
      const now = new Date();
      const past = new Date(now);
      past.setDate(now.getDate() - 30);
      return {
        start: format(past, "yyyy-MM-dd"),
        end: format(now, "yyyy-MM-dd"),
      };
    },
  },
  {
    label: "Last 90 Days",
    get: () => {
      const now = new Date();
      const past = new Date(now);
      past.setDate(now.getDate() - 90);
      return {
        start: format(past, "yyyy-MM-dd"),
        end: format(now, "yyyy-MM-dd"),
      };
    },
  },
  {
    label: "All Time",
    get: () => ({
      start: "2020-01-01",
      end: format(new Date(), "yyyy-MM-dd"),
    }),
  },
];

/** Future-only windows for Projected Earnings (today through end of range). */
const PROJECTED_EARNINGS_PRESETS: EarningsRangePreset[] = [
  {
    label: "This Week",
    get: () => {
      const now = new Date();
      const today = format(now, "yyyy-MM-dd");
      const weekEnd = format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");
      return { start: today, end: weekEnd };
    },
  },
  {
    label: "Next 7 Days",
    get: () => {
      const now = new Date();
      const end = new Date(now);
      end.setDate(now.getDate() + 6);
      return { start: format(now, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
    },
  },
  {
    label: "Next 30 Days",
    get: () => {
      const now = new Date();
      const end = new Date(now);
      end.setDate(now.getDate() + 29);
      return { start: format(now, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
    },
  },
  {
    label: "This Month",
    get: () => {
      const now = new Date();
      const today = format(now, "yyyy-MM-dd");
      const monthEnd = format(
        new Date(now.getFullYear(), now.getMonth() + 1, 0),
        "yyyy-MM-dd"
      );
      return { start: today, end: monthEnd };
    },
  },
  {
    label: "Next Month",
    get: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 2, 0);
      return { start: format(first, "yyyy-MM-dd"), end: format(last, "yyyy-MM-dd") };
    },
  },
];

function CleanerDashboardInner() {
  const { user, loading, signOut, currentOrganizationId } = useAuth();
  const [activeTab, setActiveTab] = usePersistedDashboardTab(
    "home",
    CLEANER_DASHBOARD_TAB_IDS
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [expandedActive, setExpandedActive] = useState(true);
  const [expandedToday, setExpandedToday] = useState(true);
  const [expandedUpcoming, setExpandedUpcoming] = useState(true);
  const router = useRouter();

  // Active job view state - when non-null, shows ActiveJobPage for that appointment
  const [activeJobView, setActiveJobView] = useState<string | null>(null);

  // Jobs tab state
  const [viewType, setViewType] = useState<ViewType>("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [upcomingDaysFilter, setUpcomingDaysFilter] = useState<number>(30);
  const [jobsTab, setJobsTab] = useState<"upcoming" | "past" | "all">("upcoming");
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentCardData | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [showDayDetailSidebar, setShowDayDetailSidebar] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [dayAppointments, setDayAppointments] = useState<AppointmentCardData[]>(
    []
  );

  // Real data hooks - must be called at top level
  // These hooks handle currentOrganizationId internally, but we need to ensure it's available
  const {
    appointments,
    loading: appointmentsLoading,
    error: appointmentsError,
  } = useCleanerAppointments();
  const { stats, loading: statsLoading, error: statsError } = useCleanerStats();
  const {
    conversations,
    loading: conversationsLoading,
    error: conversationsError,
    refetch: refetchConversations,
    updateUnreadCount,
  } = useConversations({ userId: user?.id || "" });
  const {
    payouts,
    loading: payoutsLoading,
  } = useCleanerPayouts();

  // Projected earnings period — dropdown-driven, defaults to "This Week"
  const [projectedPreset, setProjectedPreset] = useState("This Week");
  const projectedRange = useMemo(() => {
    const match = PROJECTED_EARNINGS_PRESETS.find((p) => p.label === projectedPreset);
    return match ? match.get() : PROJECTED_EARNINGS_PRESETS[0].get();
  }, [projectedPreset]);

  // Payout history date range — defaults to current week (Mon–Sun)
  const [historyRange, setHistoryRange] = useState(() => {
    const now = new Date();
    return {
      start: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      end: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  });

  // Independent hooks — each section loads/refreshes on its own
  const {
    projectedEarnings,
    loading: projectedLoading,
    error: projectedError,
  } = useCleanerProjectedEarnings(projectedRange.start, projectedRange.end);

  const {
    inStripe,
    latestBankPayoutAmount,
    latestBankPayoutDate,
    loading: stripeLoading,
    error: stripeError,
  } = useCleanerStripeSummary();

  const {
    payoutHistory,
    loading: historyLoading,
    error: historyError,
  } = useCleanerEarningsHistory(historyRange.start, historyRange.end);

  const activeHistoryPresetLabel = useMemo(() => {
    const match = EARNINGS_RANGE_PRESETS.find((p) => {
      const r = p.get();
      return r.start === historyRange.start && r.end === historyRange.end;
    });
    return match?.label ?? "Custom";
  }, [historyRange]);

  const {
    services,
    loading: servicesLoading,
    error: servicesError,
    refetch: refetchServices,
    updateServiceInState,
    maxChecklistAdderByServiceId,
    refreshMaxChecklistAdders,
  } = useServices();

  // Calculate if there are any unread messages
  const hasUnreadMessages = useMemo(() => {
    return conversations.some((conv) => conv.unread_count > 0);
  }, [conversations]);

  const sidebarTabs = useMemo(
    () => [
      { id: "home", label: "Overview", icon: Home },
      { id: "jobs", label: "Jobs", icon: MapPin },
      { id: "services", label: "Services", icon: Briefcase },
      { id: "earnings", label: "Earnings", icon: DollarSign },
    ],
    []
  );

  // Tabs for mobile sidebar
  const allTabs = [
    ...sidebarTabs,
    {
      id: "messages",
      label: "Messages",
      icon: MessageCircle,
      hasNotification: hasUnreadMessages,
    },
  ];
  if (!allTabs.find((t) => t.id === "settings")) {
    allTabs.push({ id: "settings", label: "Settings", icon: User });
  }

  const handleLogout = async () => {
    await signOut();
  };

  // Mobile navigation tabs (keep it simple for bottom bar — most-used tabs)
  const mobileNavTabs = [
    { id: "home", label: "Overview", icon: Home },
    { id: "jobs", label: "Jobs", icon: MapPin },
    {
      id: "messages",
      label: "Messages",
      icon: MessageCircle,
      hasNotification: hasUnreadMessages,
    },
    { id: "earnings", label: "Earnings", icon: DollarSign },
  ];

  // Helper function for converting appointments (must be defined before hooks)
  const convertToCardData = (appointment: any): AppointmentCardData => ({
    ...appointment,
    special_requests: appointment.special_requests || null,
    notes: null,
    series_id: null,
    cleaner_profile: null,
  });

  // Get filtered today's jobs
  const filteredTodaysJobs = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;

    const query = searchQuery.toLowerCase();

    return appointments
      .filter((apt) => {
        // Must be today
        if (apt.scheduled_date !== today) return false;

        // In progress are listed only under Active Cleanings
        if (apt.status === "in_progress") return false;

        // Filter by status
        if (statusFilter !== "all" && apt.status !== statusFilter) return false;

        // Filter by search query
        if (query) {
          const homeownerName = apt.homeowner
            ? `${apt.homeowner.first_name} ${apt.homeowner.last_name}`.toLowerCase()
            : "";
          const propertyAddress = apt.property
            ? `${apt.property.address} ${apt.property.city} ${apt.property.state}`.toLowerCase()
            : "";
          const serviceName = apt.service_type?.name.toLowerCase() || "";

          if (
            !homeownerName.includes(query) &&
            !propertyAddress.includes(query) &&
            !serviceName.includes(query)
          ) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
  }, [appointments, searchQuery, statusFilter]);

  // Active jobs (in_progress) - shown in Active Cleanings section
  const activeJobs = useMemo(
    () => appointments.filter((a) => a.status === "in_progress"),
    [appointments]
  );

  // Pending confirmation appointments - awaiting cleaner response
  const pendingConfirmations = useMemo(
    () =>
      appointments
        .filter(
          (apt) =>
            apt.cleaner_confirmation_status === 'awaiting' &&
            apt.status !== "cancelled" &&
            apt.status !== "completed"
        )
        .sort((a, b) => {
          const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
          if (dateCompare !== 0) return dateCompare;
          return a.scheduled_time.localeCompare(b.scheduled_time);
        }),
    [appointments]
  );

  // Overview-only: today's jobs with no filters (in_progress only under Active Cleanings)
  const overviewTodaysJobs = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;
    return appointments
      .filter(
        (apt) =>
          apt.scheduled_date === today && apt.status !== "in_progress"
      )
      .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
  }, [appointments]);

  // Overview-only: upcoming jobs (after today, no filters) for overview preview
  const overviewUpcomingJobs = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;
    return appointments
      .filter(
        (apt) =>
          apt.scheduled_date > today &&
          apt.status !== "completed" &&
          apt.status !== "cancelled"
      )
      .sort((a, b) => {
        const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
        if (dateCompare !== 0) return dateCompare;
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });
  }, [appointments]);

  // Get filtered upcoming jobs within time frame (includes today)
  const filteredUpcomingJobs = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;

    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);

    // Calculate end date based on filter
    const endDate = new Date(todayDate);
    if (upcomingDaysFilter !== -1) {
      endDate.setDate(endDate.getDate() + upcomingDaysFilter);
    }

    const query = searchQuery.toLowerCase();

    return appointments
      .filter((apt) => {
        // Must be today or after today
        if (apt.scheduled_date < today) return false;

        // Check time frame filter (if not "All")
        if (upcomingDaysFilter !== -1) {
          const [aptYear, aptMonth, aptDay] = apt.scheduled_date
            .split("-")
            .map(Number);
          const aptDate = new Date(aptYear, aptMonth - 1, aptDay);
          if (aptDate > endDate) return false;
        }

        // Must not be completed/cancelled
        if (apt.status === "completed" || apt.status === "cancelled")
          return false;

        // In progress are only listed under Active Cleanings
        if (apt.status === "in_progress") return false;

        // Filter by status
        if (statusFilter !== "all" && apt.status !== statusFilter) return false;

        // Filter by search query
        if (query) {
          const homeownerName = apt.homeowner
            ? `${apt.homeowner.first_name} ${apt.homeowner.last_name}`.toLowerCase()
            : "";
          const propertyAddress = apt.property
            ? `${apt.property.address} ${apt.property.city} ${apt.property.state}`.toLowerCase()
            : "";
          const serviceName = apt.service_type?.name.toLowerCase() || "";

          if (
            !homeownerName.includes(query) &&
            !propertyAddress.includes(query) &&
            !serviceName.includes(query)
          ) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
        if (dateCompare !== 0) return dateCompare;
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });
  }, [appointments, searchQuery, statusFilter, upcomingDaysFilter]);

  // Get filtered past jobs
  const filteredPastJobs = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;

    const query = searchQuery.toLowerCase();

    return appointments
      .filter((apt) => {
        // Must be before today OR completed/cancelled
        if (apt.scheduled_date >= today) {
          if (apt.status !== "completed" && apt.status !== "cancelled") {
            return false;
          }
        }

        // Filter by status
        if (statusFilter !== "all" && apt.status !== statusFilter) return false;

        // Filter by search query
        if (query) {
          const homeownerName = apt.homeowner
            ? `${apt.homeowner.first_name} ${apt.homeowner.last_name}`.toLowerCase()
            : "";
          const propertyAddress = apt.property
            ? `${apt.property.address} ${apt.property.city} ${apt.property.state}`.toLowerCase()
            : "";
          const serviceName = apt.service_type?.name.toLowerCase() || "";

          if (
            !homeownerName.includes(query) &&
            !propertyAddress.includes(query) &&
            !serviceName.includes(query)
          ) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        // Reverse chronological (most recent first)
        const dateCompare = b.scheduled_date.localeCompare(a.scheduled_date);
        if (dateCompare !== 0) return dateCompare;
        return b.scheduled_time.localeCompare(a.scheduled_time);
      });
  }, [appointments, searchQuery, statusFilter]);

  // Get filtered active jobs for Jobs tab (in_progress with search/status filters)
  const filteredActiveJobsForJobsTab = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return appointments
      .filter((apt) => {
        if (apt.status !== "in_progress") return false;
        if (statusFilter !== "all" && apt.status !== statusFilter) return false;
        if (query) {
          const homeownerName = apt.homeowner
            ? `${apt.homeowner.first_name} ${apt.homeowner.last_name}`.toLowerCase()
            : "";
          const propertyAddress = apt.property
            ? `${apt.property.address} ${apt.property.city} ${apt.property.state}`.toLowerCase()
            : "";
          const serviceName = apt.service_type?.name.toLowerCase() || "";
          if (
            !homeownerName.includes(query) &&
            !propertyAddress.includes(query) &&
            !serviceName.includes(query)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
        if (dateCompare !== 0) return dateCompare;
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });
  }, [appointments, searchQuery, statusFilter]);

  // Get filtered all jobs
  const filteredAllJobs = useMemo(() => {
    const query = searchQuery.toLowerCase();

    return appointments
      .filter((apt) => {
        // Filter by status
        if (statusFilter !== "all" && apt.status !== statusFilter) return false;

        // Filter by search query
        if (query) {
          const homeownerName = apt.homeowner
            ? `${apt.homeowner.first_name} ${apt.homeowner.last_name}`.toLowerCase()
            : "";
          const propertyAddress = apt.property
            ? `${apt.property.address} ${apt.property.city} ${apt.property.state}`.toLowerCase()
            : "";
          const serviceName = apt.service_type?.name.toLowerCase() || "";

          if (
            !homeownerName.includes(query) &&
            !propertyAddress.includes(query) &&
            !serviceName.includes(query)
          ) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        // Chronological (oldest to newest)
        const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
        if (dateCompare !== 0) return dateCompare;
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });
  }, [appointments, searchQuery, statusFilter]);

  // Combined appointments for calendar view
  const allFilteredAppointments = useMemo(() => {
    return [
      ...filteredActiveJobsForJobsTab,
      ...filteredTodaysJobs,
      ...filteredUpcomingJobs,
      ...filteredPastJobs,
    ].map(convertToCardData);
  }, [
    filteredActiveJobsForJobsTab,
    filteredTodaysJobs,
    filteredUpcomingJobs,
    filteredPastJobs,
  ]);

  // Get available statuses for filter dropdown
  const availableStatuses = useMemo(() => {
    const statuses = new Set(appointments.map((apt) => apt.status));
    return Array.from(statuses);
  }, [appointments]);

  // Calendar handlers
  const handleCalendarAppointmentClick = useCallback(
    (appointment: AppointmentCardData) => {
      setSelectedAppointment(appointment);
      setShowSidePanel(true);
    },
    []
  );

  const handleDayClick = useCallback(
    (date: Date, appts: AppointmentCardData[]) => {
      setSelectedDate(date);
      setDayAppointments(appts);
      setShowDayDetailSidebar(true);
    },
    []
  );

  const handleSlotSelect = useCallback((date: Date, time: string) => {
    // Cleaners can't create appointments, so this is a no-op
  }, []);

  const handleDayDetailAppointmentClick = useCallback(
    (appointment: AppointmentCardData) => {
      setShowDayDetailSidebar(false);
      setSelectedAppointment(appointment);
      setShowSidePanel(true);
    },
    []
  );

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Scroll to top when tab changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  // Auto-collapse empty sections only after data has loaded; keep expanded when section has items
  useEffect(() => {
    if (!appointmentsLoading) {
      if (activeJobs.length > 0) setExpandedActive(true);
      else setExpandedActive(false);
    }
  }, [appointmentsLoading, activeJobs.length]);
  useEffect(() => {
    if (!appointmentsLoading) {
      if (overviewTodaysJobs.length > 0) setExpandedToday(true);
      else setExpandedToday(false);
    }
  }, [appointmentsLoading, overviewTodaysJobs.length]);
  useEffect(() => {
    if (!appointmentsLoading) {
      if (overviewUpcomingJobs.length > 0) setExpandedUpcoming(true);
      else setExpandedUpcoming(false);
    }
  }, [appointmentsLoading, overviewUpcomingJobs.length]);
  // Show loading while checking auth
  if (loading || !user) {
    return (
      <div className="min-h-screen bg-white md:bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Helper functions
  const getHomeownerName = (appointment: any) => {
    if (appointment.homeowner) {
      const { first_name, last_name } = appointment.homeowner;
      return (
        `${first_name || ""} ${last_name || ""}`.trim() || "Unknown Homeowner"
      );
    }
    return "Unknown Homeowner";
  };

  const getPropertyAddress = (appointment: any) => {
    if (appointment.property) {
      const { address, city, state, zip_code } = appointment.property;
      if (address && city && state) {
        return `${address}, ${city}, ${state}${zip_code ? " " + zip_code : ""}`;
      }
    }
    return "Address not available";
  };

  const getTodaysJobs = () => {
    // Today's scheduled jobs not yet in progress (stats cards use pending/confirmed)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;

    return appointments
      .filter(
        (appointment) =>
          appointment.scheduled_date === today &&
          ["pending", "confirmed"].includes(appointment.status)
      )
      .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
  };

  const getUpcomingJobs = () => {
    // Get today's date in local timezone
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;

    // Return only future jobs (exclude today's jobs)
    return appointments.filter(
      (appointment) =>
        appointment.scheduled_date !== today &&
        ["pending", "confirmed", "in_progress"].includes(appointment.status)
    );
  };

  const formatDate = (dateString: string) => {
    // Parse date as local date (not UTC) to avoid timezone issues
    const [year, month, day] = dateString.split("-").map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleStartJob = async (appointmentId: string) => {
    const result = await updateAppointmentStatus(appointmentId, "in_progress");
    if (result.success) {
      // Navigate to jobs tab and active job view
      setActiveTab("jobs");
      setActiveJobView(appointmentId);
      // Realtime subscription will automatically update the UI
    } else {
      alert("Failed to start job: " + result.error);
    }
  };

  const handleCompleteJob = async (appointmentId: string) => {
    const result = await updateAppointmentStatus(appointmentId, "completed");
    if (result.success) {
      // Realtime subscription will automatically update the UI
      // No need to reload the page
    } else {
      alert("Failed to complete job: " + result.error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "upcoming":
        return "text-primary-600 bg-primary-100";
      case "in_progress":
        return "text-yellow-600 bg-yellow-100";
      case "completed":
        return "text-green-600 bg-green-100";
      case "cancelled":
        return "text-red-600 bg-red-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  // Get border color for status badge (matches StatusBadge component colors)
  const getStatusBorderColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case "pending":
        return "#ca8a04"; // yellow-600
      case "confirmed":
        return "#2563eb"; // blue-600
      case "in_progress":
        return "#9333ea"; // purple-600
      case "completed":
        return "#16a34a"; // green-600
      case "cancelled":
        return "#dc2626"; // red-600
      default:
        return "#6b7280"; // gray-500
    }
  };

  // Handle appointment card click - navigate to jobs tab and open side panel
  const handleTodayScheduleAppointmentClick = (appointment: any) => {
    // If appointment is in_progress, go directly to active job view
    if (appointment.status === "in_progress") {
      setActiveTab("jobs");
      setActiveJobView(appointment.id);
      return;
    }

    setSelectedAppointment(convertToCardData(appointment));
    setActiveTab("jobs");
    // Use setTimeout to ensure tab switch happens before opening panel
    setTimeout(() => {
      setShowSidePanel(true);
    }, 0);
  };

  const renderSchedule = () => (
    <>
      {/* Mobile Header - Gradient Card Match (Mini Desktop) */}
      <div className="md:hidden mb-6 mt-2">
        <div
          className={dashboardHeroCardMobileClass}
          style={DASHBOARD_HERO_BACKGROUND}
        >
          <div className="relative">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-white/80 px-2.5 py-0.5 text-[10px] font-semibold text-primary-700 uppercase tracking-wider">
              <Star className="h-3 w-3" />
              Cleaner Dashboard
            </div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
              Hello, {user?.profile?.firstName || "there"}
            </h2>
            <p className="text-gray-600 mt-1 text-sm font-medium">
              {new Date().toLocaleDateString("en-US", { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
          </div>
        </div>
      </div>

      {/* Desktop Header - Modern control center hero */}
      <div className="hidden md:block mb-6">
        <div
          className={dashboardHeroCardDesktopClass}
          style={DASHBOARD_HERO_BACKGROUND}
        >
          <div className="relative flex flex-col gap-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary-100 bg-white/80 px-3 py-1 text-xs font-semibold text-primary-700">
                  <Star className="h-3.5 w-3.5" />
                  Cleaner Dashboard
                </div>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900">
                  Overview
                </h2>
                <p className="mt-2 max-w-2xl text-sm md:text-base text-gray-600">
                  Manage your cleaning jobs, track your earnings, and stay on top of your schedule.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setActiveTab("jobs")}
                  className="rounded-xl border border-primary-200 bg-white/90 px-4 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50"
                >
                  View all jobs
                </button>
              </div>
            </div>

            {/* Responsive Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="rounded-xl md:rounded-2xl border border-white/80 bg-white/80 px-4 py-3.5 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                  <span className="rounded-lg bg-primary-100 p-1.5 ring-1 ring-primary-200/70">
                    <CheckCircle className="h-4 w-4 text-primary-700" />
                  </span>
                  Total Jobs
                </div>
                {statsLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                ) : (
                  <p className="text-xl md:text-2xl font-bold tracking-tight text-gray-900">
                    {stats.totalJobs}
                  </p>
                )}
              </div>

              <div className="rounded-xl md:rounded-2xl border border-white/80 bg-white/80 px-4 py-3.5 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                  <span className="rounded-lg bg-green-100 p-1.5 ring-1 ring-green-200/70">
                    <Clock className="h-4 w-4 text-green-700" />
                  </span>
                  This Week
                </div>
                {statsLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                ) : (
                  <p className="text-xl md:text-2xl font-bold tracking-tight text-gray-900">
                    {stats.upcomingJobs}
                  </p>
                )}
              </div>

              <div className="rounded-xl md:rounded-2xl border border-white/80 bg-white/80 px-4 py-3.5 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                  <span className="rounded-lg bg-emerald-100 p-1.5 ring-1 ring-emerald-200/70">
                    <DollarSign className="h-4 w-4 text-emerald-700" />
                  </span>
                  <span className="truncate">Confirmed Today</span>
                </div>
                {appointmentsLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                ) : (
                  <p className="text-xl md:text-2xl font-bold tracking-tight text-gray-900">
                    ${getTodaysJobs()
                      .filter((a) => a.status === "confirmed")
                      .reduce((sum, a) => sum + Number(a.total_price), 0)
                      .toFixed(0)}
                  </p>
                )}
              </div>

              <div className="rounded-xl md:rounded-2xl border border-white/80 bg-white/80 px-4 py-3.5 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                  <span className="rounded-lg bg-amber-100 p-1.5 ring-1 ring-amber-200/80">
                    <DollarSign className="h-4 w-4 text-amber-700" />
                  </span>
                  Pending Today
                </div>
                {appointmentsLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                ) : (
                  <p className="text-xl md:text-2xl font-bold tracking-tight text-gray-900">
                    ${getTodaysJobs()
                      .filter((a) => a.status === "pending")
                      .reduce((sum, a) => sum + Number(a.total_price), 0)
                      .toFixed(0)}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Pending Confirmations - Requires cleaner action */}
        <PendingConfirmationsSection
          appointments={pendingConfirmations}
          loading={appointmentsLoading}
          userId={user.id}
          organizationId={currentOrganizationId || ""}
          onConfirmed={() => {
            // Realtime subscription will auto-update the appointments state
            // No manual refetch needed
          }}
        />

        {/* Active Cleanings - collapsible; auto-collapsed when empty */}
        {activeJobs.length > 0 && (
          <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedActive((prev) => !prev)}
              className="w-full flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-gray-50 transition-colors duration-200"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-50 text-gray-600 rounded-xl relative">
                  <SprayCan className="w-5 h-5 relative z-10" />
                  <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500" />
                  </span>
                </div>
                <div className="text-left">
                  <h3 className="text-lg font-bold text-gray-900">Active Cleanings</h3>
                  <span className="text-xs font-medium text-purple-700">
                    {activeJobs.length} in progress
                  </span>
                </div>
              </div>
              <div className="p-2 bg-gray-50 rounded-full transition-colors duration-200">
                {(activeJobs.length > 0 ? expandedActive : false) ? (
                  <ChevronDown className="w-5 h-5 text-gray-500 transition-colors" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-gray-500 transition-colors" />
                )}
              </div>
            </button>
            {(activeJobs.length > 0 ? expandedActive : false) && (
              <div className="border-t border-gray-100 bg-gray-50/60 p-3 sm:p-4">
                <div className="space-y-3">
                  {activeJobs.map((appointment) => (
                    <div key={appointment.id} className="animate-pulse-glow rounded-lg">
                      <AppointmentCard
                        appointment={convertToCardData(appointment)}
                        onClick={() => handleTodayScheduleAppointmentClick(appointment)}
                        role="cleaner"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Today's Jobs - collapsible; auto-collapsed when empty */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandedToday((prev) => !prev)}
            className="w-full flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-gray-50 transition-colors duration-200"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-50 text-primary-600 rounded-xl">
                <Clock className="w-5 h-5" />
              </div>
              <div className="text-left">
                <h3 className="text-lg font-bold text-gray-900">Today&apos;s Jobs</h3>
                <span className="text-xs font-medium text-gray-500">
                  {overviewTodaysJobs.length} scheduled
                </span>
              </div>
            </div>
            <div className="p-2 bg-gray-50 rounded-full transition-colors duration-200">
              {(overviewTodaysJobs.length > 0 || appointmentsLoading ? expandedToday : false) ? (
                <ChevronDown className="w-5 h-5 text-gray-500 transition-colors" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-500 transition-colors" />
              )}
            </div>
          </button>
          {(overviewTodaysJobs.length > 0 || appointmentsLoading ? expandedToday : false) && (
            <div className="border-t border-gray-100 bg-gray-50/60 p-3 sm:p-4">
              {appointmentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-600">Loading schedule...</span>
                </div>
              ) : overviewTodaysJobs.length > 0 ? (
                <div className="space-y-3">
                  {overviewTodaysJobs.map((appointment) => (
                    <AppointmentCard
                      key={appointment.id}
                      appointment={convertToCardData(appointment)}
                      onClick={() => handleTodayScheduleAppointmentClick(appointment)}
                      role="cleaner"
                      onStartJob={handleStartJob}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">No jobs scheduled for today</p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Upcoming Jobs - collapsible; auto-collapsed when empty */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandedUpcoming((prev) => !prev)}
            className="w-full flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-gray-50 transition-colors duration-200"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-50 text-gray-600 rounded-xl">
                <Calendar className="w-5 h-5" />
              </div>
              <div className="text-left">
                <h3 className="text-lg font-bold text-gray-900">Upcoming Jobs</h3>
                <span className="text-xs font-medium text-gray-500">
                  {overviewUpcomingJobs.length} future scheduled
                </span>
              </div>
            </div>
            <div className="p-2 bg-gray-50 rounded-full transition-colors duration-200">
              {(overviewUpcomingJobs.length > 0 || appointmentsLoading ? expandedUpcoming : false) ? (
                <ChevronDown className="w-5 h-5 text-gray-500 transition-colors" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-500 transition-colors" />
              )}
            </div>
          </button>
          {(overviewUpcomingJobs.length > 0 || appointmentsLoading ? expandedUpcoming : false) && (
            <div className="border-t border-gray-100 bg-gray-50/60 p-3 sm:p-4">
              {appointmentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-600">Loading...</span>
                </div>
              ) : overviewUpcomingJobs.length > 0 ? (
                <div className="space-y-3">
                  {overviewUpcomingJobs.slice(0, 3).map((appointment) => (
                    <AppointmentCard
                      key={appointment.id}
                      appointment={convertToCardData(appointment)}
                      onClick={() => handleTodayScheduleAppointmentClick(appointment)}
                      role="cleaner"
                    />
                  ))}
                  {overviewUpcomingJobs.length > 3 && (
                    <button
                      onClick={() => setActiveTab("jobs")}
                      className="w-full text-center py-3 text-sm font-semibold text-primary-700 bg-white hover:bg-primary-50 transition-colors duration-200 rounded-xl border border-primary-100 shadow-sm"
                    >
                      View all ({overviewUpcomingJobs.length})
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">No upcoming jobs</p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );

  // Time frame filter options
  const timeFrameOptions = [
    { value: 7, label: "7 Days" },
    { value: 14, label: "14 Days" },
    { value: 30, label: "30 Days" },
    { value: 60, label: "60 Days" },
    { value: 90, label: "90 Days" },
    { value: -1, label: "All" },
  ];

  const handleAppointmentCardClick = (appointment: any) => {
    // If appointment is in_progress, go directly to active job view
    if (appointment.status === "in_progress") {
      setActiveTab("jobs");
      setActiveJobView(appointment.id);
      return;
    }

    setSelectedAppointment(convertToCardData(appointment));
    setShowSidePanel(true);
  };

  const renderJobs = () => {
    // Get appointment details if in active job view
    const activeAppointment = activeJobView 
      ? appointments.find(a => a.id === activeJobView) 
      : null;

    return (
      <div className="space-y-6">
        {/* Header - Shows either "Jobs" title or breadcrumb */}
        <div className="flex items-center justify-between gap-4">
          {activeJobView && activeAppointment ? (
            <>
              {/* Breadcrumb when viewing active job */}
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => setActiveJobView(null)}
                  className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
                >
                  Jobs
                </button>
                <ChevronLeft className="w-4 h-4 rotate-180 text-gray-400" />
                <span className="text-gray-900 font-medium">
                  {activeAppointment.homeowner
                    ? `${activeAppointment.homeowner.first_name} ${activeAppointment.homeowner.last_name}`
                    : "Unknown"} (
                  {activeAppointment.service_type?.name || "Service"})
                </span>
              </div>
            </>
          ) : (
            // Normal "Jobs" title
            <>
              <h2 className="text-4xl font-bold text-gray-900">Jobs</h2>
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
              </div>
            </>
          )}
        </div>

        {/* Page title with back arrow (when viewing active job) - same pattern as ServiceDetailView */}
        {activeJobView && activeAppointment && (
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex items-start gap-4">
              <button
                onClick={() => setActiveJobView(null)}
                className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
                title="Back to jobs"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h2 className="text-3xl font-bold text-gray-900">
                  {activeAppointment.homeowner
                    ? `${activeAppointment.homeowner.first_name} ${activeAppointment.homeowner.last_name}`
                    : "Unknown"}{" "}
                  ({activeAppointment.service_type?.name || "Service"})
                </h2>
              </div>
            </div>
          </div>
        )}

        {/* If viewing active job, render ActiveJobPage */}
        {activeJobView ? (
          <ActiveJobPage
            appointmentId={activeJobView}
            onExit={() => setActiveJobView(null)}
            onComplete={async () => {
              await handleCompleteJob(activeJobView);
              setActiveJobView(null);
            }}
          />
        ) : (
          <>
            {/* Normal Jobs List Content */}

      {/* Search & Filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        {/* Search Input */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by homeowner, property, or service..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white shadow-sm"
          />
        </div>

        {/* Filters Row */}
        <div className="flex flex-row gap-3 overflow-x-auto pb-1 md:pb-0 scrollbar-hide shrink-0">
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
        </div>
      </div>

      {/* List View Content */}
      {viewType === "list" && (
        <>
          {appointmentsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-600">Loading jobs...</span>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Active Cleanings Section - always expanded on Jobs tab */}
              {filteredActiveJobsForJobsTab.length > 0 && (
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <SprayCan className="w-5 h-5 text-primary-600" />
                    Active Cleanings
                    <span className="text-sm font-normal text-gray-500">
                      ({filteredActiveJobsForJobsTab.length})
                    </span>
                  </h3>
                  <div className="space-y-4">
                    {filteredActiveJobsForJobsTab.map((appointment) => (
                      <div key={appointment.id} className="animate-pulse-glow rounded-lg">
                        <AppointmentCard
                          appointment={convertToCardData(appointment)}
                          onClick={() => handleAppointmentCardClick(appointment)}
                          role="cleaner"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Today's Jobs (in progress excluded — see Active Cleanings) */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary-600" />
                  Today&apos;s Jobs
                  <span className="text-sm font-normal text-gray-500">
                    ({filteredTodaysJobs.length})
                  </span>
                </h3>
                {filteredTodaysJobs.length > 0 ? (
                  <div className="space-y-4">
                    {filteredTodaysJobs.map((appointment) => (
                      <AppointmentCard
                        key={appointment.id}
                        appointment={convertToCardData(appointment)}
                        onClick={() => handleAppointmentCardClick(appointment)}
                        role="cleaner"
                        onStartJob={handleStartJob}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 bg-white rounded-2xl border border-gray-200 shadow-sm">
                    <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                    <p className="text-gray-600">No jobs scheduled for today</p>
                  </div>
                )}
              </div>

              {/* Jobs Tabs Section */}
              <div>
                {/* Tabs */}
                <div className="flex gap-2 border-b border-gray-200 mb-4">
                  <button
                    onClick={() => setJobsTab("upcoming")}
                    className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                      jobsTab === "upcoming"
                        ? "border-primary-600 text-primary-600"
                        : "border-transparent text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    Upcoming
                    <span className="ml-2 text-gray-500 font-normal">
                      ({filteredUpcomingJobs.length})
                    </span>
                  </button>
                  <button
                    onClick={() => setJobsTab("past")}
                    className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                      jobsTab === "past"
                        ? "border-primary-600 text-primary-600"
                        : "border-transparent text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    Past
                    <span className="ml-2 text-gray-500 font-normal">
                      ({filteredPastJobs.length})
                    </span>
                  </button>
                  <button
                    onClick={() => setJobsTab("all")}
                    className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                      jobsTab === "all"
                        ? "border-primary-600 text-primary-600"
                        : "border-transparent text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    All
                    <span className="ml-2 text-gray-500 font-normal">
                      ({filteredAllJobs.length})
                    </span>
                  </button>
                </div>

                {/* Tab Content */}
                {jobsTab === "upcoming" && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-primary-600" />
                        Upcoming Jobs
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
                    {filteredUpcomingJobs.length > 0 ? (
                      <div className="space-y-4">
                        {filteredUpcomingJobs.map((appointment) => (
                          <AppointmentCard
                            key={appointment.id}
                            appointment={convertToCardData(appointment)}
                            onClick={() => handleAppointmentCardClick(appointment)}
                            role="cleaner"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 bg-white rounded-2xl border border-gray-200 shadow-sm">
                        <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-600">
                          No upcoming jobs
                          {upcomingDaysFilter !== -1
                            ? ` in the next ${upcomingDaysFilter} days`
                            : ""}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {jobsTab === "past" && (
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
                      <History className="w-5 h-5 text-primary-600" />
                      Past Jobs
                    </h3>
                    {filteredPastJobs.length > 0 ? (
                      <div className="space-y-4">
                        {filteredPastJobs.map((appointment) => (
                          <AppointmentCard
                            key={appointment.id}
                            appointment={convertToCardData(appointment)}
                            onClick={() => handleAppointmentCardClick(appointment)}
                            role="cleaner"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 bg-white rounded-2xl border border-gray-200 shadow-sm">
                        <History className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-600">No past jobs</p>
                      </div>
                    )}
                  </div>
                )}

                {jobsTab === "all" && (
                  <div>
                    <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2 mb-4">
                      <Calendar className="w-5 h-5 text-primary-600" />
                      All Jobs
                    </h3>
                    {filteredAllJobs.length > 0 ? (
                      <div className="space-y-4">
                        {filteredAllJobs.map((appointment) => (
                          <AppointmentCard
                            key={appointment.id}
                            appointment={convertToCardData(appointment)}
                            onClick={() => handleAppointmentCardClick(appointment)}
                            role="cleaner"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 bg-white rounded-2xl border border-gray-200 shadow-sm">
                        <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-600">No jobs found</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Calendar View Content */}
      {viewType === "calendar" && (
        <CalendarView
          appointments={allFilteredAppointments}
          loading={appointmentsLoading}
          onAppointmentClick={handleCalendarAppointmentClick}
          onDayClick={handleDayClick}
          onSlotSelect={handleSlotSelect}
          onReschedule={async () => {}}
          onLocalReschedule={() => {}}
          canEdit={false}
          role="cleaner"
        />
      )}

      {/* Day Detail Sidebar (for calendar view) */}
      <DayDetailSidebar
        isOpen={showDayDetailSidebar}
        onClose={() => setShowDayDetailSidebar(false)}
        selectedDate={selectedDate}
        appointments={dayAppointments}
        onAppointmentClick={handleDayDetailAppointmentClick}
        onAddAppointment={() => {}}
        canEdit={false}
        role="cleaner"
      />

      {/* Side Panel */}
      <AppointmentSidePanel
        isOpen={showSidePanel}
        onClose={() => setShowSidePanel(false)}
        appointment={selectedAppointment}
        role="cleaner"
        canEdit={false}
        onStartJob={handleStartJob}
        onCompleteJob={handleCompleteJob}
      />
          </>
        )}
      </div>
    );
  };

  const renderMessages = () => (
    <MessagesPage
      userId={user.id}
      userRole="cleaner"
      conversations={conversations}
      loading={conversationsLoading}
      error={conversationsError}
      onRefresh={refetchConversations}
      onUpdateUnreadCount={updateUnreadCount}
    />
  );

  const payoutStatusLabel = (status: string) => {
    switch (status) {
      case "paid":
        return "In Stripe";
      case "bank_paid":
        return "In Bank";
      case "reversed":
        return "Reversed";
      case "failed":
        return "Failed";
      case "pending":
        return "Pending";
      case "approved":
        return "Approved";
      default:
        return status;
    }
  };

  const payoutStatusStyle = (status: string) => {
    switch (status) {
      case "bank_paid":
        return "text-green-700 bg-green-100";
      case "paid":
        return "text-blue-700 bg-blue-100";
      case "pending":
      case "approved":
        return "text-yellow-700 bg-yellow-100";
      case "reversed":
      case "failed":
        return "text-red-700 bg-red-100";
      default:
        return "text-gray-700 bg-gray-100";
    }
  };

  const renderEarnings = () => (
    <div className="space-y-6">
      <h2 className="text-4xl font-bold text-gray-900">Earnings & Payouts</h2>

      {(projectedError || stripeError || historyError) ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Error loading earnings
          </h3>
          <p className="text-gray-600">{projectedError || stripeError || historyError}</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Projected Earnings */}
            <div className="card">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <TrendingUp className="w-4 h-4 text-green-600" />
                  </div>
                  <h4 className="text-sm font-semibold text-gray-500">Projected Earnings</h4>
                </div>
                <div className="relative flex-shrink-0">
                  <select
                    value={projectedPreset}
                    onChange={(e) => setProjectedPreset(e.target.value)}
                    className="appearance-none bg-white border border-gray-300 rounded-full px-3 py-1.5 pr-8 text-xs font-medium text-gray-700 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                  >
                    {PROJECTED_EARNINGS_PRESETS.map((preset) => (
                      <option key={preset.label} value={preset.label}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                </div>
              </div>
              {projectedLoading ? (
                <Loader2 className="w-7 h-7 animate-spin text-gray-400" />
              ) : (
                <p className="text-3xl font-bold text-green-600">
                  ${projectedEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              )}
            </div>

            {/* In Stripe */}
            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Wallet className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-500">In Stripe</h4>
                  <p className="text-xs text-gray-400">Current balance awaiting transfer</p>
                </div>
              </div>
              {stripeLoading ? (
                <Loader2 className="w-7 h-7 animate-spin text-gray-400" />
              ) : (
                <>
                  <p className="text-3xl font-bold text-blue-600">
                    ${inStripe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  {inStripe > 0 && (
                    <p className="text-xs text-gray-400 mt-1">See transfer date in your Stripe dashboard</p>
                  )}
                </>
              )}
            </div>

            {/* Last Bank Payout */}
            <div className="card">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Landmark className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-gray-500">Last Bank Payout</h4>
                  <p className="text-xs text-gray-400">Most recent deposit</p>
                </div>
              </div>
              {stripeLoading ? (
                <Loader2 className="w-7 h-7 animate-spin text-gray-400" />
              ) : latestBankPayoutAmount !== null ? (
                <div>
                  <p className="text-3xl font-bold text-emerald-600">
                    ${latestBankPayoutAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  {latestBankPayoutDate && (
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(latestBankPayoutDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 mt-1">No payouts yet</p>
              )}
            </div>
          </div>

          {/* Payout History */}
          <div className="card space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-700">Payout History</h3>
                {!historyLoading && (
                  <span className="text-xs text-gray-400">
                    {payoutHistory.length} payout{payoutHistory.length !== 1 ? "s" : ""} in selected period
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {EARNINGS_RANGE_PRESETS.map((preset) => {
                  const isActive = preset.label === activeHistoryPresetLabel;
                  return (
                    <button
                      key={preset.label}
                      onClick={() => setHistoryRange(preset.get())}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                        isActive
                          ? "bg-primary-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <input
                    type="date"
                    value={historyRange.start}
                    onChange={(e) =>
                      setHistoryRange((prev) => ({ ...prev, start: e.target.value }))
                    }
                    className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                  <span>–</span>
                  <input
                    type="date"
                    value={historyRange.end}
                    onChange={(e) =>
                      setHistoryRange((prev) => ({ ...prev, end: e.target.value }))
                    }
                    className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              </div>
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-600">Loading payouts...</span>
              </div>
            ) : payoutHistory.length > 0 ? (
              <div className="space-y-3">
                {payoutHistory.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-xl"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">
                        ${row.amount.toFixed(2)} &mdash;{" "}
                        {row.appointment?.service_type?.name || "Service"}
                      </p>
                      <p className="text-sm text-gray-600 truncate">
                        {row.appointment?.homeowner
                          ? `${row.appointment.homeowner.first_name} ${row.appointment.homeowner.last_name}`
                          : "Customer"}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        {row.appointment?.scheduled_date && (
                          <span className="text-xs text-gray-500">
                            Job: {new Date(row.appointment.scheduled_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        )}
                        {row.paid_at && (
                          <span className="text-xs text-gray-400 flex items-center gap-1">
                            <ArrowDownToLine className="w-3 h-3" />
                            {new Date(row.paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </span>
                        )}
                        {row.bank_paid_at && (
                          <span className="text-xs text-emerald-600 flex items-center gap-1">
                            <Landmark className="w-3 h-3" />
                            {new Date(row.bank_paid_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`ml-3 flex-shrink-0 px-3 py-1 text-xs font-semibold rounded-full whitespace-nowrap ${payoutStatusStyle(row.status)}`}
                    >
                      {payoutStatusLabel(row.status)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <DollarSign className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No payouts in this period
                </h3>
                <p className="text-gray-600">
                  Payouts will appear here once transfers are made for your completed jobs.
                </p>
              </div>
            )}
          </div>

          {/* Stripe Connection Status */}
          <StripeConnectionCard compact />
        </>
      )}
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case "home":
        return renderSchedule();
      case "jobs":
        return renderJobs();
      case "messages":
        return renderMessages();
      case "earnings":
        return renderEarnings();
      case "services":
        return (
          <ServicesPage
            services={services}
            loading={servicesLoading}
            error={servicesError}
            refetch={refetchServices}
            canManageServices={false}
            updateServiceInState={updateServiceInState}
            maxChecklistAdderByServiceId={maxChecklistAdderByServiceId}
            refreshMaxChecklistAdders={refreshMaxChecklistAdders}
          />
        );
      case "settings":
        return <SettingsHub />;
      default:
        return renderSchedule();
    }
  };

  return (
    <div className="min-h-screen bg-white md:bg-gray-100">
      {/* Persistent Desktop Sidebar - Shows Groups */}
      <DesktopSidebar
        tabs={sidebarTabs}
        onTabChange={setActiveTab}
        onLogout={handleLogout}
        user={user}
        activeTab={activeTab}
      />

      {/* Main Content Wrapper with Sidebar Offset */}
      <div className="md:ml-[260px] pt-4 md:pt-16">
        {/* Top Bar - Shows Tabs Within Selected Group - Hide on mobile for all tabs */}
        <div className="hidden md:block">
          <TopBar
            role="cleaner"
            user={user}
            tabs={[]}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onMobileMenuClick={() => setIsSidebarOpen(true)}
            profileClickNavigatesToSettings
            showMessagesIcon
            hasUnreadMessages={hasUnreadMessages}
            showSettingsIcon
          />
        </div>

        {/* Main Content Area */}
        <main
          className={`${
            activeTab === "messages"
              ? "p-0 md:p-4 md:sm:p-6 md:lg:p-8"
              : "p-4 sm:p-6 lg:p-8"
          } pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-8`}
        >
          {/* Tab Content */}
          {renderContent()}
        </main>
      </div>

      <MobileNavigation
        tabs={mobileNavTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onMenuClick={() => setIsSidebarOpen(true)}
      />
      <MobileSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        role="cleaner"
        tabs={allTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </div>
  );
}

export default function CleanerDashboard() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-white md:bg-gray-100 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      }
    >
      <CleanerDashboardInner />
    </Suspense>
  );
}
