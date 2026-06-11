"use client";

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  Suspense,
} from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useAuth } from "../../hooks/useAuth";
import WorkspaceErrorScreen from "../../components/WorkspaceErrorScreen";
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
  Building,
  BarChart3,
  Briefcase,
  Mail,
  Plus,
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
  deleteAppointments,
  cancelAppointments,
  describeBulkAppointmentResult,
} from "../../lib/bulkAppointments";
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
import MobileTopBar from "../../components/MobileTopBar";
import MobileSidebar from "../../components/MobileSidebar";
import DesktopSidebar from "../../components/DesktopSidebar";
import NewBookingButton from "../../components/NewBookingButton";
import ScrollAwareFab from "../../components/ScrollAwareFab";
import AddCleanerModal from "../../components/AddCleanerModal";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import { useReopenableModalUrl } from "../../hooks/useReopenableModalUrl";
// Tab content is code-split to match the admin dashboard: only the active tab's
// chunk loads. ssr:false is correct — the page is behind a client-side auth gate.
const tabFallback = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
  </div>
);
const BookingsPage = dynamic(() => import("../../components/BookingsPage"), { ssr: false, loading: tabFallback });
const MessagesPage = dynamic(() => import("../../components/MessagesPage"), { ssr: false, loading: tabFallback });
const CustomersPage = dynamic(() => import("../../components/CustomersPage"), { ssr: false, loading: tabFallback });
const TeamMembersPage = dynamic(() => import("../../components/TeamMembersPage"), { ssr: false, loading: tabFallback });
const InvitesPage = dynamic(() => import("../../components/InvitesPage"), { ssr: false, loading: tabFallback });
const CleanerManagementPage = dynamic(() => import("../../components/CleanerManagementPage"), { ssr: false, loading: tabFallback });
const AnalyticsPage = dynamic(() => import("../../components/AnalyticsPage"), { ssr: false, loading: tabFallback });
const PaymentsPage = dynamic(() => import("../../components/PaymentsPage"), { ssr: false, loading: tabFallback });
const PropertiesPage = dynamic(() => import("../../components/PropertiesPage"), { ssr: false, loading: tabFallback });
const ServicesPage = dynamic(() => import("../../components/ServicesPage"), { ssr: false, loading: tabFallback });
import ActionRequiredSection from "../../components/admin-dashboard/ActionRequiredSection";
import RescheduleAppointmentModal from "../../components/RescheduleAppointmentModal";
import { AppointmentCardData } from "../../components/AppointmentCard";
import StatTile from "../../components/StatTile";
import TodayScheduleSection from "../../components/TodayScheduleSection";
import ActiveNowSection from "../../components/ActiveNowSection";
import {
  ADMIN_MANAGER_DASHBOARD_TAB_IDS,
  usePersistedDashboardTab,
} from "../../hooks/usePersistedDashboardTab";
import { useAppointmentPanel } from "../../hooks/useAppointmentPanel";
import AppointmentPanelHost from "../../components/AppointmentPanelHost";

