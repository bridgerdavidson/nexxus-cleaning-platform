"use client";

import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import WorkspaceErrorScreen from "../../components/WorkspaceErrorScreen";
import {
  SprayCan,
  Calendar,
  MapPin,
  MessageCircle,
  DollarSign,
  Clock,
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
} from "lucide-react";
import {
  useCleanerAppointments,
  useCleanerAwaitingPayments,
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
import MobileTopBar from "../../components/MobileTopBar";
import MobileSidebar from "../../components/MobileSidebar";
import DesktopSidebar from "../../components/DesktopSidebar";
import MessagesPage from "../../components/MessagesPage";
import AppointmentCard, {
  AppointmentCardData,
} from "../../components/AppointmentCard";
import AppointmentPanelHost from "../../components/AppointmentPanelHost";
import { useAppointmentPanel } from "../../hooks/useAppointmentPanel";
import CalendarCockpit from "../../components/calendar/CalendarCockpit";
import StatusBadge from "../../components/StatusBadge";
import ServicesPage from "../../components/ServicesPage";
import ActiveJobPage from "../../components/ActiveJobPage";
import PendingConfirmationsSection from "../../components/PendingConfirmationsSection";
import ActiveNowSection from "../../components/ActiveNowSection";
import StripeConnectionCard from "../../components/StripeConnectionCard";
import PayoutsSection from "../../components/PayoutsSection";
import { useStripeConnect } from "../../hooks/useStripeConnect";
import {
  CLEANER_DASHBOARD_TAB_IDS,
  usePersistedDashboardTab,
} from "../../hooks/usePersistedDashboardTab";

type ViewType = "list" | "calendar";

function CleanerDashboardInner() {
  const { user, loading, signOut, currentOrganizationId, accessToken, orgStatus, reloadOrganization } = useAuth();
  const [activeTab, setActiveTab] = usePersistedDashboardTab(
    "home",
    CLEANER_DASHBOARD_TAB_IDS
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
  // URL-backed appointment drawer (?appointment=<id>), unified with the other
  // dashboards so notification deep-links + refresh-restore work for cleaners too.
  const {
    appointmentId: openAppointmentId,
    isOpen: isAppointmentPanelOpen,
    openAppointment,
    closeAppointment,
  } = useAppointmentPanel();
  // Real data hooks - must be called at top level
  // These hooks handle currentOrganizationId internally, but we need to ensure it's available
  const {
    appointments,
    loading: appointmentsLoading,
    error: appointmentsError,
    refetch: refetchAppointments,
  } = useCleanerAppointments();
  const {
    conversations,
    loading: conversationsLoading,
    error: conversationsError,
    refetch: refetchConversations,
    updateUnreadCount,
  } = useConversations({ userId: user?.id || "" });
  const { awaitingPayments } = useCleanerAwaitingPayments();

  // Connect status gates the embedded Stripe payouts table in the Earnings tab.
  const { connectStatus } = useStripeConnect();

  const {
    services,
    loading: servicesLoading,
    error: servicesError,
    refetch: refetchServices,
    updateServiceInState,
    maxChecklistAdderByServiceId,
    refreshMaxChecklistAdders,
  } = useServices();

  // Track the conversation the user is actively viewing inside MessagesPage so
  // we can exclude it from the nav-bar unread dot.
  const [selectedMessagesConversationId, setSelectedMessagesConversationId] =
    useState<string | null>(null);

  // Calculate if there are any unread messages
  const hasUnreadMessages = useMemo(() => {
    return conversations.some(
      (conv) =>
        conv.unread_count > 0 && conv.id !== selectedMessagesConversationId
    );
  }, [conversations, selectedMessagesConversationId]);

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

  // Cleaner's existing schedule as conflict blocks — feeds the free-slot
  // chip derivation in PendingConfirmationsSection's "Propose alternative"
  // modal. Cancelled appointments don't count.
  const cleanerSchedule = useMemo(
    () =>
      appointments
        .filter((apt) => apt.status !== "cancelled")
        .map((apt) => ({
          date: apt.scheduled_date,
          time: apt.scheduled_time,
          duration_minutes: apt.service_type?.duration_minutes ?? 60,
        })),
    [appointments]
  );

  // Overview-only: today's jobs with no filters (in_progress only under Active Cleanings).
  // Excludes pending-confirmation rows — those live in the Action Required section
  // so the cleaner doesn't see the same appointment twice.
  const overviewTodaysJobs = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;
    return appointments
      .filter(
        (apt) =>
          apt.scheduled_date === today &&
          apt.status !== "in_progress" &&
          apt.cleaner_confirmation_status !== "awaiting"
      )
      .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
  }, [appointments]);

  // Overview-only: upcoming jobs (after today, no filters) for overview preview.
  // Same dedup as overviewTodaysJobs — pending-confirmation rows live in Action Required.
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
          apt.status !== "cancelled" &&
          apt.cleaner_confirmation_status !== "awaiting"
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
      openAppointment(appointment.id);
    },
    [openAppointment]
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
  // Show loading while checking auth or while the org context is still resolving.
  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Org context failed to load (transient) — offer retry, not a blank dashboard.
  if (orgStatus === "error") {
    return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
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

    setActiveTab("jobs");
    openAppointment(appointment.id);
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
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
        </div>
      </div>

      <div className="space-y-6">
        {/* Pending Confirmations - Requires cleaner action */}
        <PendingConfirmationsSection
          appointments={pendingConfirmations}
          loading={appointmentsLoading}
          userId={user.id}
          organizationId={currentOrganizationId || ""}
          cleanerSchedule={cleanerSchedule}
          accessToken={accessToken}
          onConfirmed={() => {
            // Realtime fires on cleaner_id=eq.{me}, but when the row's
            // cleaner_id changes (e.g. decline → routed to next cleaner) the
            // eq-filtered subscription doesn't notify us. Refetch explicitly
            // so the card disappears immediately on accept/decline.
            void refetchAppointments();
          }}
        />

        {/* Active Cleanings - shared header (cyan icon + ping dot + count) with admin/manager Active Now,
            but renders cleaner-flavored AppointmentCards in the body to match Today's Jobs / Upcoming Jobs. */}
        {activeJobs.length > 0 && (
          <ActiveNowSection
            title="Active Cleanings"
            appointments={activeJobs.map(convertToCardData)}
            loading={appointmentsLoading}
          >
            <div className="space-y-3">
              {activeJobs.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={convertToCardData(appointment)}
                  onClick={() => handleTodayScheduleAppointmentClick(appointment)}
                  role="cleaner"
                />
              ))}
            </div>
          </ActiveNowSection>
        )}

        {/* Today's Jobs - collapsible; auto-collapsed when empty */}
        <section className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandedToday((prev) => !prev)}
            className="w-full flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-gray-50 transition-colors duration-200"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-50 text-gray-600 rounded-xl">
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
                  {overviewTodaysJobs.slice(0, 3).map((appointment) => (
                    <AppointmentCard
                      key={appointment.id}
                      appointment={convertToCardData(appointment)}
                      onClick={() => handleTodayScheduleAppointmentClick(appointment)}
                      role="cleaner"
                      onStartJob={handleStartJob}
                    />
                  ))}
                  {overviewTodaysJobs.length > 3 && (
                    <button
                      onClick={() => setActiveTab("jobs")}
                      className="w-full text-center py-3 text-sm font-semibold text-primary-700 bg-white hover:bg-primary-50 transition-colors duration-200 rounded-xl border border-primary-100 shadow-sm"
                    >
                      View all ({overviewTodaysJobs.length})
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Clock className="w-12 h-12 text-gray-400 mx-auto mb-2" />
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

    openAppointment(appointment.id);
  };

  const renderJobs = () => {
    // Get appointment details if in active job view
    const activeAppointment = activeJobView
      ? appointments.find(a => a.id === activeJobView)
      : null;

    return (
      <div className="space-y-6">
        {/* Pending Confirmations — surfaced at the top of Jobs so cleaners working
            from this tab don't miss action-required requests. Hidden in drilled-in
            single-job view. */}
        {!activeJobView && (
          <PendingConfirmationsSection
            appointments={pendingConfirmations}
            loading={appointmentsLoading}
            userId={user.id}
            organizationId={currentOrganizationId || ""}
            cleanerSchedule={cleanerSchedule}
            accessToken={accessToken}
            onConfirmed={() => {
              void refetchAppointments();
            }}
          />
        )}

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
                      <AppointmentCard
                        key={appointment.id}
                        appointment={convertToCardData(appointment)}
                        onClick={() => handleAppointmentCardClick(appointment)}
                        role="cleaner"
                      />
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

      {/* Calendar View Content (read-only cockpit, scoped to this cleaner's own jobs) */}
      {viewType === "calendar" && (
        <CalendarCockpit
          appointments={allFilteredAppointments}
          loading={appointmentsLoading}
          onAppointmentClick={handleCalendarAppointmentClick}
          canEdit={false}
          role="cleaner"
        />
      )}

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
      onSelectedConversationChange={setSelectedMessagesConversationId}
    />
  );

  const renderEarnings = () => (
    <div className="space-y-6">
      <h2 className="text-4xl font-bold text-gray-900">Earnings & Payouts</h2>

      {/* Embedded Stripe payouts table — the source of truth for the cleaner's
          balance, next payout, and what's already landed in their bank. Gated on
          an active Connect account; the connection card below handles setup when
          they haven't onboarded yet. */}
      {connectStatus?.onboarding_complete && (
        <PayoutsSection variant="cleaner" connected />
      )}

      {/* Awaiting customer payment — bank (ACH) debits still clearing the customer's
          account (Hop 1). The cleaner is paid only once these settle (~4 business days). */}
      {awaitingPayments.length > 0 && (
        <div className="card space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-700">Awaiting customer payment</h3>
              <p className="text-xs text-gray-400">
                Bank payments clearing from the customer&apos;s account. You&apos;re paid once they
                settle (about 4 business days).
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {awaitingPayments.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-100 bg-gray-50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {row.appointment?.serviceName ?? "Cleaning"}
                    {row.appointment?.homeownerName ? ` · ${row.appointment.homeownerName}` : ""}
                  </p>
                  <p className="text-xs text-gray-500">
                    {row.appointment?.scheduledDate
                      ? new Date(row.appointment.scheduledDate).toLocaleDateString()
                      : "Completed"}
                    {" · "}
                    <span className="font-medium text-amber-600">Clearing</span>
                  </p>
                </div>
                <p className="text-sm font-semibold text-gray-900 whitespace-nowrap tabular-nums">
                  ${row.cleanerCut.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stripe Connection Status */}
      <StripeConnectionCard compact />
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
      default:
        return renderSchedule();
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Persistent Desktop Sidebar - Shows Groups */}
      <DesktopSidebar
        tabs={sidebarTabs}
        onTabChange={setActiveTab}
        onLogout={handleLogout}
        user={user}
        activeTab={activeTab}
      />

      {/* Main Content Wrapper with Sidebar Offset */}
      <div className="md:ml-[260px] pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-16">
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
            onOpenAppointment={(id) => openAppointment(id)}
          />
        </div>

        {/* Main Content Area */}
        <main
          className={`${
            activeTab === "messages"
              ? "p-0 pb-[calc(8rem+env(safe-area-inset-bottom))] md:px-4 lg:px-6 md:py-4"
              : "p-4 sm:p-6 lg:p-8 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-8"
          }`}
        >
          {/* Tab Content */}
          {renderContent()}
        </main>
      </div>

      {/* Mobile Top Bar - brand + notifications (bell opens a bottom sheet) */}
      <MobileTopBar
        role="cleaner"
        onTabChange={setActiveTab}
        onOpenAppointment={(id) => openAppointment(id)}
      />

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

      {/* Appointment drawer, mounted page-level so notification deep-links open
          it over any tab (URL-backed, with by-id fallback). */}
      <AppointmentPanelHost
        appointments={appointments as unknown as AppointmentCardData[]}
        appointmentId={openAppointmentId}
        isOpen={isAppointmentPanelOpen}
        onClose={closeAppointment}
        role="cleaner"
        canEdit={false}
        onStartJob={handleStartJob}
        onCompleteJob={handleCompleteJob}
        onRefreshAppointments={refetchAppointments}
      />
    </div>
  );
}

export default function CleanerDashboard() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
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
