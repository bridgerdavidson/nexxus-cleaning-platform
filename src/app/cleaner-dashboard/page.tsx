"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import {
  Calendar,
  MapPin,
  MessageCircle,
  DollarSign,
  Camera,
  Clock,
  CheckCircle,
  Star,
  Upload,
  Loader2,
  Home,
  Search,
  List,
  CalendarDays,
  ChevronDown,
  History,
  Briefcase,
} from "lucide-react";
import {
  useCleanerAppointments,
  useCleanerStats,
  useCleanerMessages,
  useCleanerPayouts,
  useCleanerPhotos,
  updateAppointmentStatus,
  uploadJobPhoto,
} from "../../hooks/useCleanerData";
import { useConversations } from "../../hooks/useConversations";
import { useServices } from "../../hooks/useServices";
import DashboardHeader from "../../components/DashboardHeader";
import MobileNavigation from "../../components/MobileNavigation";
import MobileSidebar from "../../components/MobileSidebar";
import MessagesPage from "../../components/MessagesPage";
import AppointmentCard, {
  AppointmentCardData,
} from "../../components/AppointmentCard";
import AppointmentSidePanel from "../../components/AppointmentSidePanel";
import CalendarView from "../../components/CalendarView";
import DayDetailSidebar from "../../components/DayDetailSidebar";
import StatusBadge from "../../components/StatusBadge";
import ServicesPage from "../../components/ServicesPage";
import { format } from "date-fns";

type ViewType = "list" | "calendar";

