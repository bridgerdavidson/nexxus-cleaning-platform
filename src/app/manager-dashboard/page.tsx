"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import {
  Calendar,
  Users,
  MessageCircle,
  DollarSign,
  CheckCircle,
  Clock,
  AlertCircle,
  AlertTriangle,
  Star,
  Loader2,
  Home,
  Search,
  Trash2,
  UserCheck,
  TrendingUp,
  Building,
  Settings,
  LayoutGrid,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Mail,
  FileText,
  Briefcase,
} from "lucide-react";
import {
  useManagerAppointments,
  useManagerCleaners,
  useManagerPayments,
  deleteCleaner,
  cancelAppointment,
  deleteAppointment,
  updateAppointmentStatus,
} from "../../hooks/useManagerData";
import {
  useAdminCustomers,
  useAdminStats,
  useAdminTeamMembers,
} from "../../hooks/useAdminData";
import { useServices } from "../../hooks/useServices";
import { useConversations } from "../../hooks/useConversations";
import { useManagerPermissions } from "../../hooks/useManagerPermissions";
import { formatDateTimeTo12h, formatTimeTo12h } from "../../lib/formatTime";
import TopBar from "../../components/TopBar";
import MobileNavigation from "../../components/MobileNavigation";
import MobileSidebar from "../../components/MobileSidebar";
import DesktopSidebar from "../../components/DesktopSidebar";
import AddCleanerModal from "../../components/AddCleanerModal";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import BookingsPage from "../../components/BookingsPage";
import MessagesPage from "../../components/MessagesPage";
import CustomersPage from "../../components/CustomersPage";
import TeamMembersPage from "../../components/TeamMembersPage";
import CleanerSidePanel from "../../components/CleanerSidePanel";
import AnalyticsPage from "../../components/AnalyticsPage";
import StatusBadge from "../../components/StatusBadge";
import ServicesPage from "../../components/ServicesPage";
import SettingsHub from "../../components/SettingsHub";
import RescheduleRequiredSection from "../../components/RescheduleRequiredSection";
import RescheduleAppointmentModal from "../../components/RescheduleAppointmentModal";
import { AppointmentCardData } from "../../components/AppointmentCard";