function ManagerDashboardInner() {
  const { user, loading, signOut, currentOrganizationId, accessToken, orgStatus, reloadOrganization } = useAuth();
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
  // Notification "Assign cleaner" deep-link target, consumed by ActionRequiredSection.
  const [assignIntentId, setAssignIntentId] = useState<string | null>(null);
  // Lazy-load invites: stays mounted at dashboard level once first opened, so
  // tab switches don't re-fetch and the Realtime channel survives navigation.
  const [hasOpenedInvitesEver, setHasOpenedInvitesEver] = useState(
    activeTab === "invites",
  );
  useEffect(() => {
    if (activeTab === "invites") setHasOpenedInvitesEver(true);
  }, [activeTab]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showPendingFilter, setShowPendingFilter] = useState(false);
  const [showAllFilter, setShowAllFilter] = useState(false);
  const [showAddCleanerModal, setShowAddCleanerModal] = useState(false);
  // Reopen-on-reload marker for AddCleanerModal: a hard reload restores the modal (and the
  // modal restores its own sessionStorage draft). Shared key with the admin dashboard.
  const {
    isOpenFromUrl: addCleanerOpenFromUrl,
    openModalUrl: openAddCleanerUrl,
    closeModalUrl: closeAddCleanerUrl,
  } = useReopenableModalUrl("add-cleaner");
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  // Flat left-nav tabs, filtered by manager permissions (must be before early
  // return). Messages lives on the TopBar icon + mobile drawer, not the sidebar.
  const sidebarTabs = useMemo(
    () => [
      {
        id: "home",
        label: "Overview",
        icon: Home,
        notificationCount: needsResponseCount,
      },
      ...(permissions?.can_view_bookings
        ? [{ id: "bookings", label: "Bookings", icon: Calendar }]
        : []),
      ...(permissions?.can_view_customers
        ? [{ id: "customers", label: "Customers", icon: Users }]
        : []),
      ...(permissions?.can_view_properties
        ? [{ id: "properties", label: "Properties", icon: Building }]
        : []),
      ...(permissions?.can_view_services
        ? [{ id: "services", label: "Services", icon: Briefcase }]
        : []),
      ...(permissions?.can_manage_cleaners
        ? [
            { id: "team", label: "Team Members", icon: Users },
            { id: "cleaners", label: "Cleaner Management", icon: UserCheck },
            { id: "invites", label: "Invites", icon: Mail },
          ]
        : []),
      ...(permissions?.can_view_payments
        ? [{ id: "payments", label: "Finance", icon: DollarSign }]
        : []),
      ...(permissions?.can_view_analytics
        ? [{ id: "analytics", label: "Analytics", icon: BarChart3 }]
        : []),
    ],
    [permissions, needsResponseCount],
  );

  // Mobile bottom nav — the most-used accessible tabs (capped at 4).
  const mobileNavTabs = useMemo(
    () =>
      [
        {
          id: "home",
          label: "Overview",
          icon: Home,
          notificationCount: needsResponseCount,
        },
        ...(permissions?.can_view_bookings
          ? [{ id: "bookings", label: "Bookings", icon: Calendar }]
          : []),
        ...(permissions?.can_view_messages
          ? [
              {
                id: "messages",
                label: "Messages",
                icon: MessageCircle,
                hasNotification: hasUnreadMessages,
              },
            ]
          : []),
        ...(permissions?.can_view_customers
          ? [{ id: "customers", label: "Customers", icon: Users }]
          : []),
      ].slice(0, 4),
    [permissions, needsResponseCount, hasUnreadMessages],
  );

  // Mobile drawer — every accessible tab, with Messages inserted after Bookings.
  const allTabs = useMemo(() => {
    const msg = permissions?.can_view_messages
      ? [
          {
            id: "messages",
            label: "Messages",
            icon: MessageCircle,
            hasNotification: hasUnreadMessages,
          },
        ]
      : [];
    const idx = sidebarTabs.findIndex((t) => t.id === "bookings");
    if (idx < 0) return [sidebarTabs[0], ...msg, ...sidebarTabs.slice(1)];
    return [
      ...sidebarTabs.slice(0, idx + 1),
      ...msg,
      ...sidebarTabs.slice(idx + 1),
    ];
  }, [sidebarTabs, permissions, hasUnreadMessages]);

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

  // Auth not ready yet - MUST be after all hooks.
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

  // Org context failed to load (transient) — offer retry, not a blank dashboard.
  // MUST come before the permissions gate: a failed org load leaves
  // currentOrganizationId null, which disables useManagerPermissions (permissions
  // stays null). Checking !permissions first would trap the manager on an
  // indefinite spinner and never reach this retry screen.
  if (orgStatus === "error") {
    return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
  }

  // Still resolving permissions or the org context.
  if (permissionsLoading || !permissions || orgStatus === "idle" || orgStatus === "loading") {
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

  // Open the create-appointment flow from the top nav / FAB. Sets the Bookings
  // tab and the modal marker in a single navigation so the two URL writes don't
  // clobber each other; BookingsPage reads ?modal=add-appointment to open it.
  const handleNewBooking = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "bookings");
    params.set("modal", "add-appointment");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // Get upcoming appointments: future appointments that are confirmed
  // This matches the BookingsPage "upcoming" tab definition, but restricted to confirmed
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // KPI tile count: every appointment scheduled today that is not cancelled.
  const todaysJobsCount = appointments.filter((a) => {
    const [year, month, day] = a.scheduled_date.split("-").map(Number);
    const appointmentDate = new Date(year, month - 1, day);
    appointmentDate.setHours(0, 0, 0, 0);
    return (
      appointmentDate.getTime() === today.getTime() && a.status !== "cancelled"
    );
  }).length;

  // Unassigned KPI (revenue-tile fallback for managers without payment access):
  // upcoming/today jobs with no cleaner attached yet.
  const unassignedCount = appointments.filter((a) => {
    if (a.cleaner_profile) return false;
    if (a.status === "cancelled" || a.status === "completed") return false;
    const [year, month, day] = a.scheduled_date.split("-").map(Number);
    const appointmentDate = new Date(year, month - 1, day);
    appointmentDate.setHours(0, 0, 0, 0);
    return appointmentDate >= today;
  }).length;

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

  const handleBulkDeleteAppointments = async (ids: string[]) => {
    const result = await deleteAppointments(ids);
    await refetchAppointments();
    const { message, variant } = describeBulkAppointmentResult("delete", result);
    showToast(message, { variant });
  };

  const handleBulkCancelAppointments = async (ids: string[]) => {
    const result = await cancelAppointments(ids);
    await refetchAppointments();
    const { message, variant } = describeBulkAppointmentResult("cancel", result);
    showToast(message, { variant });
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
        {/* At-a-glance KPI tiles. Manager parity with the admin overview; the
            revenue tile is gated on can_view_payments and falls back to an
            Unassigned count so the row always shows four. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile
            icon={<Calendar className="w-5 h-5" />}
            tone="primary"
            label="Today's jobs"
            value={todaysJobsCount}
            loading={appointmentsLoading}
            onClick={() => setActiveTab("bookings")}
          />
          <StatTile
            icon={<Loader2 className="w-5 h-5" />}
            tone="blue"
            label="In progress"
            value={activeJobsManager.length}
            live={activeJobsManager.length > 0}
            loading={appointmentsLoading}
            onClick={() => setActiveTab("bookings")}
          />
          <StatTile
            icon={<UserCheck className="w-5 h-5" />}
            tone="amber"
            label="Awaiting approval"
            value={awaitingCleanerApprovalAppointments.length}
            loading={appointmentsLoading}
            onClick={() => {
              setShowPendingFilter(true);
              setActiveTab("bookings");
            }}
          />
          {permissions?.can_view_payments ? (
            <StatTile
              icon={<DollarSign className="w-5 h-5" />}
              tone="green"
              label="Revenue this month"
              value={`$${paymentStats.thisMonthRevenue.toLocaleString()}`}
              loading={paymentStatsLoading}
              onClick={() => setActiveTab("payments")}
            />
          ) : (
            <StatTile
              icon={<Users className="w-5 h-5" />}
              tone="gray"
              label="Unassigned"
              value={unassignedCount}
              loading={appointmentsLoading}
              onClick={() => setActiveTab("bookings")}
            />
          )}
        </div>

        {/* Unified action queue: one persistent source of truth, mirrored as a
            banner on the Bookings tab and the nav-badge count. */}
        <ActionRequiredSection
          assignAppointmentId={assignIntentId}
          onAssignHandled={() => setAssignIntentId(null)}
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

        {/* Compact Today glance; full lists live in Bookings. */}
        <TodayScheduleSection
          appointments={todaysAppointments as unknown as AppointmentCardData[]}
          loading={appointmentsLoading}
          onViewAll={() => setActiveTab("bookings")}
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
        onBulkDeleteAppointments={handleBulkDeleteAppointments}
        onBulkCancelAppointments={handleBulkCancelAppointments}
        onRefreshAppointments={refetchAppointments}
        onAppointmentUpdated={(id, data) => updateAppointmentInState(id, data)}
        onOpenAppointment={openAppointment}
        actionCount={needsResponseCount}
        onGoToActionCenter={() => setActiveTab("home")}
        role="manager"
        canApproveDecline={permissions?.can_approve_decline_bookings ?? false}
        initialStatusFilter={initialFilter}
        cleaners={cleaners.map((c) => ({
          id: c.id,
          name:
            `${c.user_profile?.first_name ?? ""} ${c.user_profile?.last_name ?? ""}`.trim() ||
            "Cleaner",
          avatarUrl: c.user_profile?.avatar_url ?? null,
        }))}
        showCreateButton={false}
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
      onAddCleaner={() => {
        setShowAddCleanerModal(true);
        openAddCleanerUrl();
      }}
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
      {/* Persistent Desktop Sidebar - flat tab list (permission-filtered) */}
      <DesktopSidebar
        tabs={sidebarTabs}
        onTabChange={handleTabChange}
        onLogout={handleLogout}
        user={user}
        activeTab={activeTab}
      />

      {/* Main Content Wrapper with Sidebar Offset */}
      <div className="md:ml-[260px] pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-16">
        {/* Top Bar - tabs live in the sidebar now; the right cluster carries the
            New booking action (when permitted) + Messages/Settings icons. */}
        <div className="hidden md:block">
          <TopBar
            role="manager"
            user={user}
            tabs={[]}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            onMobileMenuClick={() => setIsSidebarOpen(true)}
            profileClickNavigatesToSettings
            showMessagesIcon={permissions?.can_view_messages === true}
            hasUnreadMessages={hasUnreadMessages}
            showSettingsIcon
            primaryAction={
              permissions?.can_edit_bookings ? (
                <NewBookingButton onClick={handleNewBooking} />
              ) : undefined
            }
            onOpenAppointment={(id, intent) => {
              if (intent === "assign") setAssignIntentId(id);
              else openAppointment(id);
            }}
          />
        </div>

        <main
          className={`${
            activeTab === "messages"
              ? "p-0 md:p-4 md:sm:p-6 md:lg:p-8"
              : "p-4 sm:p-6 lg:p-8"
          } pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-8`}
        >
          {renderContent()}
        </main>
      </div>

      {/* Mobile FAB — create a booking from any tab (when permitted). */}
      {permissions?.can_edit_bookings && (
        <div
          className="md:hidden fixed right-4 z-30"
          style={{ bottom: "calc(6.25rem + env(safe-area-inset-bottom))" }}
        >
          <ScrollAwareFab
            label="New booking"
            icon={Plus}
            onClick={handleNewBooking}
            expandedWidth={172}
          />
        </div>
      )}

      {/* Mobile Top Bar - brand + notifications (bell opens a bottom sheet) */}
      <MobileTopBar
        role="manager"
        onTabChange={handleTabChange}
        onOpenAppointment={(id, intent) => {
          if (intent === "assign") setAssignIntentId(id);
          else openAppointment(id);
        }}
      />

      {/* Mobile Bottom Navigation - most-used accessible tabs */}
      <MobileNavigation
        tabs={mobileNavTabs}
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
        isOpen={showAddCleanerModal || addCleanerOpenFromUrl}
        onClose={() => {
          setShowAddCleanerModal(false);
          closeAddCleanerUrl();
        }}
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
