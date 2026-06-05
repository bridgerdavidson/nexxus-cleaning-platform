"use client";

import React, { useState, useEffect, useMemo, useRef, Suspense } from "react";
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
  BarChart3,
  UserCheck,
  Home,
  Loader2,
  Star,
  Building,
  Briefcase,
  Mail,
  Plus,
} from "lucide-react";
import {
  useAdminAppointments,
  useAdminCleaners,
  useAdminCustomers,
  useAdminProperties,
  useAdminPayments,
  useAdminPayouts,
  useAdminInvoices,
  usePaymentStats,
  useAdminTeamMembers,
  updateAppointmentStatus,
  deleteCleaner,
  cancelAppointment,
  deleteAppointment,
} from "../../hooks/useAdminData";
import { useServices } from "../../hooks/useServices";
import { useInvites } from "../../hooks/useInvites";
import {
  DASHBOARD_HERO_BACKGROUND,
  dashboardHeroCardDesktopClass,
  dashboardHeroCardMobileClass,
} from "../../lib/dashboardHero";
import { useConversations } from "../../hooks/useConversations";
import TopBar from "../../components/TopBar";
import MobileNavigation from "../../components/MobileNavigation";
import MobileSidebar from "../../components/MobileSidebar";
import DesktopSidebar from "../../components/DesktopSidebar";
import NewBookingButton from "../../components/NewBookingButton";
import ScrollAwareFab from "../../components/ScrollAwareFab";
import AddCleanerModal from "../../components/AddCleanerModal";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import { useReopenableModalUrl } from "../../hooks/useReopenableModalUrl";
// Tab content is code-split: only the active tab's chunk loads, keeping the
// initial dashboard bundle small (the default "overview" tab uses inline
// sections below, not these). ssr:false is correct — the whole page is behind a
// client-side auth gate, so these never render server-side anyway.
const tabFallback = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
  </div>
);
const BookingsPage = dynamic(() => import("../../components/BookingsPage"), { ssr: false, loading: tabFallback });
const MessagesPage = dynamic(() => import("../../components/MessagesPage"), { ssr: false, loading: tabFallback });
const CustomersPage = dynamic(() => import("../../components/CustomersPage"), { ssr: false, loading: tabFallback });
const PropertiesPage = dynamic(() => import("../../components/PropertiesPage"), { ssr: false, loading: tabFallback });
const TeamMembersPage = dynamic(() => import("../../components/TeamMembersPage"), { ssr: false, loading: tabFallback });
const InvitesPage = dynamic(() => import("../../components/InvitesPage"), { ssr: false, loading: tabFallback });
const PaymentsPage = dynamic(() => import("../../components/PaymentsPage"), { ssr: false, loading: tabFallback });
const CleanerManagementPage = dynamic(() => import("../../components/CleanerManagementPage"), { ssr: false, loading: tabFallback });
const AnalyticsPage = dynamic(() => import("../../components/AnalyticsPage"), { ssr: false, loading: tabFallback });
const ServicesPage = dynamic(() => import("../../components/ServicesPage"), { ssr: false, loading: tabFallback });
import RescheduleAppointmentModal from "../../components/RescheduleAppointmentModal";
import { AppointmentCardData } from "../../components/AppointmentCard";
import AwaitingApprovalSection from "../../components/AwaitingApprovalSection";
import ActionRequiredSection from "../../components/admin-dashboard/ActionRequiredSection";
import OwnerSetupChecklist from "../../components/admin-dashboard/OwnerSetupChecklist";
import { useAdminActionItems } from "../../hooks/useAdminActionItems";
import UpcomingAppointmentsSection from "../../components/UpcomingAppointmentsSection";
import TodayScheduleSection from "../../components/TodayScheduleSection";
import ActiveNowSection from "../../components/ActiveNowSection";
import {
  ADMIN_MANAGER_DASHBOARD_TAB_IDS,
  usePersistedDashboardTab,
} from "../../hooks/usePersistedDashboardTab";
import { useAppointmentPanel } from "../../hooks/useAppointmentPanel";
import AppointmentPanelHost from "../../components/AppointmentPanelHost";