export default function ManagerDashboard() {
  const { user, loading, signOut, currentOrganizationId } = useAuth();
  const [activeGroup, setActiveGroup] = useState("operations");
  const [activeTab, setActiveTab] = useState("home");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showPendingFilter, setShowPendingFilter] = useState(false);
  const [showAllFilter, setShowAllFilter] = useState(false);
  const [showAddCleanerModal, setShowAddCleanerModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<
    "all" | "available" | "unavailable"
  >("all");
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    cleanerId: string | null;
    cleanerName: string;
  }>({
    isOpen: false,
    cleanerId: null,
    cleanerName: "",
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [isStatsExpanded, setIsStatsExpanded] = useState(false);
  const [isPendingApprovalsExpanded, setIsPendingApprovalsExpanded] = useState(true);
  const [initialMessageRecipientId, setInitialMessageRecipientId] = useState<string | null>(null);
  const [selectedCleaner, setSelectedCleaner] = useState<any | null>(null);
  const [isCleanerSidePanelOpen, setIsCleanerSidePanelOpen] = useState(false);
  const [rescheduleModalAppointment, setRescheduleModalAppointment] =
    useState<AppointmentCardData | null>(null);
  const router = useRouter();

  // Real data hooks - must be called at top level
  const {
    appointments,
    loading: appointmentsLoading,
    error: appointmentsError,
    refetch: refetchAppointments,
    updateAppointmentInState,
  } = useManagerAppointments();
  const {
    cleaners,
    loading: cleanersLoading,
    error: cleanersError,
    refetch: refetchCleaners,
    updateCleanerInState,
  } = useManagerCleaners();
  const {
    customers,
    loading: customersLoading,
    error: customersError,
    refetch: refetchCustomers,
    updateCustomerInState,
  } = useAdminCustomers();
  const {
    teamMembers,
    loading: teamMembersLoading,
    error: teamMembersError,
    refetch: refetchTeamMembers,
    updateTeamMemberInState,
  } = useAdminTeamMembers();
  const {
    payments,
    loading: paymentsLoading,
    error: paymentsError,
  } = useManagerPayments();
  const {
    conversations,
    loading: conversationsLoading,
    error: conversationsError,
    refetch: refetchConversations,
    updateUnreadCount,
  } = useConversations({ userId: user?.id || "" });
  const { permissions, loading: permissionsLoading } = useManagerPermissions();
  const { stats, loading: statsLoading } = useAdminStats();
  const {
    services,
    loading: servicesLoading,
    error: servicesError,
    refetch: refetchServices,
    updateServiceInState,
  } = useServices();

  // Calculate number of visible stats cards for dynamic grid - MUST be a hook and defined before early returns
  const visibleStatsCardsCount = useMemo(() => {
    let count = 2; // Total Bookings and Active Cleaners are always visible
    if (permissions?.can_view_payments) count++;
    if (permissions?.can_approve_decline_bookings) count++;
    if (permissions?.can_view_analytics) count += 2; // Growth and Completion
    return count;
  }, [permissions]);

  // Check if a tab is accessible based on permissions - MUST be a hook and defined before early returns
  const isTabAccessible = useCallback(
    (tabId: string): boolean => {
      if (!permissions) return false;

      switch (tabId) {
        case "home":
        case "settings":
          return true;
        case "bookings":
          return permissions.can_view_bookings || false;
        case "messages":
          return permissions.can_view_messages || false;
        case "customers":
          return permissions.can_view_customers || false;
        case "properties":
          return permissions.can_view_properties || false;
        case "cleaners":
        case "team":
          return permissions.can_manage_cleaners || false;
        case "payments":
          return permissions.can_view_payments || false;
        case "analytics":
          return permissions.can_view_analytics || false;
        case "services":
          return permissions.can_view_services || false;
        default:
          return false;
      }
    },
    [permissions]
  );

  // Calculate if there are any unread messages
  const hasUnreadMessages = useMemo(() => {
    return conversations.some((conv) => conv.unread_count > 0);
  }, [conversations]);

  // Build navigation groups based on permissions - using useMemo to ensure consistent hook order
  const navigationGroups = useMemo(() => {
    // Debug: Log permissions to help diagnose
    if (permissions) {
      console.log("Manager Permissions:", {
        can_view_bookings: permissions.can_view_bookings,
        can_view_messages: permissions.can_view_messages,
        can_view_customers: permissions.can_view_customers,
        can_view_properties: permissions.can_view_properties,
        can_manage_cleaners: permissions.can_manage_cleaners,
        can_view_payments: permissions.can_view_payments,
        can_view_analytics: permissions.can_view_analytics,
      });
    }

    // If permissions are still loading, return minimal groups
    if (permissionsLoading || !permissions) {
      return {
        operations: {
          id: "operations" as const,
          label: "Operations",
          icon: LayoutGrid,
          tabs: [{ id: "home", label: "Overview", icon: Home }],
        },
      };
    }

    const opsTabs = [{ id: "home", label: "Overview", icon: Home }];

    // Add bookings if permitted - check explicitly for true
    if (permissions.can_view_bookings === true) {
      opsTabs.push({ id: "bookings", label: "Bookings", icon: Calendar });
    }

    // Add messages if permitted
    if (permissions.can_view_messages === true) {
      opsTabs.push({
        id: "messages",
        label: "Messages",
        icon: MessageCircle,
        hasNotification: hasUnreadMessages,
      });
    }

    // Add customers to opsTabs for mobile navigation
    if (permissions.can_view_customers === true) {
      opsTabs.push({ id: "customers", label: "Customers", icon: Users });
    }

    // Add services if permitted
    if (permissions.can_view_services === true) {
      opsTabs.push({ id: "services", label: "Services", icon: Briefcase });
    }

    const accountsTabs = [];
    // Add customers if permitted (in accounts group for desktop sidebar)
    if (permissions.can_view_customers === true) {
      accountsTabs.push({ id: "customers", label: "Customers", icon: Users });
    }
    // Add properties if permitted
    if (permissions.can_view_properties === true) {
      accountsTabs.push({
        id: "properties",
        label: "Properties",
        icon: Building,
      });
    }

    const businessTabs = [];
    // Add payments if permitted
    if (permissions.can_view_payments === true) {
      businessTabs.push({ id: "payments", label: "Finance", icon: DollarSign });
    }
    // Add analytics if permitted
    if (permissions.can_view_analytics === true) {
      businessTabs.push({
        id: "analytics",
        label: "Analytics",
        icon: BarChart3,
      });
    }

    const groups: any = {
      operations: {
        id: "operations" as const,
        label: "Operations",
        icon: LayoutGrid,
        tabs: opsTabs,
      },
    };

    // Only add accounts group if it has tabs
    if (accountsTabs.length > 0) {
      groups.accounts = {
        id: "accounts" as const,
        label: "Accounts",
        icon: Users,
        tabs: accountsTabs,
      };
    }

    // Only add team group if permitted
    if (permissions.can_manage_cleaners === true) {
      groups.team = {
        id: "team" as const,
        label: "Team",
        icon: UserCheck,
        tabs: [
          { id: "team", label: "Team Members", icon: Users },
          { id: "cleaners", label: "Cleaners", icon: UserCheck },
        ],
      };
    }

    // Only add business group if it has tabs
    if (businessTabs.length > 0) {
      groups.business = {
        id: "business" as const,
        label: "Business",
        icon: TrendingUp,
        tabs: businessTabs,
      };
    }

    return groups;
  }, [permissions, permissionsLoading, hasUnreadMessages]);

  // Get groups array for sidebar
  const groups = useMemo(
    () => Object.values(navigationGroups),
    [navigationGroups]
  );

  // Get tabs for current group
  const currentGroupTabs = useMemo(
    () =>
      navigationGroups[activeGroup as keyof typeof navigationGroups]?.tabs ||
      [],
    [navigationGroups, activeGroup]
  );

  // Filter out "customers" from top navigation when in operations group (it appears in Accounts sidebar instead)
  const topNavTabs = useMemo(
    () =>
      activeGroup === "operations"
        ? currentGroupTabs.filter((tab) => tab.id !== "customers")
        : currentGroupTabs,
    [currentGroupTabs, activeGroup]
  );

  // Get all tabs for mobile (deduplicate by id to avoid duplicates when tab appears in multiple groups)
  const allTabs = useMemo(
    () => {
      const tabs = Array.from(
        new Map(
          groups.flatMap((g) => g.tabs).map((tab) => [tab.id, tab])
        ).values()
      );
      if (!tabs.find((t) => t.id === "settings")) {
        tabs.push({ id: "settings", label: "Settings", icon: Settings });
      }
      return tabs;
    },
    [groups]
  );

  // Handle group change - switch to first tab of new group
  const handleGroupChange = useCallback(
    (groupId: string) => {
      setActiveGroup(groupId);
      const newGroup =
        navigationGroups[groupId as keyof typeof navigationGroups];
      if (newGroup && newGroup.tabs.length > 0) {
        const firstTab =
          groupId === "team"
            ? newGroup.tabs.find((tab) => tab.id === "team")?.id ??
              newGroup.tabs[0].id
            : newGroup.tabs[0].id;
        // Check if tab is accessible
        if (isTabAccessible(firstTab)) {
          setActiveTab(firstTab);
        } else {
          // Find first accessible tab
          const accessibleTab = newGroup.tabs.find((tab) =>
            isTabAccessible(tab.id)
          );
          if (accessibleTab) {
            setActiveTab(accessibleTab.id);
          } else {
            setActiveTab("home");
          }
        }
      }
      // Reset filters when switching groups
      setShowPendingFilter(false);
      setShowAllFilter(false);
    },
    [navigationGroups, isTabAccessible]
  );

  // Handle tab change - reset filters if not navigating from specific sections
  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId);
    // Only keep filters if we're staying on bookings tab
    if (tabId !== "bookings") {
      setShowPendingFilter(false);
      setShowAllFilter(false);
    }
  }, []);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  // Redirect to home if current tab is not accessible (only after permissions have loaded)
  useEffect(() => {
    if (!permissionsLoading && permissions) {
      if (!isTabAccessible(activeTab)) {
        setActiveTab("home");
        setActiveGroup("operations");
      }
    }
  }, [permissions, permissionsLoading, activeTab, isTabAccessible]);

  // Scroll to top when tab changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  // Show loading while checking auth and permissions - MUST be after all hooks
  if (loading || !user || permissionsLoading || !permissions) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    await signOut();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "text-yellow-700 bg-yellow-100";
      case "confirmed":
        return "text-green-600 bg-green-100";
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

  const getPaymentStatusTabConfig = (paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded' | null | undefined) => {
    switch (paymentStatus) {
      case "paid":
        return {
          label: "Paid",
          bgColor: "bg-green-100",
          textColor: "text-green-700",
        };
      case "failed":
        return {
          label: "Failed",
          bgColor: "bg-red-100",
          textColor: "text-red-700",
        };
      case "pending":
        return {
          label: "Unpaid",
          bgColor: "bg-gray-100",
          textColor: "text-gray-700",
        };
      case "refunded":
        return {
          label: "Refunded",
          bgColor: "bg-blue-100",
          textColor: "text-blue-700",
        };
      default:
        return {
          label: "Unpaid",
          bgColor: "bg-gray-100",
          textColor: "text-gray-700",
        };
    }
  };

  // Helper functions matching admin dashboard
  const getHomeownerName = (appointment: any) => {
    if (appointment.homeowner) {
      const { first_name, last_name } = appointment.homeowner;
      return `${first_name} ${last_name}`;
    }
    return "Unknown";
  };

  const getPropertyAddress = (appointment: any) => {
    if (appointment.property) {
      const { address, city, state } = appointment.property;
      return `${address}, ${city}, ${state}`;
    }
    return "Address not available";
  };

  const getCleanerName = (appointment: any) => {
    if (appointment.cleaner_profile?.user_profile) {
      const { first_name, last_name } =
        appointment.cleaner_profile.user_profile;
      return `${first_name} ${last_name}`;
    }
    return null;
  };

  const getCleanerFullName = (cleaner: any) => {
    if (cleaner.user_profile) {
      return `${cleaner.user_profile.first_name} ${cleaner.user_profile.last_name}`;
    }
    return "Unknown";
  };

  // Get upcoming appointments: future appointments that are confirmed
  // This matches the BookingsPage "upcoming" tab definition, but restricted to confirmed
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const allUpcomingAppointments = appointments
    .filter((a) => {
      // Parse appointment date
      const [year, month, day] = a.scheduled_date.split("-").map(Number);
      const appointmentDate = new Date(year, month - 1, day);
      appointmentDate.setHours(0, 0, 0, 0);
      
      // Future appointments that have been confirmed
      return appointmentDate >= today && a.status === "confirmed";
    })
    .sort((a, b) => {
      const dateA = new Date(`${a.scheduled_date}T${a.scheduled_time}`);
      const dateB = new Date(`${b.scheduled_date}T${b.scheduled_time}`);
      return dateA.getTime() - dateB.getTime();
    });
  
  const upcomingAppointments = allUpcomingAppointments.slice(0, 5);

  const pendingAppointments = appointments
    .filter((a) => {
      // Only include pending appointments that are today or in the future
      if (a.status !== "pending") return false;
      
      // Parse appointment date
      const [year, month, day] = a.scheduled_date.split("-").map(Number);
      const appointmentDate = new Date(year, month - 1, day);
      appointmentDate.setHours(0, 0, 0, 0);
      
      // Only include today and future appointments
      return appointmentDate >= today;
    })
    .sort((a, b) => {
      const dateA = new Date(`${a.scheduled_date}T${a.scheduled_time}`);
      const dateB = new Date(`${b.scheduled_date}T${b.scheduled_time}`);
      return dateA.getTime() - dateB.getTime();
    });

  // Appointments where the cleaner has rejected the time (needs rescheduling)
  const rescheduleRequiredAppointments = appointments
    .filter((a) => {
      if (a.cleaner_confirmation_status !== "rejected") return false;
      if (a.status === "completed" || a.status === "cancelled") return false;
      return true;
    })
    .sort((a, b) => {
      const dateA = new Date(`${a.scheduled_date}T${a.scheduled_time}`);
      const dateB = new Date(`${b.scheduled_date}T${b.scheduled_time}`);
      return dateA.getTime() - dateB.getTime();
    });

  // Appointments awaiting cleaner confirmation — shown in the "Pending Review" section
  const awaitingCleanerApprovalAppointments = appointments
    .filter((a) => {
      if (a.cleaner_confirmation_status !== "awaiting") return false;
      if (a.status === "completed" || a.status === "cancelled") return false;
      const [year, month, day] = a.scheduled_date.split("-").map(Number);
      const appointmentDate = new Date(year, month - 1, day);
      appointmentDate.setHours(0, 0, 0, 0);
      return appointmentDate >= today;
    })
    .sort((a, b) => {
      const dateA = new Date(`${a.scheduled_date}T${a.scheduled_time}`);
      const dateB = new Date(`${b.scheduled_date}T${b.scheduled_time}`);
      return dateA.getTime() - dateB.getTime();
    });

  const handleMessageCleaner = (appointment: (typeof appointments)[0]) => {
    const cleanerUserId = appointment.cleaner_profile?.user_profile?.id;
    if (!cleanerUserId) return;
    setInitialMessageRecipientId(cleanerUserId);
    setActiveGroup("operations");
    setActiveTab("messages");
  };

  // Get grid class based on visible cards count
  const getStatsGridClass = (count: number) => {
    // For responsive grid, we want cards to fill space evenly
    // Adjust columns based on actual visible count
    if (count === 1) return "md:grid-cols-1";
    if (count === 2) return "md:grid-cols-2";
    if (count === 3) return "md:grid-cols-2 lg:grid-cols-3";
    if (count === 4) return "md:grid-cols-2 lg:grid-cols-4";
    if (count === 5) return "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";
    return "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6";
  };

  const handleCancelAppointment = async (appointmentId: string) => {
    const result = await cancelAppointment(appointmentId);
    if (result.success) {
      await refetchAppointments();
    } else {
      alert("Failed to cancel appointment: " + result.error);
    }
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    const result = await deleteAppointment(appointmentId);
    if (result.success) {
      await refetchAppointments();
    } else {
      alert("Failed to delete appointment: " + result.error);
    }
  };

  const handleMarkComplete = async (appointmentId: string) => {
    const result = await updateAppointmentStatus(appointmentId, "completed");
    if (result.success) {
      await refetchAppointments();
    } else {
      alert("Failed to mark appointment as complete: " + result.error);
    }
  };

  const renderOverview = () => (
    <>
      {/* Mobile Header - Compact */}
      <div className="md:hidden mb-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-4xl font-bold text-gray-900">Overview</h2>
          <span className="px-2 py-0.5 bg-primary-100 text-primary-700 text-xs font-semibold rounded-full">
            Manager
          </span>
        </div>
      </div>

      {/* Desktop Header - Modern control center hero */}
      <div className="hidden md:block mb-6">
        <div className="relative overflow-hidden rounded-[2rem] border border-primary-200/90 bg-gradient-to-br from-white via-primary-100/55 to-primary-50/75 p-7 shadow-[0_8px_20px_-14px_rgba(161,98,7,0.22)] ring-1 ring-primary-200/60">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary-100/30 via-transparent to-gray-200/20" />
          <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary-300/35 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 bottom-0 h-48 w-48 rounded-full bg-primary-200/30 blur-3xl" />

          <div className="relative flex flex-col gap-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary-100 bg-white/80 px-3 py-1 text-xs font-semibold text-primary-700">
                <Star className="h-3.5 w-3.5" />
                Manager Dashboard
              </div>
              <h2 className="text-4xl font-bold tracking-tight text-gray-900">
                Operations overview
              </h2>
              <p className="mt-2 max-w-2xl text-gray-600">
                Track the health of bookings, team capacity, and revenue in one
                polished workspace built for quick decision-making.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {permissions?.can_view_bookings && (
                <button
                  onClick={() => setActiveTab("bookings")}
                  className="rounded-xl border border-primary-200 bg-white/90 px-4 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50"
                >
                  View bookings
                </button>
              )}
              {permissions?.can_view_analytics && (
                <button
                  onClick={() => setActiveTab("analytics")}
                  className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700"
                >
                  Open analytics
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3.5 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                <span className="rounded-lg bg-primary-100 p-1.5 ring-1 ring-primary-200/70">
                  <Calendar className="h-4 w-4 text-primary-700" />
                </span>
                Total Bookings
              </div>
              {statsLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold tracking-tight text-gray-900">
                  {stats.totalBookings}
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3.5 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                <span className="rounded-lg bg-gray-200 p-1.5 ring-1 ring-gray-300/70">
                  <Users className="h-4 w-4 text-gray-700" />
                </span>
                Active Cleaners
              </div>
              {statsLoading ? (
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold tracking-tight text-gray-900">
                  {stats.activeCleaners}
                </p>
              )}
            </div>

            {permissions?.can_view_payments && (
              <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3.5 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                  <span className="rounded-lg bg-emerald-100 p-1.5 ring-1 ring-emerald-200/70">
                    <DollarSign className="h-4 w-4 text-emerald-700" />
                  </span>
                  Total Revenue
                </div>
                {statsLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                ) : (
                  <p className="text-2xl font-bold tracking-tight text-gray-900">
                    ${stats.totalRevenue}
                  </p>
                )}
              </div>
            )}

            {permissions?.can_approve_decline_bookings && (
              <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3.5 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                  <span className="rounded-lg bg-amber-100 p-1.5 ring-1 ring-amber-200/80">
                    <AlertTriangle className="h-4 w-4 text-amber-700" />
                  </span>
                  Pending
                </div>
                {statsLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                ) : (
                  <p className="text-2xl font-bold tracking-tight text-gray-900">
                    {stats.pendingApprovals}
                  </p>
                )}
              </div>
            )}

            {permissions?.can_view_analytics && (
              <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3.5 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                  <span className="rounded-lg bg-primary-100 p-1.5 ring-1 ring-primary-200/70">
                    <TrendingUp className="h-4 w-4 text-primary-700" />
                  </span>
                  Growth
                </div>
                {statsLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                ) : (
                  <p className="text-2xl font-bold tracking-tight text-gray-900">
                    {stats.monthlyGrowth}%
                  </p>
                )}
              </div>
            )}

            {permissions?.can_view_analytics && (
              <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3.5 shadow-sm ring-1 ring-primary-100/60 backdrop-blur">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-gray-600">
                  <span className="rounded-lg bg-gray-200 p-1.5 ring-1 ring-gray-300/70">
                    <CheckCircle className="h-4 w-4 text-gray-700" />
                  </span>
                  Completion
                </div>
                {statsLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                ) : (
                  <p className="text-2xl font-bold tracking-tight text-gray-900">
                    {stats.completionRate}%
                  </p>
                )}
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      <div className="space-y-6 md:space-y-7">
        {/* Mobile Quick Stats Bar */}
        <div className="md:hidden bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3">
          <div className="flex items-center justify-between">
            {statsLoading ? (
              <div className="flex items-center justify-center w-full py-2">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
              </div>
            ) : (
              <>
                {permissions?.can_approve_decline_bookings && (
                  <div className="flex-1 text-center border-r border-gray-200">
                    <p className="text-xl font-bold text-amber-600">
                      {stats.pendingApprovals}
                    </p>
                    <p className="text-xs text-gray-500">Pending</p>
                  </div>
                )}
                <div className={`flex-1 text-center ${permissions?.can_approve_decline_bookings ? 'border-r border-gray-200' : ''}`}>
                  <p className="text-xl font-bold text-primary-600">
                    {stats.totalBookings}
                  </p>
                  <p className="text-xs text-gray-500">Bookings</p>
                </div>
                {permissions?.can_view_payments && (
                  <div className="flex-1 text-center border-l border-gray-200">
                    <p className="text-xl font-bold text-green-600">
                      ${stats.totalRevenue}
                    </p>
                    <p className="text-xs text-gray-500">Revenue</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Mobile Reschedule Required - Top Priority */}
        <div className="md:hidden">
          <RescheduleRequiredSection
            appointments={rescheduleRequiredAppointments}
            loading={appointmentsLoading}
            defaultExpanded={false}
            onReschedule={(apt) => {
              setRescheduleModalAppointment(apt as AppointmentCardData);
            }}
            onViewDetails={() => {
              setActiveTab("bookings");
            }}
          />
        </div>

        {/* Mobile Awaiting Cleaner Approval - Priority Section */}
        <div className="md:hidden">
          {awaitingCleanerApprovalAppointments.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden">
              <button
                onClick={() => setIsPendingApprovalsExpanded(!isPendingApprovalsExpanded)}
                className="w-full bg-amber-50 px-4 py-3 border-b border-amber-200 flex items-center justify-between hover:bg-amber-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <UserCheck className="w-5 h-5 text-amber-600" />
                  </div>
                  <span className="font-medium text-gray-900">
                    Awaiting Cleaner Approval
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="bg-amber-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                    {awaitingCleanerApprovalAppointments.length}
                  </span>
                  {isPendingApprovalsExpanded ? (
                    <ChevronUp className="w-5 h-5 text-amber-600" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-amber-600" />
                  )}
                </div>
              </button>
              {isPendingApprovalsExpanded && (
                <div className="divide-y divide-gray-100">
                  {appointmentsLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                    </div>
                  ) : (
                    awaitingCleanerApprovalAppointments.slice(0, 3).map((appointment) => {
                      const cleanerName = getCleanerName(appointment);
                      return (
                        <div key={appointment.id} className="p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 truncate">
                                {cleanerName ?? "Unassigned"}
                              </p>
                              <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                                <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                                <span>
                                  {formatDateTimeTo12h(
                                    appointment.scheduled_date,
                                    appointment.scheduled_time
                                  )}
                                </span>
                              </div>
                              <p className="text-sm text-gray-500 mt-0.5">
                                Homeowner: {getHomeownerName(appointment)}
                              </p>
                            </div>
                          </div>
                          {cleanerName && appointment.cleaner_profile?.user_profile?.id && (
                            <button
                              onClick={() => handleMessageCleaner(appointment)}
                              className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary-50 text-primary-700 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors font-medium text-sm"
                            >
                              <MessageCircle className="w-4 h-4" />
                              Message {cleanerName}
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                  {awaitingCleanerApprovalAppointments.length > 3 && (
                    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                      <button
                        onClick={() => {
                          setShowPendingFilter(true);
                          setActiveTab("bookings");
                        }}
                        className="w-full text-center text-sm font-medium text-primary-600"
                      >
                        View all {awaitingCleanerApprovalAppointments.length} awaiting approval
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {awaitingCleanerApprovalAppointments.length === 0 && !appointmentsLoading && (
            <div className="bg-white rounded-xl shadow-sm border border-green-200 p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-full">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">All confirmed!</p>
                  <p className="text-sm text-gray-500">No appointments awaiting cleaner approval</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Mobile Collapsible All Stats Section */}
        <div className="md:hidden">
          <button
            onClick={() => setIsStatsExpanded(!isStatsExpanded)}
            className="w-full bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <BarChart3 className="w-5 h-5 text-primary-600" />
              </div>
              <span className="font-medium text-gray-900">All Statistics</span>
            </div>
            {isStatsExpanded ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>
          {isStatsExpanded && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar className="w-4 h-4 text-primary-600" />
                  <span className="text-xs text-gray-500">Bookings</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">
                  {stats.totalBookings}
                </p>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-primary-600" />
                  <span className="text-xs text-gray-500">Cleaners</span>
                </div>
                <p className="text-2xl font-bold text-gray-900">
                  {stats.activeCleaners}
                </p>
              </div>
              {permissions?.can_view_payments && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-green-600" />
                    <span className="text-xs text-gray-500">Revenue</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    ${stats.totalRevenue}
                  </p>
                </div>
              )}
              {permissions?.can_view_analytics && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-blue-600" />
                    <span className="text-xs text-gray-500">Growth</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.monthlyGrowth}%
                  </p>
                </div>
              )}
              {permissions?.can_view_analytics && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-xs text-gray-500">Completion</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.completionRate}%
                  </p>
                </div>
              )}
              {permissions?.can_approve_decline_bookings && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span className="text-xs text-gray-500">Pending</span>
                  </div>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.pendingApprovals}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mobile Upcoming Appointments */}
        <div className="md:hidden bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary-600" />
                <h3 className="font-semibold text-gray-900">Upcoming</h3>
              </div>
              <button
                onClick={() => setActiveTab("bookings")}
                className="text-sm font-medium text-primary-600"
              >
                View all
              </button>
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {appointmentsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : upcomingAppointments.length > 0 ? (
              upcomingAppointments.map((appointment) => {
                const paymentStatusConfig = getPaymentStatusTabConfig(appointment.payment_status);
                return (
                  <div
                    key={appointment.id}
                    className="relative p-4 flex items-center gap-4 overflow-hidden pr-24"
                  >
                    {/* Payment Status Tab */}
                    <div
                      className={`absolute right-0 top-0 bottom-0 ${paymentStatusConfig.bgColor} ${paymentStatusConfig.textColor} flex items-center justify-center px-3 w-20 border-l border-gray-200`}
                    >
                      <span className="font-semibold text-xs whitespace-nowrap">
                        {paymentStatusConfig.label}
                      </span>
                    </div>
                    <div className="flex-shrink-0 w-12 h-12 bg-primary-50 rounded-xl flex flex-col items-center justify-center">
                      <span className="text-xs font-medium text-primary-600">
                        {new Date(appointment.scheduled_date).toLocaleDateString(
                          "en-US",
                          { month: "short" }
                        )}
                      </span>
                      <span className="text-lg font-bold text-primary-700">
                        {new Date(appointment.scheduled_date).getDate()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {getHomeownerName(appointment)}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <div className="flex items-center gap-1 text-sm text-gray-500">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{formatTimeTo12h(appointment.scheduled_time)}</span>
                        </div>
                        {appointment.service_type && (
                          <span className="text-sm text-gray-500">
                            {appointment.service_type.name}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={appointment.status} size="sm" />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8">
                <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">
                  No upcoming appointments
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Desktop Reschedule Required */}
        <div className="hidden md:block">
          <RescheduleRequiredSection
            appointments={rescheduleRequiredAppointments}
            loading={appointmentsLoading}
            defaultExpanded={false}
            onReschedule={(apt) => {
              setRescheduleModalAppointment(apt as AppointmentCardData);
            }}
            onViewDetails={() => {
              setActiveTab("bookings");
            }}
          />
        </div>

        {/* Desktop Quick Actions - Dashboard cards */}
        <div className="hidden md:grid md:grid-cols-1 lg:grid-cols-2 gap-6 md:items-start">
          <div className="rounded-[1.75rem] border border-amber-100 bg-white/95 p-6 shadow-sm ring-1 ring-amber-100/60 w-full">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-amber-600" />
              Awaiting Cleaner Approval
              {awaitingCleanerApprovalAppointments.length > 0 && (
                <span className="ml-auto text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                  {awaitingCleanerApprovalAppointments.length}
                </span>
              )}
            </h3>
            {appointmentsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-600">
                  Loading appointments...
                </span>
              </div>
            ) : (
              <div className="space-y-3">
                {awaitingCleanerApprovalAppointments.slice(0, 3).map((appointment) => {
                  const cleanerName = getCleanerName(appointment);
                  return (
                    <div
                      key={appointment.id}
                      className="flex items-center gap-4 p-4 bg-gradient-to-r from-amber-50/60 via-white to-white rounded-2xl border border-amber-100 shadow-sm"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate">
                          {cleanerName ?? "Unassigned"}
                        </p>
                        <p className="text-sm text-gray-500 mt-0.5">
                          {formatDateTimeTo12h(appointment.scheduled_date, appointment.scheduled_time)}
                        </p>
                        <p className="text-sm text-gray-500">
                          Homeowner: {getHomeownerName(appointment)}
                        </p>
                      </div>
                      {cleanerName && appointment.cleaner_profile?.user_profile?.id && (
                        <button
                          onClick={() => handleMessageCleaner(appointment)}
                          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-primary-50 text-primary-700 border border-primary-200 rounded-xl hover:bg-primary-100 transition-colors font-medium text-sm whitespace-nowrap"
                        >
                          <MessageCircle className="w-4 h-4" />
                          Message
                        </button>
                      )}
                    </div>
                  );
                })}
                {awaitingCleanerApprovalAppointments.length === 0 && (
                  <div className="text-center py-8">
                    <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-2" />
                    <p className="text-gray-600">All cleaners confirmed</p>
                  </div>
                )}
                {awaitingCleanerApprovalAppointments.length > 3 && (
                  <div className="pt-3 border-t border-gray-200">
                    <button
                      onClick={() => {
                        setShowPendingFilter(true);
                        setActiveTab("bookings");
                      }}
                      className="w-full text-center text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
                    >
                      View all {awaitingCleanerApprovalAppointments.length} awaiting approval
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="rounded-[1.75rem] border border-amber-100 bg-white/95 p-6 shadow-sm ring-1 ring-amber-100/60 w-full">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary-600" />
                <span>Upcoming Appointments</span>
              </h3>
              {appointmentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-600">
                    Loading appointments...
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingAppointments.slice(0, 3).map((appointment) => {
                    const paymentStatusConfig = getPaymentStatusTabConfig(appointment.payment_status);
                    return (
                      <div
                        key={appointment.id}
                        className="relative flex items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-amber-50/60 via-white to-white border border-amber-100 shadow-sm overflow-hidden pr-24"
                      >
                        {/* Payment Status Tab */}
                        <div
                          className={`absolute right-0 top-0 bottom-0 ${paymentStatusConfig.bgColor} ${paymentStatusConfig.textColor} flex items-center justify-center px-3 w-20 border-l border-gray-200`}
                        >
                          <span className="font-semibold text-xs whitespace-nowrap">
                            {paymentStatusConfig.label}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {getHomeownerName(appointment)}
                          </p>
                          <p className="text-sm text-gray-600">
                            {formatDateTimeTo12h(
                              appointment.scheduled_date,
                              appointment.scheduled_time
                            )}
                          </p>
                          <p className="text-sm text-gray-600">
                            {getPropertyAddress(appointment)}
                          </p>
                          {appointment.service_type && (
                            <p className="text-sm text-gray-600">
                              Service: {appointment.service_type.name}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={appointment.status} size="sm" />
                        </div>
                      </div>
                    );
                  })}
                  {upcomingAppointments.length === 0 && (
                    <div className="text-center py-8">
                      <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                      <p className="text-gray-600">No upcoming appointments</p>
                    </div>
                  )}
                  {allUpcomingAppointments.length > 3 && (
                    <div className="pt-3 border-t border-gray-200">
                      <button
                        onClick={() => {
                          setShowAllFilter(true);
                          setActiveTab("bookings");
                        }}
                        className="w-full text-center text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
                      >
                        View all {allUpcomingAppointments.length} upcoming
                      </button>
                    </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );

  const renderBookings = () => {
    // Determine initial status filter based on which "View All" was clicked
    let initialFilter: string | undefined;
    if (showPendingFilter) {
      initialFilter = "pending";
    } else if (showAllFilter) {
      initialFilter = "all";
    }
    
    return (
      <BookingsPage
        appointments={appointments}
        loading={appointmentsLoading}
        onCancelAppointment={handleCancelAppointment}
        onDeleteAppointment={handleDeleteAppointment}
        onMarkComplete={handleMarkComplete}
        onRefreshAppointments={refetchAppointments}
        onAppointmentUpdated={(id, data) => updateAppointmentInState(id, data)}
        role="manager"
        canApproveDecline={permissions?.can_approve_decline_bookings ?? false}
        initialStatusFilter={initialFilter}
        organizationId={currentOrganizationId || ""}
      />
    );
  };

  const handleDeleteCleaner = async () => {
    if (!deleteConfirmModal.cleanerId) return;

    setIsDeleting(true);
    const result = await deleteCleaner(deleteConfirmModal.cleanerId);
    setIsDeleting(false);

    if (result.success) {
      setDeleteConfirmModal({
        isOpen: false,
        cleanerId: null,
        cleanerName: "",
      });
      await refetchCleaners();
    } else {
      alert("Failed to delete cleaner: " + result.error);
    }
  };

  const renderCleaners = () => {
    // Check permission
    if (!permissions?.can_manage_cleaners) {
      return renderAccessDenied("cleaner management");
    }

    // Filter cleaners based on search and availability
    const filteredCleaners = cleaners.filter((cleaner) => {
      // Search filter
      const fullName = cleaner.user_profile
        ? `${cleaner.user_profile.first_name} ${cleaner.user_profile.last_name}`.toLowerCase()
        : "";
      const email = (cleaner.user_profile?.email || "").toLowerCase();
      const phone = (cleaner.user_profile?.phone || "").toLowerCase();
      const query = searchQuery.toLowerCase();

      const matchesSearch =
        searchQuery === "" ||
        fullName.includes(query) ||
        email.includes(query) ||
        phone.includes(query);

      // Availability filter
      const matchesAvailability =
        availabilityFilter === "all" ||
        (availabilityFilter === "available" && cleaner.is_available) ||
        (availabilityFilter === "unavailable" && !cleaner.is_available);

      return matchesSearch && matchesAvailability;
    });

    // Calculate stats
    const availableCleaners = cleaners.filter((c) => c.is_available).length;
    const avgRating =
      cleaners.length > 0
        ? cleaners.reduce((sum, c) => sum + c.rating, 0) / cleaners.length
        : 0;

    // Get cleaner initials for avatar
    const getCleanerInitials = (cleaner: any) => {
      const first = cleaner.user_profile?.first_name?.[0] || "";
      const last = cleaner.user_profile?.last_name?.[0] || "";
      return `${first}${last}`.toUpperCase() || "?";
    };

    // Get full name helper
    const getCleanerFullName = (cleaner: any) => {
      if (cleaner.user_profile) {
        return `${cleaner.user_profile.first_name} ${cleaner.user_profile.last_name}`;
      }
      return "Unknown";
    };

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-4xl font-bold text-gray-900">Cleaners</h2>
            <p className="text-gray-600 mt-1 hidden md:block">
              Manage your cleaning team members
            </p>
          </div>
          {permissions?.can_manage_cleaners && (
            <button
              onClick={() => setShowAddCleanerModal(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors whitespace-nowrap shadow-md"
            >
              <UserCheck className="w-5 h-5" />
              <span>New</span>
            </button>
          )}
        </div>

        {/* Search Input - Own line on mobile */}
        <div className="flex-1 relative md:hidden">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
          />
        </div>

        {/* Filters Row - Mobile: Filters inline, Desktop: All in one line with search */}
        <div className="flex flex-row gap-3 overflow-x-auto">
          {/* Search Input - Desktop only (in same line as filters) */}
          <div className="hidden md:flex flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search by name, email, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
            />
          </div>

          {/* Availability Filter Dropdown */}
          <div className="relative flex-shrink-0 min-w-[140px]">
            <select
              value={availabilityFilter}
              onChange={(e) =>
                setAvailabilityFilter(
                  e.target.value as "all" | "available" | "unavailable"
                )
              }
              className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm appearance-none"
            >
              <option value="all">All Cleaners</option>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Stats Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <Users className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Total Cleaners</p>
                <p className="text-xl font-bold text-gray-900">
                  {cleaners.length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Available</p>
                <p className="text-xl font-bold text-gray-900">
                  {availableCleaners}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Star className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Avg Rating</p>
                <p className="text-xl font-bold text-gray-900">
                  {avgRating.toFixed(1)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Cleaners List */}
        {cleanersLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Loading cleaners...</span>
          </div>
        ) : cleanersError ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Error loading cleaners
            </h3>
            <p className="text-gray-600">{cleanersError}</p>
          </div>
        ) : filteredCleaners.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
            <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchQuery || availabilityFilter !== "all"
                ? "No cleaners found"
                : "No cleaners yet"}
            </h3>
            <p className="text-gray-600">
              {searchQuery || availabilityFilter !== "all"
                ? "Try adjusting your search or filter criteria"
                : "Add your first cleaner to get started"}
            </p>
            {!searchQuery &&
              availabilityFilter === "all" &&
              permissions?.can_manage_cleaners && (
                <button
                  onClick={() => setShowAddCleanerModal(true)}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
                >
                  <UserCheck className="w-5 h-5" />
                  Add Cleaner
                </button>
              )}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredCleaners.map((cleaner) => (
              <div
                key={cleaner.id}
                onClick={() => {
                  setSelectedCleaner(cleaner);
                  setIsCleanerSidePanelOpen(true);
                }}
                className="bg-white border rounded-lg p-5 hover:shadow-md transition-shadow relative cursor-pointer"
              >
                {/* Delete button - top right */}
                <div
                  className="absolute top-4 right-4"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() =>
                      setDeleteConfirmModal({
                        isOpen: true,
                        cleanerId: cleaner.id,
                        cleanerName: getCleanerFullName(cleaner),
                      })
                    }
                    className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors flex items-center justify-center min-w-[44px] min-h-[44px]"
                    aria-label="Delete Cleaner"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>

                {/* Avatar and Name */}
                <div className="flex items-start gap-3 mb-4 pr-14">
                  {cleaner.user_profile?.avatar_url ? (
                    <img
                      src={cleaner.user_profile.avatar_url}
                      alt=""
                      className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-primary-600 font-semibold text-sm">
                        {getCleanerInitials(cleaner)}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-gray-900 truncate">
                      {getCleanerFullName(cleaner)}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          cleaner.is_available
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {cleaner.is_available ? "Available" : "Unavailable"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Mail className="w-4 h-4 text-gray-400" />
                    <span className="truncate">
                      {cleaner.user_profile?.email}
                    </span>
                  </div>
                </div>

                {/* Verification Badges */}
                {(cleaner.background_check_verified ||
                  cleaner.insurance_verified) && (
                  <div className="flex items-center flex-wrap gap-2 mb-4">
                    {cleaner.background_check_verified && (
                      <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Background Check
                      </span>
                    )}
                    {cleaner.insurance_verified && (
                      <span className="inline-flex items-center px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Insured
                      </span>
                    )}
                  </div>
                )}

                {/* Stats */}
                <div className="flex items-center flex-wrap gap-3 pt-4 border-t border-gray-100">
                  <div className="flex items-center gap-1.5">
                    <Star className="w-4 h-4 text-yellow-400 fill-current flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-900">
                      {cleaner.rating.toFixed(1)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {cleaner.total_jobs} jobs
                  </div>
                  {cleaner.hourly_rate && (
                    <div className="text-sm text-gray-600">
                      ${cleaner.hourly_rate}/hr
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderPayments = () => (
    <div className="card">
      <h2 className="text-4xl font-bold text-gray-900 mb-6">
        Payment Management
      </h2>
      {paymentsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : paymentsError ? (
        <div className="text-center py-12">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <p className="text-gray-600">{paymentsError}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Service
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {new Date(payment.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {payment.appointment?.homeowner
                      ? `${payment.appointment.homeowner.first_name} ${payment.appointment.homeowner.last_name}`
                      : "N/A"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {payment.appointment?.service_type?.name || "N/A"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${payment.amount}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        payment.status === "paid"
                          ? "text-green-600 bg-green-100"
                          : payment.status === "pending"
                          ? "text-yellow-600 bg-yellow-100"
                          : "text-red-600 bg-red-100"
                      }`}
                    >
                      {payment.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const renderMessages = () => (
    <MessagesPage
      userId={user.id}
      userRole="manager"
      conversations={conversations}
      loading={conversationsLoading}
      error={conversationsError}
      onRefresh={refetchConversations}
      onUpdateUnreadCount={updateUnreadCount}
      initialOtherParticipantId={initialMessageRecipientId ?? undefined}
      onInitialParticipantConsumed={() => setInitialMessageRecipientId(null)}
    />
  );

  const renderPlaceholder = (title: string, description: string) => (
    <div className="card text-center py-16">
      <div className="mb-4 inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary-100">
        <Settings className="w-8 h-8 text-primary-600" />
      </div>
      <h2 className="text-4xl font-bold text-gray-900 mb-2">{title}</h2>
      <p className="text-gray-600 max-w-md mx-auto">{description}</p>
    </div>
  );

  const renderAccessDenied = (feature: string) => (
    <div className="card text-center py-16">
      <div className="mb-4 inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100">
        <AlertCircle className="w-8 h-8 text-red-600" />
      </div>
      <h2 className="text-4xl font-bold text-gray-900 mb-2">Access Denied</h2>
      <p className="text-gray-600 max-w-md mx-auto mb-6">
        You don't have permission to access {feature}. Please contact your
        administrator to request access.
      </p>
      <button
        onClick={() => {
          setActiveTab("home");
          setActiveGroup("operations");
        }}
        className="btn-primary"
      >
        Go to Overview
      </button>
    </div>
  );

  const renderContent = () => {
    // Check permissions before rendering
    if (!permissionsLoading && permissions && !isTabAccessible(activeTab)) {
      return renderAccessDenied("this feature");
    }

    switch (activeTab) {
      case "home":
        return renderOverview();
      case "bookings":
        if (!permissions?.can_view_bookings) {
          return renderAccessDenied("bookings");
        }
        return renderBookings();
      case "messages":
        if (!permissions?.can_view_messages) {
          return renderAccessDenied("messages");
        }
        return renderMessages();
      case "customers":
        if (!permissions?.can_view_customers) {
          return renderAccessDenied("customers");
        }
        return (
          <CustomersPage
            customers={customers}
            loading={customersLoading}
            error={customersError}
            onRefreshCustomers={refetchCustomers}
            onCustomerUpdated={updateCustomerInState}
            role="manager"
            canEdit={permissions?.can_edit_customers || false}
          />
        );
      case "cleaners":
        if (!permissions?.can_manage_cleaners) {
          return renderAccessDenied("cleaner management");
        }
        return renderCleaners();
      case "team":
        if (!permissions?.can_manage_cleaners) {
          return renderAccessDenied("team member management");
        }
        return (
          <TeamMembersPage
            teamMembers={teamMembers}
            loading={teamMembersLoading}
            error={teamMembersError}
            onRefresh={refetchTeamMembers}
            onMemberUpdated={updateTeamMemberInState}
          />
        );
      case "payments":
        if (!permissions?.can_view_payments) {
          return renderAccessDenied("payments");
        }
        return renderPayments();
      case "analytics":
        if (!permissions?.can_view_analytics) {
          return renderAccessDenied("analytics");
        }
        return <AnalyticsPage role="manager" />;
      case "properties":
        if (!permissions?.can_view_properties) {
          return renderAccessDenied("properties");
        }
        return renderPlaceholder(
          "Property Management",
          "Manage properties and access details."
        );
      case "services":
        if (!permissions?.can_view_services) {
          return renderAccessDenied("services");
        }
        return (
          <ServicesPage
            services={services}
            loading={servicesLoading}
            error={servicesError}
            refetch={refetchServices}
            canManageServices={permissions?.can_manage_services || false}
            updateServiceInState={updateServiceInState}
          />
        );
      case "settings":
        return null; // Settings is rendered separately and pre-mounted below
      default:
        return renderOverview();
    }
  };

  return (
    <div
      className={`min-h-screen ${
        activeTab === "messages" ? "bg-white md:bg-gray-100" : "bg-gray-100"
      }`}
    >
      {/* Persistent Desktop Sidebar - Shows Groups */}
      <DesktopSidebar
        groups={groups}
        activeGroup={activeGroup}
        onGroupChange={handleGroupChange}
        onLogout={handleLogout}
        user={user}
        activeTab={activeTab}
      />

      {/* Main Content Wrapper with Sidebar Offset */}
      <div className="md:ml-[260px] pt-4 md:pt-16">
        {/* Top Bar - Shows Tabs Within Selected Group - Hide on mobile for all tabs */}
        <div className="hidden md:block">
          <TopBar
            role="manager"
            user={user}
            tabs={topNavTabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            onMobileMenuClick={() => setIsSidebarOpen(true)}
            profileClickNavigatesToSettings
            showSettingsIcon
          />
        </div>

        {/* Main Content Area - Settings page is always mounted so it's ready when user clicks */}
        <main
          className={`${
            activeTab === "messages"
              ? "p-0 md:p-4 md:sm:p-6 md:lg:p-8"
              : "p-4 sm:p-6 lg:p-8"
          } pb-24 md:pb-8`}
        >
          <div className={activeTab === "settings" ? "block" : "hidden"}>
            <SettingsHub />
          </div>
          {activeTab !== "settings" && renderContent()}
        </main>
      </div>

      {/* Mobile Bottom Navigation - Show first 4 tabs */}
      <MobileNavigation
        tabs={navigationGroups.operations.tabs.filter((tab) => tab.id !== "services")}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onMenuClick={() => setIsSidebarOpen(true)}
      />

      {/* Mobile Sidebar Menu - Show All Tabs */}
      <MobileSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        role="manager"
        tabs={allTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Modals */}
      <AddCleanerModal
        isOpen={showAddCleanerModal}
        onClose={() => setShowAddCleanerModal(false)}
      />

      <DeleteConfirmModal
        isOpen={deleteConfirmModal.isOpen}
        onClose={() =>
          setDeleteConfirmModal({
            isOpen: false,
            cleanerId: null,
            cleanerName: "",
          })
        }
        onConfirm={handleDeleteCleaner}
        title="Delete Cleaner"
        message="Are you sure you want to delete this cleaner? This action cannot be undone."
        itemName={deleteConfirmModal.cleanerName}
        isLoading={isDeleting}
      />

      <CleanerSidePanel
        isOpen={isCleanerSidePanelOpen}
        onClose={() => {
          setIsCleanerSidePanelOpen(false);
          setSelectedCleaner(null);
        }}
        cleaner={selectedCleaner}
        onDelete={(cleaner) => {
          setIsCleanerSidePanelOpen(false);
          setDeleteConfirmModal({
            isOpen: true,
            cleanerId: cleaner.id,
            cleanerName: getCleanerFullName(cleaner),
          });
        }}
        onCleanerUpdated={(updatedCleaner) => {
          // Update selected cleaner immediately
          setSelectedCleaner(updatedCleaner);
          // Update in list state without refetch
          updateCleanerInState(updatedCleaner.id, updatedCleaner);
        }}
      />

      <RescheduleAppointmentModal
        isOpen={!!rescheduleModalAppointment}
        onClose={() => setRescheduleModalAppointment(null)}
        onRescheduleComplete={refetchAppointments}
        appointment={rescheduleModalAppointment}
        organizationId={currentOrganizationId || ""}
      />
    </div>
  );
}
