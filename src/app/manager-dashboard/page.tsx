"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  Suspense,
} from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../contexts/ToastContext";
import { isAppointmentOverdue } from "../../lib/isAppointmentOverdue";
import {
  Calendar,
  Users,
  MessageCircle,
  DollarSign,
  AlertCircle,
  Star,
  Loader2,
  Home,
  UserCheck,
  TrendingUp,
  Building,
  LayoutGrid,
  BarChart3,
  Briefcase,
  Mail,
} from "lucide-react";
import {
  useManagerAppointments,
  useManagerCleaners,
  deleteCleaner,
  cancelAppointment,
  deleteAppointment,
  updateAppointmentStatus,
} from "../../hooks/useManagerData";
import {
  useAdminCustomers,
  useAdminTeamMembers,
  useAdminProperties,
  useAdminPayments,
  useAdminPayouts,
  useAdminInvoices,
  usePaymentStats,
} from "../../hooks/useAdminData";
import { useServices } from "../../hooks/useServices";
import { useInvites } from "../../hooks/useInvites";
import { useConversations } from "../../hooks/useConversations";
import { useManagerPermissions } from "../../hooks/useManagerPermissions";
import {
  DASHBOARD_HERO_BACKGROUND,
  dashboardHeroCardDesktopClass,
  dashboardHeroCardMobileClass,
} from "../../lib/dashboardHero";
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
import InvitesPage from "../../components/InvitesPage";
import CleanerManagementPage from "../../components/CleanerManagementPage";
import AnalyticsPage from "../../components/AnalyticsPage";
import PaymentsPage from "../../components/PaymentsPage";
import PropertiesPage from "../../components/PropertiesPage";
import ServicesPage from "../../components/ServicesPage";
import ActionRequiredSection from "../../components/admin-dashboard/ActionRequiredSection";
import RescheduleAppointmentModal from "../../components/RescheduleAppointmentModal";
import { AppointmentCardData } from "../../components/AppointmentCard";
import AwaitingApprovalSection from "../../components/AwaitingApprovalSection";
import UpcomingAppointmentsSection from "../../components/UpcomingAppointmentsSection";
import TodayScheduleSection from "../../components/TodayScheduleSection";
import ActiveNowSection from "../../components/ActiveNowSection";
import {
  ADMIN_MANAGER_DASHBOARD_TAB_IDS,
  ADMIN_MANAGER_DEFAULT_GROUP,
  ADMIN_MANAGER_TAB_TO_GROUP,
  usePersistedDashboardTab,
} from "../../hooks/usePersistedDashboardTab";
import { useAppointmentPanel } from "../../hooks/useAppointmentPanel";
import AppointmentPanelHost from "../../components/AppointmentPanelHost";

