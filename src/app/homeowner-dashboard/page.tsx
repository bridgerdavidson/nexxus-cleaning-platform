"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import {
  Calendar,
  Home,
  MessageCircle,
  CreditCard,
  Building,
  Clock,
  AlertCircle,
  Star,
  Loader2,
  Briefcase,
  MapPin,
  ChevronDown,
  ChevronRight,
  User,
} from "lucide-react";
import {
  useHomeownerAppointments,
  useHomeownerProperties,
  useHomeownerPayments,
} from "../../hooks/useHomeownerData";
import { useConversations } from "../../hooks/useConversations";
import { useServices } from "../../hooks/useServices";
import {
  DASHBOARD_HERO_BACKGROUND,
  dashboardHeroCardDesktopClass,
  dashboardHeroCardMobileClass,
} from "../../lib/dashboardHero";
import DesktopSidebar from "../../components/DesktopSidebar";
import TopBar from "../../components/TopBar";
import MobileNavigation from "../../components/MobileNavigation";
import MobileSidebar from "../../components/MobileSidebar";
import MessagesPage from "../../components/MessagesPage";
import AddAppointmentModal from "../../components/AddAppointmentModal";
import BookingsPage from "../../components/BookingsPage";
import AppointmentCard from "../../components/AppointmentCard";
import PropertiesPage from "../../components/PropertiesPage";
import ServicesPage from "../../components/ServicesPage";
import SettingsHub from "../../components/SettingsHub";
import ActiveNowSection from "../../components/ActiveNowSection";
import {
  HOMEOWNER_DASHBOARD_TAB_IDS,
  usePersistedDashboardTab,
} from "../../hooks/usePersistedDashboardTab";
import { useAppointmentPanel } from "../../hooks/useAppointmentPanel";
import AppointmentPanelHost from "../../components/AppointmentPanelHost";
import { AppointmentCardData } from "../../components/AppointmentCard";

