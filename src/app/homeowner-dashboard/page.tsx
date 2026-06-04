"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter } from "next/navigation";
import { MotionConfig } from "motion/react";
import { useAuth } from "../../hooks/useAuth";
import WorkspaceErrorScreen from "../../components/WorkspaceErrorScreen";
import {
  Home,
  MessageCircle,
  CreditCard,
  Building,
  AlertCircle,
  Loader2,
  Briefcase,
  User,
  Wallet,
} from "lucide-react";
import {
  useHomeownerAppointments,
  useHomeownerProperties,
  useHomeownerPayments,
} from "../../hooks/useHomeownerData";
import { useConversations } from "../../hooks/useConversations";
import { useServices } from "../../hooks/useServices";
import DesktopSidebar from "../../components/DesktopSidebar";
import TopBar from "../../components/TopBar";
import MobileNavigation from "../../components/MobileNavigation";
import MobileSidebar from "../../components/MobileSidebar";
import MessagesPage from "../../components/MessagesPage";
import RequestAppointmentButton from "../../components/RequestAppointmentButton";
import ScrollAwareRequestFab from "../../components/homeowner/ScrollAwareRequestFab";
import { useHomeownerRequests } from "../../hooks/useHomeownerRequests";
import PropertiesPage from "../../components/PropertiesPage";
import ServicesPage from "../../components/ServicesPage";
import PaymentMethodsPage from "../../components/PaymentMethodsPage";
import HomePage from "../../components/homeowner/HomePage";
import {
  HOMEOWNER_DASHBOARD_TAB_IDS,
  usePersistedDashboardTab,
} from "../../hooks/usePersistedDashboardTab";
import { useAppointmentPanel } from "../../hooks/useAppointmentPanel";
import AppointmentPanelHost from "../../components/AppointmentPanelHost";
import { AppointmentCardData } from "../../components/AppointmentCard";
import ConfirmModal from "../../components/ConfirmModal";

function HomeownerDashboardInner() {
  const { user, loading, signOut, orgStatus, reloadOrganization } = useAuth();
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
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
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
  const {
    requests: homeownerRequests,
    refetch: refetchHomeownerRequests,
    cancelRequest,
    cancelling: cancellingRequest,
  } = useHomeownerRequests();

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

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
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

  // Persistent left sidebar tabs (desktop) — mirrors cleaner pattern (Messages + Settings live on top bar).
  const sidebarTabs = useMemo(
    () => [
      { id: "home", label: "Home", icon: Home },
      { id: "properties", label: "Properties", icon: Building },
      { id: "payments", label: "Payments", icon: CreditCard },
      { id: "payment-methods", label: "Payment Methods", icon: Wallet },
      { id: "services", label: "Services", icon: Briefcase },
    ],
    [],
  );

  // Show loading while checking auth or while the org context is still resolving.
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

  // Org context failed to load (transient) — offer retry, not a blank dashboard.
  if (orgStatus === "error") {
    return <WorkspaceErrorScreen onRetry={() => void reloadOrganization()} />;
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
  ];

  // Bottom mobile nav — surface the most-used tabs.
  const mobileNavTabs = [
    { id: "home", label: "Home", icon: Home },
    { id: "payments", label: "Payments", icon: CreditCard },
    {
      id: "messages",
      label: "Messages",
      icon: MessageCircle,
      hasNotification: hasUnreadMessages,
    },
    { id: "properties", label: "Properties", icon: Building },
  ];

  const renderHome = () => (
    <HomePage
      firstName={user?.profile?.firstName}
      appointments={appointments as AppointmentCardData[]}
      appointmentsLoading={appointmentsLoading}
      appointmentsError={appointmentsError ?? null}
      pendingRequests={homeownerRequests}
      cancellingRequest={cancellingRequest}
      onCancelRequestClick={setCancelTargetId}
      onOpenAppointment={openAppointment}
    />
  );

  const handleRequestCreated = () => {
    refetchAppointments();
    refetchHomeownerRequests();
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
        return renderHome();
      case "messages":
        return renderMessages();
      case "payments":
        return renderPayments();
      case "payment-methods":
        return <PaymentMethodsPage />;
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
      default:
        return renderHome();
    }
  };

  return (
    <MotionConfig reducedMotion="user">
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
            primaryAction={
              <RequestAppointmentButton
                onCreated={handleRequestCreated}
                className="inline-flex items-center gap-2 h-10 px-4 bg-primary-600 text-white text-sm font-semibold rounded-full shadow-sm hover:bg-primary-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
              />
            }
            onOpenAppointment={(id) => openAppointment(id)}
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

      {/* Mobile FAB — primary action visible from every tab on mobile.
          Shrinks to icon on scroll-down, expands on scroll-up. */}
      <div
        className="md:hidden fixed right-4 z-30"
        style={{ bottom: "calc(6.25rem + env(safe-area-inset-bottom))" }}
      >
        <ScrollAwareRequestFab onCreated={handleRequestCreated} />
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
      <AppointmentPanelHost
        appointments={appointments as unknown as AppointmentCardData[]}
        appointmentId={openAppointmentId}
        isOpen={isAppointmentPanelOpen}
        onClose={closeAppointment}
        role="homeowner"
        canEdit={false}
        onRefreshAppointments={refetchAppointments}
      />
      <ConfirmModal
        isOpen={!!cancelTargetId}
        onClose={() => setCancelTargetId(null)}
        onConfirm={async () => {
          const id = cancelTargetId;
          if (!id) return;
          try {
            await cancelRequest(id);
          } catch (err) {
            console.error(err);
          } finally {
            setCancelTargetId(null);
          }
        }}
        title="Cancel this request?"
        message="Your cleaning team won't be notified, and you can submit a new request anytime."
        confirmText="Yes, cancel"
        cancelText="Go back"
        loadingText="Cancelling…"
        tone="warning"
        isLoading={cancellingRequest}
      />
      </div>
    </MotionConfig>
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