function AdminDashboardInner() {
  const { user, loading, signOut, currentOrganizationId, accessToken, impersonatingOrgId, orgStatus, reloadOrganization } = useAuth();
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
  // modal restores its own sessionStorage draft). Shared key with the manager dashboard.
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
  } = useAdminAppointments();
  const {
    cleaners,
    loading: cleanersLoading,
    error: cleanersError,
    refetch: refetchCleaners,
    updateCleanerInState,
  } = useAdminCleaners();
  const {
    customers,
    loading: customersLoading,
    error: customersError,
    refetch: refetchCustomers,
    updateCustomerInState,
  } = useAdminCustomers();
  const {
    properties,
    loading: propertiesLoading,
    error: propertiesError,
    refetch: refetchProperties,
    updatePropertyInState,
  } = useAdminProperties();
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
  const {
    teamMembers,
    loading: teamMembersLoading,
    error: teamMembersError,
    refetch: refetchTeamMembers,
    updateTeamMemberInState,
  } = useAdminTeamMembers();
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
    enabled: hasOpenedInvitesEver,
  });

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

  // Track the conversation the user is actively viewing inside MessagesPage so
  // we can exclude it from the nav-bar unread dot (matches per-row badge logic
  // in ConversationItem). Cleared on tab switch / unmount.
  const [selectedMessagesConversationId, setSelectedMessagesConversationId] =
    useState<string | null>(null);

  // Calculate if there are any unread messages (must be before early return)
  const hasUnreadMessages = useMemo(() => {
    return conversations.some(
      (conv) =>
        conv.unread_count > 0 && conv.id !== selectedMessagesConversationId
    );
  }, [conversations, selectedMessagesConversationId]);

  // The unified action queue drives both the Bookings nav dot and the body
  // of the Action Required section. Same source of truth across all surfaces.
  const { items: actionItems } = useAdminActionItems();
  const needsResponseCount = actionItems.length;

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

  // Fire the overdue toast once per session per dashboard load. The ref
  // gates additional fires after the first load even if realtime invalidates
  // appointments — we don't want to spam the admin on every row update.
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

  // Flat left-nav tabs (must be before early return). Messages is intentionally
  // omitted here — it lives on the TopBar Messages icon (the cleaner/homeowner
  // pattern) and in the mobile drawer below.
  const sidebarTabs = useMemo(
    () => [
      { id: "home", label: "Overview", icon: Home },
      {
        id: "bookings",
        label: "Bookings",
        icon: Calendar,
        hasNotification: needsResponseCount > 0,
      },
      { id: "customers", label: "Customers", icon: Users },
      { id: "properties", label: "Properties", icon: Building },
      { id: "services", label: "Services", icon: Briefcase },
      { id: "team", label: "Team Members", icon: Users },
      { id: "cleaners", label: "Cleaner Management", icon: UserCheck },
      { id: "invites", label: "Invites", icon: Mail },
      { id: "payments", label: "Finance", icon: DollarSign },
      { id: "analytics", label: "Analytics", icon: BarChart3 },
    ],
    [needsResponseCount],
  );

  // Mobile bottom nav — the most-used tabs. Messages is a per-user inbox, so it
  // is hidden while a platform admin is impersonating an org.
  const mobileNavTabs = useMemo(
    () => [
      { id: "home", label: "Overview", icon: Home },
      {
        id: "bookings",
        label: "Bookings",
        icon: Calendar,
        hasNotification: needsResponseCount > 0,
      },
      ...(impersonatingOrgId
        ? []
        : [
            {
              id: "messages",
              label: "Messages",
              icon: MessageCircle,
              hasNotification: hasUnreadMessages,
            },
          ]),
      { id: "customers", label: "Customers", icon: Users },
    ],
    [needsResponseCount, impersonatingOrgId, hasUnreadMessages],
  );

  // Mobile drawer — every tab, with Messages inserted after Bookings.
  const allTabs = useMemo(
    () => [
      sidebarTabs[0],
      sidebarTabs[1],
      ...(impersonatingOrgId
        ? []
        : [
            {
              id: "messages",
              label: "Messages",
              icon: MessageCircle,
              hasNotification: hasUnreadMessages,
            },
          ]),
      ...sidebarTabs.slice(2),
    ],
    [sidebarTabs, impersonatingOrgId, hasUnreadMessages],
  );

  // Show loading while checking auth or while the org context is still resolving
  // (org id is null during 'idle'/'loading', which would otherwise disable every
  // org-scoped query and render a blank dashboard).
  if (loading || !user || orgStatus === "idle" || orgStatus === "loading") {
    return (
      <div className="min-h-screen bg-white md:bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Org context failed to load (transient). Offer an in-place retry instead of a
  // silent blank dashboard.
  if (orgStatus === "error") {
    return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
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

  // Handle tab change - reset filters if not navigating from specific sections
  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    // Only keep filters if we're staying on bookings tab
    if (tabId !== "bookings") {
      setShowPendingFilter(false);
      setShowAllFilter(false);
    }
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

  const activeJobsAdmin = appointments
    .filter((a) => a.status === "in_progress")
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

  // Appointments awaiting cleaner confirmation — shown in the
  // AwaitingApprovalSection (informational). The unified ActionRequiredSection
  // surfaces items where the *admin* needs to act; this list is the
  // pending-cleaner-response signal.
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
              Admin Dashboard
            </div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
              Hello, {user?.profile?.firstName || "Admin"}
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
                Admin Dashboard
              </div>
              <h2 className="text-4xl font-bold tracking-tight text-gray-900">
                Hello, {user?.profile?.firstName || "Admin"}
              </h2>
              <p className="mt-2 text-gray-600 font-medium">
                {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setActiveTab("analytics")}
                className="rounded-xl border border-primary-200 bg-white/90 px-4 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50"
              >
                Open analytics
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <OwnerSetupChecklist onNavigate={setActiveTab} />
        {/* Unified action queue: everything that needs the admin's response
            lives here — unassigned requests, escalations, counter-proposals,
            declines, and SLA timeouts. One source of truth across the
            overview, the Bookings tab, and the nav-dot count. */}
        <ActionRequiredSection
          assignAppointmentId={assignIntentId}
          onAssignHandled={() => setAssignIntentId(null)}
          onReassign={(item) => {
            const apt = appointments.find((a) => a.id === item.id);
            if (apt) setRescheduleModalAppointment(apt as AppointmentCardData);
          }}
        />

        {activeJobsAdmin.length > 0 && (
          <ActiveNowSection
            appointments={activeJobsAdmin as unknown as AppointmentCardData[]}
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
        role="admin"
        initialStatusFilter={initialFilter}
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
      canManage={true}
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

  const renderMessages = () => (
    <MessagesPage
      userId={user.id}
      userRole="admin"
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

  const renderProperties = () => (
    <PropertiesPage
      properties={properties}
      loading={propertiesLoading}
      error={propertiesError}
      onRefreshProperties={refetchProperties}
      onPropertyUpdated={updatePropertyInState}
      onRefreshAppointments={refetchAppointments}
      role="admin"
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

  const renderAnalytics = () => <AnalyticsPage role="admin" />;

  const renderContent = () => {
    switch (activeTab) {
      case "home":
        return renderOverview();
      case "bookings":
        return renderBookings();
      case "messages":
        return renderMessages();
      case "customers":
        return (
          <CustomersPage
            customers={customers}
            loading={customersLoading}
            error={customersError}
            onRefreshCustomers={refetchCustomers}
            onCustomerUpdated={updateCustomerInState}
            onRefreshAppointments={refetchAppointments}
            onRefreshProperties={refetchProperties}
            role="admin"
          />
        );
      case "cleaners":
        return renderCleaners();
      case "payments":
        return renderPayments();
      case "analytics":
        return renderAnalytics();
      case "properties":
        return renderProperties();
      case "team":
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
        return (
          <InvitesPage
            canResend={true}
            invites={invites}
            loading={invitesLoading}
            error={invitesError}
            refetch={refetchInvites}
            resend={resendInvite}
          />
        );
      case "services":
        return (
          <ServicesPage
            services={services}
            loading={servicesLoading}
            error={servicesError}
            refetch={refetchServices}
            canManageServices={true}
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
      {/* Persistent Desktop Sidebar - flat tab list */}
      <DesktopSidebar
        tabs={sidebarTabs}
        onTabChange={handleTabChange}
        onLogout={handleLogout}
        user={user}
        activeTab={activeTab}
      />

      {/* Main Content Wrapper with Sidebar Offset */}
      <div className="md:ml-[260px] pt-4 md:pt-16">
        {/* Top Bar - tabs live in the sidebar now; the right cluster carries the
            New booking action + Messages/Settings icons. Hidden on mobile. */}
        <div className="hidden md:block">
          <TopBar
            role="admin"
            user={user}
            tabs={[]}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            onMobileMenuClick={() => setIsSidebarOpen(true)}
            profileClickNavigatesToSettings
            showMessagesIcon
            hasUnreadMessages={hasUnreadMessages}
            showSettingsIcon
            primaryAction={<NewBookingButton onClick={handleNewBooking} />}
            onOpenAppointment={(id, intent) => {
              if (intent === "assign") setAssignIntentId(id);
              else openAppointment(id);
            }}
          />
        </div>

        <main
          className={`${
            activeTab === "messages"
              ? "p-0 md:p-4 lg:p-6"
              : "p-4 sm:p-6 lg:p-8"
          } pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-8`}
        >
          {renderContent()}
        </main>
      </div>

      {/* Mobile FAB — create a booking from any tab. Sits above the bottom nav. */}
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

      {/* Mobile Bottom Navigation - most-used tabs */}
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
        role="admin"
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
        role="admin"
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

export default function AdminDashboard() {
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
      <AdminDashboardInner />
    </Suspense>
  );
}
