"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import {
  Calendar,
  Users,
  MessageCircle,
  DollarSign,
  BarChart3,
  Settings,
  TrendingUp,
  UserCheck,
  Home,
  Loader2,
  Star,
  Building,
  LayoutGrid,
  Briefcase,
  Mail,
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
import AddCleanerModal from "../../components/AddCleanerModal";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";
import BookingsPage from "../../components/BookingsPage";
import MessagesPage from "../../components/MessagesPage";
import CustomersPage from "../../components/CustomersPage";
import PropertiesPage from "../../components/PropertiesPage";
import TeamMembersPage from "../../components/TeamMembersPage";
import InvitesPage from "../../components/InvitesPage";
import PaymentsPage from "../../components/PaymentsPage";
import CleanerManagementPage from "../../components/CleanerManagementPage";
import AnalyticsPage from "../../components/AnalyticsPage";
import ServicesPage from "../../components/ServicesPage";
import SettingsHub from "../../components/SettingsHub";
import RescheduleRequiredSection from "../../components/RescheduleRequiredSection";
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

function AdminDashboardInner() {
  const { user, loading, signOut, currentOrganizationId, accessToken } = useAuth();
  const [activeTab, setActiveTab] = usePersistedDashboardTab(
    "home",
    ADMIN_MANAGER_DASHBOARD_TAB_IDS,
  );
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

  // Calculate if there are any unread messages (must be before early return)
  const hasUnreadMessages = useMemo(() => {
    return conversations.some((conv) => conv.unread_count > 0);
  }, [conversations]);

  // Hierarchical navigation structure (must be before early return)
  const navigationGroups = useMemo(
    () => ({
      operations: {
        id: "operations" as const,
        label: "Operations",
        icon: LayoutGrid,
        tabs: [
          { id: "home", label: "Overview", icon: Home },
          { id: "bookings", label: "Bookings", icon: Calendar },
          {
            id: "messages",
            label: "Messages",
            icon: MessageCircle,
            hasNotification: hasUnreadMessages,
          },
          { id: "customers", label: "Customers", icon: Users },
          { id: "services", label: "Services", icon: Briefcase },
        ],
      },
      accounts: {
        id: "accounts" as const,
        label: "Accounts",
        icon: Users,
        tabs: [
          { id: "customers", label: "Customers", icon: Users },
          { id: "properties", label: "Properties", icon: Building },
        ],
      },
      team: {
        id: "team" as const,
        label: "Team",
        icon: UserCheck,
        tabs: [
          { id: "team", label: "Team Members", icon: Users },
          { id: "cleaners", label: "Cleaner Management", icon: UserCheck },
          { id: "invites", label: "Invites", icon: Mail },
        ],
      },
      business: {
        id: "business" as const,
        label: "Business",
        icon: TrendingUp,
        tabs: [
          { id: "payments", label: "Finance", icon: DollarSign },
          { id: "analytics", label: "Analytics", icon: BarChart3 },
        ],
      },
    }),
    [hasUnreadMessages],
  );

  // Get tabs for current group (must be before early return)
  const currentGroupTabs = useMemo(
    () =>
      navigationGroups[activeGroup as keyof typeof navigationGroups]?.tabs ?? [],
    [navigationGroups, activeGroup],
  );

  // Filter out "customers" and "messages" from top nav — customers live under Accounts; messages use TopBar icon (cleaner pattern)
  const topNavTabs = useMemo(
    () =>
      activeGroup === "operations"
        ? currentGroupTabs.filter(
            (tab) => tab.id !== "customers" && tab.id !== "messages",
          )
        : currentGroupTabs,
    [activeGroup, currentGroupTabs],
  );

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

  const handleLogout = async () => {
    await signOut();
  };

  // Get groups array for sidebar
  const groups = Object.values(navigationGroups);

  // Get all tabs for mobile (deduplicate by id to avoid duplicates when tab appears in multiple groups)
  const allTabs = Array.from(
    new Map(groups.flatMap((g) => g.tabs).map((tab) => [tab.id, tab])).values(),
  );
  if (!allTabs.find((t) => t.id === "settings")) {
    allTabs.push({ id: "settings", label: "Settings", icon: Settings });
  }

  // Handle group change - switch to first tab of new group (group derives from tab via ADMIN_MANAGER_TAB_TO_GROUP)
  const handleGroupChange = (groupId: string) => {
    const newGroup = navigationGroups[groupId as keyof typeof navigationGroups];
    if (newGroup && newGroup.tabs.length > 0) {
      const nextTab =
        groupId === "team"
          ? (newGroup.tabs.find((tab) => tab.id === "team")?.id ??
            newGroup.tabs[0].id)
          : newGroup.tabs[0].id;
      setActiveTab(nextTab);
      // Reset filters when switching groups
      setShowPendingFilter(false);
      setShowAllFilter(false);
    }
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
        a.status !== "completed" &&
        a.status !== "cancelled" &&
        a.status !== "in_progress"
      );
    })
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

  const activeJobsAdmin = appointments
    .filter((a) => a.status === "in_progress")
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));

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

        {activeJobsAdmin.length > 0 && (
          <ActiveNowSection
            appointments={activeJobsAdmin as unknown as AppointmentCardData[]}
            loading={appointmentsLoading}
          />
        )}

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
        />

        <div
          className={`grid grid-cols-1 gap-6 items-start ${
            todaysAppointments.length > 0 ? "lg:grid-cols-2" : ""
          }`}
        >
          <TodayScheduleSection
            appointments={todaysAppointments as unknown as AppointmentCardData[]}
            loading={appointmentsLoading}
            onViewAll={() => setActiveTab("bookings")}
          />
          <UpcomingAppointmentsSection
            appointments={upcomingAppointments as unknown as AppointmentCardData[]}
            totalCount={allUpcomingAppointments.length}
            loading={appointmentsLoading}
            onViewAll={() => {
              setShowAllFilter(true);
              setActiveTab("bookings");
            }}
          />
        </div>
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
        onMarkComplete={handleMarkComplete}
        onRefreshAppointments={refetchAppointments}
        onAppointmentUpdated={(id, data) => updateAppointmentInState(id, data)}
        role="admin"
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
      onAddCleaner={() => setShowAddCleanerModal(true)}
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
      case "settings":
        return null; // Settings is rendered separately and pre-mounted below
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
            role="admin"
            user={user}
            tabs={topNavTabs}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            onMobileMenuClick={() => setIsSidebarOpen(true)}
            profileClickNavigatesToSettings
            showMessagesIcon
            hasUnreadMessages={hasUnreadMessages}
            showSettingsIcon
          />
        </div>

        {/* Main Content Area - Settings page is always mounted so it's ready when user clicks */}
        <main
          className={`${
            activeTab === "messages"
              ? "p-0 md:p-4 md:sm:p-6 md:lg:p-8"
              : "p-4 sm:p-6 lg:p-8"
          } pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-8`}
        >
          <div className={activeTab === "settings" ? "block" : "hidden"}>
            <SettingsHub />
          </div>
          {activeTab !== "settings" && renderContent()}
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
        role="admin"
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