function ManagerDashboardInner() {
  const { user, loading, signOut, currentOrganizationId, accessToken } = useAuth();
  const [activeTab, setActiveTab] = usePersistedDashboardTab(
    "home",
    ADMIN_MANAGER_DASHBOARD_TAB_IDS,
  );
  const {
    appointmentId: openAppointmentId,
    isOpen: isAppointmentPanelOpen,
    openAppointment,
    closeAppointment,
  } = useAppointmentPanel();
  // Lazy-load invites: stays mounted at dashboard level once first opened, so
  // tab switches don't re-fetch and the Realtime channel survives navigation.
  const [hasOpenedInvitesEver, setHasOpenedInvitesEver] = useState(
    activeTab === "invites",
  );
  useEffect(() => {
    if (activeTab === "invites") setHasOpenedInvitesEver(true);
  }, [activeTab]);
  const activeGroup = useMemo(
    () => ADMIN_MANAGER_TAB_TO_GROUP[activeTab] ?? ADMIN_MANAGER_DEFAULT_GROUP,
    [activeTab],
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showPendingFilter, setShowPendingFilter] = useState(false);
  const [showAllFilter, setShowAllFilter] = useState(false);
  const [showAddCleanerModal, setShowAddCleanerModal] = useState(false);
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
  const [initialMessageRecipientId, setInitialMessageRecipientId] = useState<
    string | null
  >(null);
  const [rescheduleModalAppointment, setRescheduleModalAppointment] =
    useState<AppointmentCardData | null>(null);
  const router = useRouter();
  const { showToast } = useToast();

  // Real data hooks - must be called at top level
  const {
    appointments,
    loading: appointmentsLoading,
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
    refetch: refetchPayments,
  } = useAdminPayments();
  const {
    payouts,
    loading: payoutsLoading,
    refetch: refetchPayouts,
  } = useAdminPayouts();
  const {
    invoices,
    loading: invoicesLoading,
    refetch: refetchInvoices,
  } = useAdminInvoices();
  const { stats: paymentStats, loading: paymentStatsLoading } =
    usePaymentStats();
  const {
    conversations,
    loading: conversationsLoading,
    error: conversationsError,
    refetch: refetchConversations,
    updateUnreadCount,
  } = useConversations({ userId: user?.id || "" });
  const { permissions, loading: permissionsLoading } = useManagerPermissions();
  const {
    properties,
    loading: propertiesLoading,
    error: propertiesError,
    refetch: refetchProperties,
    updatePropertyInState,
  } = useAdminProperties();
  const {
    services,
    loading: servicesLoading,
    error: servicesError,
    refetch: refetchServices,
    updateServiceInState,
    maxChecklistAdderByServiceId,
    refreshMaxChecklistAdders,
  } = useServices();
  const {
    invites,
    loading: invitesLoading,
    error: invitesError,
    refetch: refetchInvites,
    resend: resendInvite,
  } = useInvites(currentOrganizationId, accessToken, {
    enabled: hasOpenedInvitesEver && permissions?.can_manage_cleaners === true,
  });


  // Check if a tab is accessible based on permissions - MUST be a hook and defined before early returns
  const isTabAccessible = useCallback(
    (tabId: string): boolean => {
      if (!permissions) return false;

      switch (tabId) {
        case "home":
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
        case "invites":
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
    [permissions],
  );

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

  // Wave 2 SLA: count cleaner-rejected + overdue appointments to drive the
  // Bookings nav-dot and the on-mount overdue toast.
  const needsResponseCount = useMemo(() => {
    const now = new Date();
    return appointments.filter((apt) => {
      if (apt.status === "cancelled" || apt.status === "completed") return false;
      if (apt.cleaner_confirmation_status === "rejected") return true;
      return isAppointmentOverdue(
        {
          status: apt.status,
          cleaner_confirmation_status: apt.cleaner_confirmation_status,
          response_deadline: apt.response_deadline,
        },
        now,
      );
    }).length;
  }, [appointments]);

  const overdueCount = useMemo(() => {
    const now = new Date();
    return appointments.filter((apt) =>
      isAppointmentOverdue(
        {
          status: apt.status,
          cleaner_confirmation_status: apt.cleaner_confirmation_status,
          response_deadline: apt.response_deadline,
        },
        now,
      ),
    ).length;
  }, [appointments]);

  const overdueToastFiredRef = useRef(false);
  useEffect(() => {
    if (appointmentsLoading) return;
    if (overdueToastFiredRef.current) return;
    if (overdueCount === 0) return;
    overdueToastFiredRef.current = true;
    showToast(
      `${overdueCount} appointment${overdueCount === 1 ? "" : "s"} awaiting cleaner response past SLA`,
      {
        variant: "error",
        description: "Check the Bookings tab to reassign.",
        duration: 6000,
      },
    );
  }, [appointmentsLoading, overdueCount, showToast]);

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
      opsTabs.push({
        id: "bookings",
        label: "Bookings",
        icon: Calendar,
        ...(needsResponseCount > 0 ? { hasNotification: true } : {}),
      });
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
          { id: "cleaners", label: "Cleaner Management", icon: UserCheck },
          { id: "invites", label: "Invites", icon: Mail },
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
  }, [permissions, permissionsLoading, hasUnreadMessages, needsResponseCount]);

  // Get groups array for sidebar
  const groups = useMemo(
    () => Object.values(navigationGroups),
    [navigationGroups],
  );

  // Get tabs for current group
  const currentGroupTabs = useMemo(
    () =>
      navigationGroups[activeGroup as keyof typeof navigationGroups]?.tabs ||
      [],
    [navigationGroups, activeGroup],
  );

  // Filter out "customers" and "messages" from top nav — messages use TopBar icon (cleaner pattern)
  const topNavTabs = useMemo(
    () =>
      activeGroup === "operations"
        ? currentGroupTabs.filter(
            (tab) => tab.id !== "customers" && tab.id !== "messages",
          )
        : currentGroupTabs,
    [currentGroupTabs, activeGroup],
  );

  // Get all tabs for mobile (deduplicate by id to avoid duplicates when tab appears in multiple groups)
  const allTabs = useMemo(() => {
    const tabs = Array.from(
      new Map(
        groups.flatMap((g) => g.tabs).map((tab) => [tab.id, tab]),
      ).values(),
    );
    return tabs;
  }, [groups]);

  // Handle group change - switch to first tab of new group (group derives from tab via ADMIN_MANAGER_TAB_TO_GROUP)
  const handleGroupChange = useCallback(
    (groupId: string) => {
      const newGroup =
        navigationGroups[groupId as keyof typeof navigationGroups];
      if (newGroup && newGroup.tabs.length > 0) {
        const firstTab =
          groupId === "team"
            ? (newGroup.tabs.find((tab) => tab.id === "team")?.id ??
              newGroup.tabs[0].id)
            : newGroup.tabs[0].id;
        // Check if tab is accessible
        if (isTabAccessible(firstTab)) {
          setActiveTab(firstTab);
        } else {
          // Find first accessible tab
          const accessibleTab = newGroup.tabs.find((tab) =>
            isTabAccessible(tab.id),
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
    [navigationGroups, isTabAccessible, setActiveTab],
  );

  // Handle tab change - reset filters if not navigating from specific sections
  const handleTabChange = useCallback(
    (tabId: string) => {
      setActiveTab(tabId);
      // Only keep filters if we're staying on bookings tab
      if (tabId !== "bookings") {
        setShowPendingFilter(false);
        setShowAllFilter(false);
      }
    },
    [setActiveTab],
  );

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
      }
    }
  }, [permissions, permissionsLoading, activeTab, isTabAccessible, setActiveTab]);

  // Scroll to top when tab changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  // Show loading while checking auth and permissions - MUST be after all hooks
  if (loading || !user || permissionsLoading || !permissions) {
    return (
      <div className="min-h-screen bg-white md:bg-gray-100 flex items-center justify-center">
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

      // Strictly future appointments (after today) that are confirmed.
      // Today's appointments live in the Today's Schedule section.
      return appointmentDate > today && a.status === "confirmed";
    })
    .sort((a, b) => {
      const dateA = new Date(`${a.scheduled_date}T${a.scheduled_time}`);
      const dateB = new Date(`${b.scheduled_date}T${b.scheduled_time}`);
      return dateA.getTime() - dateB.getTime();
    });

  const upcomingAppointments = allUpcomingAppointments.slice(0, 5);

  const todaysAppointments = appointments
    .filter((a) => {
      const [year, month, day] = a.scheduled_date.split("-").map(Number);
      const appointmentDate = new Date(year, month - 1, day);
      appointmentDate.setHours(0, 0, 0, 0);
      return (
        appointmentDate.getTime() === today.getTime() &&
        a.status !== "cancelled" &&
        a.status !== "in_progress"
      );
    })
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

  const activeJobsManager = appointments
    .filter((a) => a.status === "in_progress")
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

  // Appointments awaiting cleaner confirmation — shown in the
  // AwaitingApprovalSection (informational). The unified ActionRequiredSection
  // surfaces items where the *admin/manager* needs to act.
  const awaitingCleanerApprovalAppointments = appointments
    .filter((a) => {
      if (!a.cleaner_id) return false;
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
    setActiveTab("messages");
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
      {/* Mobile Header - Gradient Card Match (Mini Desktop) */}
      <div className="md:hidden mb-6 mt-2">
        <div
          className={dashboardHeroCardMobileClass}
          style={DASHBOARD_HERO_BACKGROUND}
        >
          <div className="relative">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-white/80 px-2.5 py-0.5 text-[10px] font-semibold text-primary-700 uppercase tracking-wider">
              <Star className="h-3 w-3" />
              Manager Dashboard
            </div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
              Hello, {user?.profile?.firstName || "Manager"}
            </h2>
            <p className="text-gray-600 mt-1 text-sm font-medium">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
        </div>
      </div>

      {/* Desktop Header - Modern control center hero (no stat tiles) */}
      <div className="hidden md:block mb-6">
        <div
          className={dashboardHeroCardDesktopClass}
          style={DASHBOARD_HERO_BACKGROUND}
        >
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary-100 bg-white/80 px-3 py-1 text-xs font-semibold text-primary-700">
                <Star className="h-3.5 w-3.5" />
                Manager Dashboard
              </div>
              <h2 className="text-4xl font-bold tracking-tight text-gray-900">
                Hello, {user?.profile?.firstName || "Manager"}
              </h2>
              <p className="mt-2 text-gray-600 font-medium">
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {permissions?.can_view_analytics && (
                <button
                  onClick={() => setActiveTab("analytics")}
                  className="rounded-xl border border-primary-200 bg-white/90 px-4 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50"
                >
                  Open analytics
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <ActionRequiredSection
          onReassign={(item) => {
            const apt = appointments.find((a) => a.id === item.id);
            if (apt) setRescheduleModalAppointment(apt as AppointmentCardData);
          }}
        />

        {activeJobsManager.length > 0 && (
          <ActiveNowSection
            appointments={activeJobsManager as unknown as AppointmentCardData[]}
            loading={appointmentsLoading}
            onAppointmentClick={(apt) => openAppointment(apt.id)}
          />
        )}

        <div className="space-y-6">
          <TodayScheduleSection
            appointments={todaysAppointments as unknown as AppointmentCardData[]}
            loading={appointmentsLoading}
            onViewAll={() => setActiveTab("bookings")}
            onAppointmentClick={(apt) => openAppointment(apt.id)}
          />
          <UpcomingAppointmentsSection
            appointments={upcomingAppointments as unknown as AppointmentCardData[]}
            totalCount={allUpcomingAppointments.length}
            loading={appointmentsLoading}
            onViewAll={() => {
              setShowAllFilter(true);
              setActiveTab("bookings");
            }}
            onAppointmentClick={(apt) => openAppointment(apt.id)}
          />
        </div>

        <AwaitingApprovalSection
          appointments={awaitingCleanerApprovalAppointments as unknown as AppointmentCardData[]}
          loading={appointmentsLoading}
          onMessageCleaner={(apt) =>
            handleMessageCleaner(apt as unknown as (typeof appointments)[0])
          }
          onViewAll={() => {
            setShowPendingFilter(true);
            setActiveTab("bookings");
          }}
          onAppointmentClick={(apt) => openAppointment(apt.id)}
        />
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
        onRefreshAppointments={refetchAppointments}
        onAppointmentUpdated={(id, data) => updateAppointmentInState(id, data)}
        onOpenAppointment={openAppointment}
        onRescheduleRejected={(apt) => setRescheduleModalAppointment(apt)}
        role="manager"
        canApproveDecline={permissions?.can_approve_decline_bookings ?? false}
        initialStatusFilter={initialFilter}
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

  const renderCleaners = () => (
    <CleanerManagementPage
      cleaners={cleaners}
      loading={cleanersLoading}
      error={cleanersError}
      canManage={permissions?.can_manage_cleaners ?? false}
      onCleanerUpdated={(c) => updateCleanerInState(c.id, c)}
      onDeleteRequest={(id, name) =>
        setDeleteConfirmModal({
          isOpen: true,
          cleanerId: id,
          cleanerName: name,
        })
      }
      onAddCleaner={() => setShowAddCleanerModal(true)}
      onBulkPayoutsUpdated={(updates) =>
        updates.forEach(({ id, payout_percent }) =>
          updateCleanerInState(id, { payout_percent }),
        )
      }
    />
  );

  const renderPayments = () => (
    <PaymentsPage
      payments={payments}
      payouts={payouts}
      invoices={invoices}
      stats={paymentStats}
      paymentsLoading={paymentsLoading}
      payoutsLoading={payoutsLoading}
      invoicesLoading={invoicesLoading}
      statsLoading={paymentStatsLoading}
      onRefreshPayments={refetchPayments}
      onRefreshPayouts={refetchPayouts}
      onRefreshInvoices={refetchInvoices}
    />
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
      onSelectedConversationChange={setSelectedMessagesConversationId}
      initialOtherParticipantId={initialMessageRecipientId ?? undefined}
      onInitialParticipantConsumed={() => setInitialMessageRecipientId(null)}
    />
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
      case "invites":
        if (!permissions?.can_manage_cleaners) {
          return renderAccessDenied("invites");
        }
        return (
          <InvitesPage
            canResend={permissions?.can_manage_cleaners === true}
            invites={invites}
            loading={invitesLoading}
            error={invitesError}
            refetch={refetchInvites}
            resend={resendInvite}
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
        return (
          <PropertiesPage
            properties={properties}
            loading={propertiesLoading}
            error={propertiesError}
            onRefreshProperties={refetchProperties}
            onPropertyUpdated={updatePropertyInState}
            onRefreshAppointments={refetchAppointments}
            role="manager"
          />
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
            maxChecklistAdderByServiceId={maxChecklistAdderByServiceId}
            refreshMaxChecklistAdders={refreshMaxChecklistAdders}
          />
        );
      default:
        return renderOverview();
    }
  };

  return (
    <div className="min-h-screen bg-white md:bg-gray-100">
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
            showMessagesIcon={permissions?.can_view_messages === true}
            hasUnreadMessages={hasUnreadMessages}
            showSettingsIcon
          />
        </div>

        <main
          className={`${
            activeTab === "messages"
              ? "p-0 md:p-4 md:sm:p-6 md:lg:p-8"
              : "p-4 sm:p-6 lg:p-8"
          } pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-8`}
        >
          {renderContent()}
        </main>
      </div>

      {/* Mobile Bottom Navigation - Show first 4 tabs */}
      <MobileNavigation
        tabs={navigationGroups.operations.tabs.filter(
          (tab) => tab.id !== "services",
        )}
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

      <RescheduleAppointmentModal
        isOpen={!!rescheduleModalAppointment}
        onClose={() => setRescheduleModalAppointment(null)}
        onRescheduleComplete={refetchAppointments}
        appointment={rescheduleModalAppointment}
        organizationId={currentOrganizationId || ""}
      />

      <AppointmentPanelHost
        appointments={appointments as unknown as AppointmentCardData[]}
        appointmentId={openAppointmentId}
        isOpen={isAppointmentPanelOpen}
        onClose={closeAppointment}
        role="manager"
        canApproveDecline={permissions?.can_approve_decline_bookings ?? false}
        onCancelAppointment={handleCancelAppointment}
        onDeleteAppointment={handleDeleteAppointment}
        onMarkComplete={handleMarkComplete}
        onRefreshAppointments={refetchAppointments}
        onAppointmentUpdated={(id, data) => updateAppointmentInState(id, data)}
        onRescheduleRejected={(apt) => setRescheduleModalAppointment(apt)}
      />
    </div>
  );
}

export default function ManagerDashboard() {
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
      <ManagerDashboardInner />
    </Suspense>
  );
}