export default function CleanerDashboard() {
  const { user, loading, currentOrganizationId } = useAuth();
  
  // #region agent log
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cleaner-dashboard:50',message:'Dashboard render',data:{hasUser:!!user,loading,userId:user?.id},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'G'})}).catch(()=>{});
  });
  // #endregion
  
  const [activeTab, setActiveTab] = useState("home");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const router = useRouter();

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
    messages,
    loading: messagesLoading,
    error: messagesError,
  } = useCleanerMessages();
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
    error: payoutsError,
  } = useCleanerPayouts();
  const {
    photos,
    loading: photosLoading,
    error: photosError,
  } = useCleanerPhotos();
  const {
    services,
    loading: servicesLoading,
    error: servicesError,
    refetch: refetchServices,
    updateServiceInState,
  } = useServices();

  // Calculate if there are any unread messages
  const hasUnreadMessages = useMemo(() => {
    return conversations.some((conv) => conv.unread_count > 0);
  }, [conversations]);

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

  // Active jobs (in_progress) - shown in dedicated section when any exist
  const activeJobs = useMemo(
    () =>
      appointments
        .filter((apt) => apt.status === "in_progress")
        .sort((a, b) => {
          const dateCompare = a.scheduled_date.localeCompare(b.scheduled_date);
          if (dateCompare !== 0) return dateCompare;
          return a.scheduled_time.localeCompare(b.scheduled_time);
        }),
    [appointments]
  );

  // Today's jobs excluding in_progress (so they only appear in Active Jobs section)
  const filteredTodaysJobsDisplay = useMemo(
    () => filteredTodaysJobs.filter((apt) => apt.status !== "in_progress"),
    [filteredTodaysJobs]
  );

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
    return [...filteredTodaysJobs, ...filteredUpcomingJobs, ...filteredPastJobs].map(
      convertToCardData
    );
  }, [filteredTodaysJobs, filteredUpcomingJobs, filteredPastJobs]);

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
    // #region agent log
    if (process.env.NODE_ENV === 'development') fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cleaner-dashboard:366',message:'Dashboard redirect useEffect',data:{hasUser:!!user,loading,willRedirect:!loading && !user},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'G'})}).catch(()=>{});
    // #endregion
    
    if (!loading && !user) {
      // #region agent log
      if (process.env.NODE_ENV === 'development') fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'cleaner-dashboard:368',message:'Dashboard redirecting to login',data:{loading,user},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'G'})}).catch(()=>{});
      // #endregion
      
      router.push("/login");
    }
  }, [user, loading, router]);

  // Scroll to top when tab changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  // Show loading while checking auth
  if (loading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Helper functions
  const formatDateTime = (date: string, time: string) => {
    // Parse date string (YYYY-MM-DD) as local date to avoid timezone issues
    const [year, month, day] = date.split("-").map(Number);
    const localDate = new Date(year, month - 1, day); // month is 0-indexed
    const formattedDate = localDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${formattedDate} at ${time}`;
  };

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
    // Get today's date in local timezone (NOT UTC). Exclude in_progress so they show in Active Jobs.
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const today = `${year}-${month}-${day}`;

    return appointments.filter(
      (appointment) =>
        appointment.scheduled_date === today &&
        ["pending", "confirmed"].includes(appointment.status)
    );
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

  const formatTime = (time: string) => {
    // Convert military time (HH:mm:ss) to standard time (h:mm AM/PM)
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const standardHour = hour % 12 || 12;
    return `${standardHour}:${minutes} ${ampm}`;
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
      // Realtime subscription will automatically update the UI
      // No need to reload the page
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

  const tabs = [
    { id: "home", label: "Overview", icon: Home },
    { id: "jobs", label: "Jobs", icon: MapPin },
    {
      id: "messages",
      label: "Messages",
      icon: MessageCircle,
      hasNotification: hasUnreadMessages,
    },
    { id: "services", label: "Services", icon: Briefcase },
    { id: "earnings", label: "Earnings", icon: DollarSign },
    { id: "photos", label: "Photos", icon: Camera },
  ];

  // Filter tabs for top navigation (exclude earnings and photos - those are in mobile sidebar)
  const topNavTabs = tabs.filter(
    (tab) => tab.id !== "earnings" && tab.id !== "photos"
  );

  // Mobile navigation tabs (services is included since cleaner needs it in mobile nav)
  const mobileNavTabs = [
    { id: "home", label: "Overview", icon: Home },
    { id: "jobs", label: "Jobs", icon: MapPin },
    {
      id: "messages",
      label: "Messages",
      icon: MessageCircle,
      hasNotification: hasUnreadMessages,
    },
    { id: "services", label: "Services", icon: Briefcase },
  ];

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
    setSelectedAppointment(convertToCardData(appointment));
    setActiveTab("jobs");
    // Use setTimeout to ensure tab switch happens before opening panel
    setTimeout(() => {
      setShowSidePanel(true);
    }, 0);
  };

  const renderSchedule = () => (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-4xl font-bold text-gray-900">Overview</h2>
          <span className="px-2.5 py-1 bg-primary-100 text-primary-700 text-xs font-semibold rounded-full">
            Cleaner Dashboard
          </span>
        </div>
        <p className="text-gray-600">
          Manage your cleaning jobs and schedule from one central location.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-primary-100 rounded-lg">
              <CheckCircle className="w-6 h-6 text-primary-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Jobs</p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  {stats.totalJobs}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <Clock className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">This Week</p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  {stats.upcomingJobs}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <DollarSign className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Confirmed Today
              </p>
              {appointmentsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  $
                  {getTodaysJobs()
                    .filter((a) => a.status === "confirmed")
                    .reduce((sum, a) => sum + Number(a.total_price), 0)
                    .toFixed(0)}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <DollarSign className="w-6 h-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Pending Today</p>
              {appointmentsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  $
                  {getTodaysJobs()
                    .filter((a) => a.status === "pending")
                    .reduce((sum, a) => sum + Number(a.total_price), 0)
                    .toFixed(0)}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Star className="w-6 h-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Rating</p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  {stats.rating}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Active Jobs - only shown when there are jobs in progress */}
      {activeJobs.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Active Jobs
          </h3>
          <div className="space-y-4">
            {activeJobs.map((appointment) => (
              <div
                key={appointment.id}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  handleTodayScheduleAppointmentClick(appointment);
                }}
                className="flex items-center justify-between p-4 bg-purple-50/50 rounded-lg cursor-pointer hover:bg-purple-50 transition-colors overflow-hidden animate-pulse-glow"
              >
                <div className="flex items-center flex-1">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 text-lg">
                        {formatTime(appointment.scheduled_time)}
                      </p>
                      <StatusBadge status={appointment.status} size="sm" />
                    </div>
                    <p className="text-sm font-medium text-gray-800 mt-1">
                      {appointment.homeowner
                        ? `${appointment.homeowner.first_name} ${appointment.homeowner.last_name}`
                        : "Unknown Homeowner"}
                    </p>
                    <p className="text-sm text-gray-600">
                      {appointment.property
                        ? `${appointment.property.address}, ${appointment.property.city}, ${appointment.property.state}`
                        : "Address not available"}
                    </p>
                    {appointment.service_type && (
                      <p className="text-sm text-gray-600">
                        {appointment.service_type.name}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right ml-4 flex flex-col items-end gap-2">
                  <p className="text-lg font-bold text-gray-900">
                    ${Number(appointment.total_price).toFixed(0)}
                  </p>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCompleteJob(appointment.id);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium bg-green-600 text-white rounded-full hover:bg-green-700 transition-colors shadow-md"
                  >
                    Complete Job
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's Schedule */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Today's Schedule
        </h3>
        {appointmentsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Loading schedule...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {getTodaysJobs().map((appointment) => {
              return (
                <div
                  key={appointment.id}
                  onClick={(e) => {
                    // Don't trigger if clicking on a button
                    if ((e.target as HTMLElement).closest("button")) {
                      return;
                    }
                    handleTodayScheduleAppointmentClick(appointment);
                  }}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border-l-4 relative cursor-pointer hover:bg-gray-100 transition-colors overflow-hidden"
                  style={{
                    borderLeftColor: getStatusBorderColor(appointment.status),
                  }}
                >
                  <div className="flex items-center space-x-4 flex-1">
                    <div className="flex-shrink-0">
                      <Calendar className="w-8 h-8 text-primary-600" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900 text-lg">
                          {formatTime(appointment.scheduled_time)}
                        </p>
                        <StatusBadge status={appointment.status} size="sm" />
                      </div>
                    <p className="text-sm font-medium text-gray-800 mt-1">
                      {appointment.homeowner
                        ? `${appointment.homeowner.first_name} ${appointment.homeowner.last_name}`
                        : "Unknown Homeowner"}
                    </p>
                    <p className="text-sm text-gray-600">
                      {appointment.property
                        ? `${appointment.property.address}, ${appointment.property.city}, ${appointment.property.state}`
                        : "Address not available"}
                    </p>
                    {appointment.service_type && (
                      <p className="text-sm text-gray-600">
                        {appointment.service_type.name}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right ml-4 flex flex-col items-end gap-2">
                  <p className="text-lg font-bold text-gray-900">
                    ${Number(appointment.total_price).toFixed(0)}
                  </p>
                  <div className="flex flex-col gap-2 items-end">
                    {/* Start Job button - shows when status is confirmed */}
                    {appointment.status === "confirmed" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartJob(appointment.id);
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium bg-primary-600 text-white rounded-full hover:bg-primary-700 transition-colors shadow-md"
                      >
                        Start Job
                      </button>
                    )}
                    {/* Complete Job button - shows when status is in_progress */}
                    {appointment.status === "in_progress" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCompleteJob(appointment.id);
                        }}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium bg-green-600 text-white rounded-full hover:bg-green-700 transition-colors shadow-md"
                      >
                        Complete Job
                      </button>
                    )}
                  </div>
                </div>
                </div>
              );
            })}
            {getTodaysJobs().length === 0 && (
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">No jobs scheduled for today</p>
                <p className="text-sm text-gray-500 mt-2">
                  Check the Jobs tab for upcoming appointments
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
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
    setSelectedAppointment(convertToCardData(appointment));
    setShowSidePanel(true);
  };

  const renderJobs = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
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
      </div>

      {/* Search Input - Own line on mobile */}
      <div className="flex-1 relative md:hidden">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search by homeowner, property, or service..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
        />
      </div>

      {/* Filters Row */}
      <div className="flex flex-row gap-3 overflow-x-auto">
        {/* Search Input - Desktop only */}
        <div className="hidden md:flex flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by homeowner, property, or service..."
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
              {/* Active Jobs Section - only when there are jobs in progress */}
              {activeJobs.length > 0 && (
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 mb-4">
                    Active Jobs
                  </h3>
                  <div className="space-y-4">
                    {activeJobs.map((appointment) => (
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

              {/* Today's Jobs Section - pending/confirmed only; in_progress show in Active Jobs */}
              <div>
                <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-primary-600" />
                  Today's Jobs
                  <span className="text-sm font-normal text-gray-500">
                    ({filteredTodaysJobsDisplay.length})
                  </span>
                </h3>
                {filteredTodaysJobsDisplay.length > 0 ? (
                  <div className="space-y-4">
                    {filteredTodaysJobsDisplay.map((appointment) => (
                      <AppointmentCard
                        key={appointment.id}
                        appointment={convertToCardData(appointment)}
                        onClick={() => handleAppointmentCardClick(appointment)}
                        role="cleaner"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 bg-white rounded-lg border border-gray-200">
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
                      <div className="text-center py-8 bg-white rounded-lg border border-gray-200">
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
                      <div className="text-center py-8 bg-white rounded-lg border border-gray-200">
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
                      <div className="text-center py-8 bg-white rounded-lg border border-gray-200">
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
    </div>
  );

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

  const renderEarnings = () => (
    <div className="space-y-6">
      <h2 className="text-4xl font-bold text-gray-900">Earnings & Payouts</h2>

      {/* Earnings Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Total Earnings
          </h3>
          {statsLoading ? (
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          ) : (
            <p className="text-3xl font-bold text-green-600">
              ${stats.totalEarnings}
            </p>
          )}
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Pending Payout
          </h3>
          {statsLoading ? (
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          ) : (
            <p className="text-3xl font-bold text-yellow-600">
              ${stats.pendingPayouts}
            </p>
          )}
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            This Week
          </h3>
          {statsLoading ? (
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          ) : (
            <p className="text-3xl font-bold text-primary-600">
              ${stats.completedThisWeek * 120}
            </p>
          )}
        </div>
      </div>

      {/* Payout History */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Payout History
        </h3>
        {payoutsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Loading payouts...</span>
          </div>
        ) : payouts.length > 0 ? (
          <div className="space-y-4">
            {payouts.slice(0, 10).map((payout) => (
              <div
                key={payout.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    ${payout.amount} -{" "}
                    {payout.appointment?.service_type?.name || "Service"}
                  </p>
                  <p className="text-sm text-gray-600">
                    {payout.appointment?.homeowner
                      ? `${payout.appointment.homeowner.first_name} ${payout.appointment.homeowner.last_name}`
                      : "Unknown Customer"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(payout.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 text-sm font-semibold rounded-full ${
                    payout.status === "paid"
                      ? "text-green-600 bg-green-100"
                      : payout.status === "pending"
                      ? "text-yellow-600 bg-yellow-100"
                      : "text-red-600 bg-red-100"
                  }`}
                >
                  {payout.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <DollarSign className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No payouts yet
            </h3>
            <p className="text-gray-600">
              Your payout history will appear here once you complete jobs.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const renderPhotos = () => (
    <div className="space-y-6">
      <h2 className="text-4xl font-bold text-gray-900">Photo Management</h2>

      {/* Upload Section */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Upload Before/After Photos
        </h3>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">
            Upload Photos
          </h4>
          <p className="text-gray-600 mb-4">
            Drag and drop your before/after photos here, or click to browse
          </p>
          <button className="btn-primary">Choose Files</button>
        </div>
      </div>

      {/* Recent Photos */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Recent Photos
        </h3>
        {photosLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Loading photos...</span>
          </div>
        ) : photos.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {photos.slice(0, 12).map((photo) => (
              <div key={photo.id} className="relative group">
                <img
                  src={photo.photo_url}
                  alt={`${photo.photo_type} photo`}
                  className="w-full h-32 object-cover rounded-lg"
                />
                <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                  <div className="text-white text-center">
                    <p className="text-sm font-medium">{photo.photo_type}</p>
                    <p className="text-xs">
                      {photo.appointment?.homeowner
                        ? `${photo.appointment.homeowner.first_name} ${photo.appointment.homeowner.last_name}`
                        : "Unknown"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Camera className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No photos uploaded
            </h3>
            <p className="text-gray-600">
              Photos you upload for jobs will appear here.
            </p>
          </div>
        )}
      </div>
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
      case "photos":
        return renderPhotos();
      case "services":
        return (
          <ServicesPage
            services={services}
            loading={servicesLoading}
            error={servicesError}
            refetch={refetchServices}
            canManageServices={false}
            updateServiceInState={updateServiceInState}
          />
        );
      default:
        return renderSchedule();
    }
  };

  return (
    <>
      {/* Hide header on mobile for all tabs */}
      <div className="hidden md:block">
        <DashboardHeader
          role="cleaner"
          tabs={topNavTabs}
          sidebarTabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
      <div
        className={`min-h-screen ${
          activeTab === "messages" ? "bg-white md:bg-gray-50" : "bg-gray-50"
        } pt-4 md:pt-16`}
      >
        <div
          className={`${
            activeTab === "messages"
              ? "px-0 md:px-4 md:sm:px-6 md:lg:px-8"
              : "px-4 sm:px-6 lg:px-8"
          } pb-24 md:pb-8 ${
            activeTab === "messages" ? "py-0 md:py-8" : "py-8"
          }`}
        >
          {/* Tab Content */}
          {renderContent()}
        </div>
      </div>
      <MobileNavigation
        tabs={topNavTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onMenuClick={() => setIsSidebarOpen(true)}
      />
      <MobileSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        role="cleaner"
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
    </>
  );
}