function HomeownerDashboardInner() {
  const { user, loading, signOut } = useAuth();
  const [activeTab, setActiveTab] = usePersistedDashboardTab(
    "home",
    HOMEOWNER_DASHBOARD_TAB_IDS,
  );
  const {
    appointmentId: openAppointmentId,
    isOpen: isAppointmentPanelOpen,
    openAppointment,
    closeAppointment,
  } = useAppointmentPanel();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showAddAppointmentModal, setShowAddAppointmentModal] = useState(false);
  const [showAllFilter, setShowAllFilter] = useState(false);
  const [expandedToday, setExpandedToday] = useState(true);
  const [expandedUpcoming, setExpandedUpcoming] = useState(true);
  const router = useRouter();

  // Real data hooks - must be called at top level
  const {
    appointments,
    loading: appointmentsLoading,
    error: appointmentsError,
    refetch: refetchAppointments,
  } = useHomeownerAppointments();
  const {
    properties,
    loading: propertiesLoading,
    error: propertiesError,
  } = useHomeownerProperties();
  const {
    payments,
    loading: paymentsLoading,
    error: paymentsError,
  } = useHomeownerPayments();
  const {
    conversations,
    loading: conversationsLoading,
    error: conversationsError,
    refetch: refetchConversations,
    updateUnreadCount,
  } = useConversations({ userId: user?.id || "" });
  const {
    services,
    loading: servicesLoading,
    error: servicesError,
    refetch: refetchServices,
    updateServiceInState,
    maxChecklistAdderByServiceId,
    refreshMaxChecklistAdders,
  } = useServices();

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

  // Handle tab change - reset filters if not navigating from specific sections
  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    // Only keep filters if we're staying on bookings tab
    if (tabId !== "bookings") {
      setShowAllFilter(false);
    }
  };

  // Handler functions for BookingsPage
  const handleCancelAppointment = async (appointmentId: string) => {
    // TODO: Implement cancel functionality
    console.log("Cancel appointment:", appointmentId);
  };

  const handleDeleteAppointment = async (appointmentId: string) => {
    // TODO: Implement delete functionality
    console.log("Delete appointment:", appointmentId);
  };

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

  // Today's date string (YYYY-MM-DD) for filtering
  const todayStr = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  // Active appointments (in_progress) - shown in Active Cleanings section
  const activeAppointments = useMemo(
    () => appointments.filter((a) => a.status === "in_progress"),
    [appointments],
  );

  // Today's appointments (not in progress — those appear only under Active Cleanings)
  const todaysAppointments = useMemo(
    () =>
      appointments
        .filter(
          (a) => a.scheduled_date === todayStr && a.status !== "in_progress",
        )
        .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)),
    [appointments, todayStr],
  );

  // Upcoming = after today only (today is in Today's Appointments)
  const allUpcomingAppointments = appointments
    .filter((a) => {
      // After today only; excluding completed/cancelled
      if (a.scheduled_date <= todayStr) return false;
      if (a.status === "completed" || a.status === "cancelled") return false;
      return true;
    })
    .sort((a, b) => {
      const dateA = new Date(`${a.scheduled_date}T${a.scheduled_time}`);
      const dateB = new Date(`${b.scheduled_date}T${b.scheduled_time}`);
      return dateA.getTime() - dateB.getTime();
    });

  const upcomingAppointments = allUpcomingAppointments.slice(0, 3);

  // Auto-collapse empty sections only after data has loaded; keep expanded when section has items
  useEffect(() => {
    if (!appointmentsLoading) {
      if (todaysAppointments.length > 0) setExpandedToday(true);
      else setExpandedToday(false);
    }
  }, [appointmentsLoading, todaysAppointments.length]);
  useEffect(() => {
    if (!appointmentsLoading) {
      if (allUpcomingAppointments.length > 0) setExpandedUpcoming(true);
      else setExpandedUpcoming(false);
    }
  }, [appointmentsLoading, allUpcomingAppointments.length]);

  // Persistent left sidebar tabs (desktop) — mirrors cleaner pattern (Messages + Settings live on top bar).
  const sidebarTabs = useMemo(
    () => [
      { id: "home", label: "Overview", icon: Home },
      { id: "bookings", label: "Bookings", icon: Calendar },
      { id: "properties", label: "Properties", icon: Building },
      { id: "payments", label: "Payments", icon: CreditCard },
      { id: "services", label: "Services", icon: Briefcase },
    ],
    [],
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

  // Mobile slide-out drawer shows everything including Messages + Settings.
  const allTabs = [
    ...sidebarTabs,
    {
      id: "messages",
      label: "Messages",
      icon: MessageCircle,
      hasNotification: hasUnreadMessages,
    },
    { id: "settings", label: "Settings", icon: User },
  ];

  // Bottom mobile nav — surface the most-used tabs.
  const mobileNavTabs = [
    { id: "home", label: "Overview", icon: Home },
    { id: "bookings", label: "Bookings", icon: Calendar },
    {
      id: "messages",
      label: "Messages",
      icon: MessageCircle,
      hasNotification: hasUnreadMessages,
    },
    { id: "payments", label: "Payments", icon: CreditCard },
  ];

  const renderOverview = () => (
    <>
      {/* Mobile Hero */}
      <div className="md:hidden mb-6 mt-2">
        <div
          className={dashboardHeroCardMobileClass}
          style={DASHBOARD_HERO_BACKGROUND}
        >
          <div className="relative">
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-primary-100 bg-white/80 px-2.5 py-0.5 text-[10px] font-semibold text-primary-700 uppercase tracking-wider">
              <Star className="h-3 w-3" />
              Homeowner Dashboard
            </div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
              Hello, {user?.profile?.firstName || "there"}
            </h2>
            <p className="text-gray-600 mt-1 text-sm font-medium">
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Desktop Hero */}
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
                  Homeowner Dashboard
                </div>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900">
                  Overview
                </h2>
                <p className="mt-2 max-w-2xl text-sm md:text-base text-gray-600">
                  Track your cleanings, message your team, and view your
                  properties from one central place.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setActiveTab("bookings")}
                  className="rounded-xl border border-primary-200 bg-white/90 px-4 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50"
                >
                  View all bookings
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Active Cleanings — only renders when there are in-progress cleanings */}
        {activeAppointments.length > 0 && (
          <ActiveNowSection
            title="Active Cleanings"
            appointments={
              activeAppointments as unknown as AppointmentCardData[]
            }
            loading={appointmentsLoading}
          >
            <div className="space-y-3">
              {activeAppointments.map((appointment) => (
                <AppointmentCard
                  key={appointment.id}
                  appointment={
                    appointment as Parameters<
                      typeof AppointmentCard
                    >[0]["appointment"]
                  }
                  onClick={() => openAppointment(appointment.id)}
                  role="homeowner"
                />
              ))}
            </div>
          </ActiveNowSection>
        )}

        {/* Today's Appointments */}
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
                <h3 className="text-lg font-bold text-gray-900">
                  Today&apos;s Appointments
                </h3>
                <span className="text-xs font-medium text-gray-500">
                  {todaysAppointments.length} scheduled
                </span>
              </div>
            </div>
            <div className="p-2 bg-gray-50 rounded-full transition-colors duration-200">
              {(todaysAppointments.length > 0 || appointmentsLoading
                ? expandedToday
                : false) ? (
                <ChevronDown className="w-5 h-5 text-gray-500 transition-colors" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-500 transition-colors" />
              )}
            </div>
          </button>
          {(todaysAppointments.length > 0 || appointmentsLoading
            ? expandedToday
            : false) && (
            <div className="border-t border-gray-100 bg-gray-50/60 p-3 sm:p-4">
              {appointmentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-600">
                    Loading schedule...
                  </span>
                </div>
              ) : todaysAppointments.length > 0 ? (
                <div className="space-y-3">
                  {todaysAppointments.map((appointment) => (
                    <AppointmentCard
                      key={appointment.id}
                      appointment={
                        appointment as Parameters<
                          typeof AppointmentCard
                        >[0]["appointment"]
                      }
                      onClick={() => openAppointment(appointment.id)}
                      role="homeowner"
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Clock className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">
                    No appointments scheduled for today
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Upcoming Appointments */}
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
                <h3 className="text-lg font-bold text-gray-900">
                  Upcoming Appointments
                </h3>
                <span className="text-xs font-medium text-gray-500">
                  {allUpcomingAppointments.length} future scheduled
                </span>
              </div>
            </div>
            <div className="p-2 bg-gray-50 rounded-full transition-colors duration-200">
              {(allUpcomingAppointments.length > 0 || appointmentsLoading
                ? expandedUpcoming
                : false) ? (
                <ChevronDown className="w-5 h-5 text-gray-500 transition-colors" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-500 transition-colors" />
              )}
            </div>
          </button>
          {(allUpcomingAppointments.length > 0 || appointmentsLoading
            ? expandedUpcoming
            : false) && (
            <div className="border-t border-gray-100 bg-gray-50/60 p-3 sm:p-4">
              {appointmentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                  <span className="ml-2 text-gray-600">Loading...</span>
                </div>
              ) : appointmentsError ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-2" />
                  <p className="text-red-600">Failed to load appointments</p>
                </div>
              ) : allUpcomingAppointments.length > 0 ? (
                <div className="space-y-3">
                  {upcomingAppointments.map((appointment) => (
                    <AppointmentCard
                      key={appointment.id}
                      appointment={
                        appointment as Parameters<
                          typeof AppointmentCard
                        >[0]["appointment"]
                      }
                      onClick={() => openAppointment(appointment.id)}
                      role="homeowner"
                    />
                  ))}
                  {allUpcomingAppointments.length > 3 && (
                    <button
                      onClick={() => {
                        setShowAllFilter(true);
                        setActiveTab("bookings");
                      }}
                      className="w-full text-center py-3 text-sm font-semibold text-primary-700 bg-white hover:bg-primary-50 transition-colors duration-200 rounded-xl border border-primary-100 shadow-sm"
                    >
                      View all ({allUpcomingAppointments.length})
                    </button>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">No upcoming appointments</p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );

  const renderBookings = () => {
    // Determine initial status filter based on which "View All" was clicked
    let initialFilter: string | undefined;
    if (showAllFilter) {
      initialFilter = "all";
    }

    return (
      <BookingsPage
        appointments={appointments}
        loading={appointmentsLoading}
        onCancelAppointment={handleCancelAppointment}
        onDeleteAppointment={handleDeleteAppointment}
        onRefreshAppointments={refetchAppointments}
        onOpenAppointment={openAppointment}
        role="homeowner"
        canEdit={false}
        initialStatusFilter={initialFilter}
      />
    );
  };

  const renderMessages = () => (
    <MessagesPage
      userId={user.id}
      userRole="homeowner"
      conversations={conversations}
      loading={conversationsLoading}
      error={conversationsError}
      onRefresh={refetchConversations}
      onUpdateUnreadCount={updateUnreadCount}
      onSelectedConversationChange={setSelectedMessagesConversationId}
    />
  );

  const renderPayments = () => (
    <div className="card">
      <h2 className="text-4xl font-bold text-gray-900 mb-6">Payment History</h2>
      {paymentsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading payments...</span>
        </div>
      ) : paymentsError ? (
        <div className="text-center py-12">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Failed to load payments
          </h3>
          <p className="text-gray-600">{paymentsError}</p>
        </div>
      ) : payments.length === 0 ? (
        <div className="text-center py-12">
          <CreditCard className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No payments yet
          </h3>
          <p className="text-gray-600">
            Your payment history and receipts will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {payments.map((payment) => (
            <div key={payment.id} className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-3">
                  <CreditCard className="w-6 h-6 text-primary-600" />
                  <div>
                    <p className="font-medium text-gray-900">
                      ${payment.amount}
                    </p>
                    {payment.appointment?.service_type && (
                      <p className="text-sm text-gray-600">
                        {payment.appointment.service_type.name}
                      </p>
                    )}
                    {payment.appointment?.scheduled_date && (
                      <p className="text-sm text-gray-600">
                        {new Date(
                          payment.appointment.scheduled_date,
                        ).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      payment.status === "paid"
                        ? "text-green-600 bg-green-100"
                        : payment.status === "pending"
                          ? "text-yellow-600 bg-yellow-100"
                          : payment.status === "failed"
                            ? "text-red-600 bg-red-100"
                            : "text-gray-600 bg-gray-100"
                    }`}
                  >
                    {payment.status}
                  </span>
                  <p className="text-sm text-gray-500 mt-1">
                    {payment.paid_at
                      ? new Date(payment.paid_at).toLocaleDateString()
                      : new Date(payment.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderProperties = () => {
    // Convert homeowner properties to AdminProperty format
    const formattedProperties = properties.map((prop) => ({
      ...prop,
      bedrooms: prop.bedrooms ?? null,
      bathrooms: prop.bathrooms ?? null,
      square_feet: prop.square_feet ?? null,
      special_instructions: null,
      access_instructions: null,
      created_at: "",
      updated_at: "",
      owner_id: user?.id || "",
      homeowner: {
        id: user?.id || "",
        first_name: user?.profile?.firstName || "",
        last_name: user?.profile?.lastName || "",
        email: user?.email || "",
        phone: user?.profile?.phone || null,
      },
    }));

    return (
      <PropertiesPage
        properties={formattedProperties}
        loading={propertiesLoading}
        error={propertiesError}
        role="homeowner"
      />
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case "home":
        return renderOverview();
      case "bookings":
        return renderBookings();
      case "messages":
        return renderMessages();
      case "payments":
        return renderPayments();
      case "properties":
        return renderProperties();
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
        return renderOverview();
    }
  };

  return (
    <div className="min-h-screen bg-white md:bg-gray-100">
      {/* Persistent Desktop Sidebar */}
      <DesktopSidebar
        tabs={sidebarTabs}
        onTabChange={handleTabChange}
        onLogout={handleLogout}
        user={user}
        activeTab={activeTab}
      />

      {/* Main Content Wrapper with Sidebar Offset */}
      <div className="md:ml-[260px] pt-4 md:pt-16">
        {/* Top Bar — Messages + Settings icons; profile click navigates to settings */}
        <div className="hidden md:block">
          <TopBar
            role="homeowner"
            user={user}
            tabs={[]}
            activeTab={activeTab}
            onTabChange={handleTabChange}
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
          {renderContent()}
        </main>
      </div>

      <MobileNavigation
        tabs={mobileNavTabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onMenuClick={() => setIsSidebarOpen(true)}
      />
      <MobileSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        role="homeowner"
        tabs={allTabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />
      <AddAppointmentModal
        isOpen={showAddAppointmentModal}
        onClose={() => setShowAddAppointmentModal(false)}
        onAppointmentCreated={() => {
          refetchAppointments();
        }}
        preSelectedHomeownerId={user.id}
        hidePriceOverride={true}
      />
      <AppointmentPanelHost
        appointments={appointments as unknown as AppointmentCardData[]}
        appointmentId={openAppointmentId}
        isOpen={isAppointmentPanelOpen}
        onClose={closeAppointment}
        role="homeowner"
        canEdit={false}
        onRefreshAppointments={refetchAppointments}
      />
    </div>
  );
}

export default function HomeownerDashboard() {
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
      <HomeownerDashboardInner />
    </Suspense>
  );
}
