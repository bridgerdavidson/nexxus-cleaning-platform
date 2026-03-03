"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import {
  SprayCan,
  Calendar,
  Home,
  MessageCircle,
  CreditCard,
  Building,
  Plus,
  Clock,
  CheckCircle,
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
  useHomeownerStats,
  useHomeownerMessages,
  useHomeownerPayments,
} from "../../hooks/useHomeownerData";
import { useConversations } from "../../hooks/useConversations";
import { useServices } from "../../hooks/useServices";
import DashboardHeader from "../../components/DashboardHeader";
import MobileNavigation from "../../components/MobileNavigation";
import MobileSidebar from "../../components/MobileSidebar";
import MessagesPage from "../../components/MessagesPage";
import AddAppointmentModal from "../../components/AddAppointmentModal";
import BookingsPage from "../../components/BookingsPage";
import AppointmentCard from "../../components/AppointmentCard";
import StatusBadge from "../../components/StatusBadge";
import PropertiesPage from "../../components/PropertiesPage";
import ServicesPage from "../../components/ServicesPage";
import ProfileSettingsPage from "../../components/ProfileSettingsPage";

export default function HomeownerDashboard() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState("home");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showAddAppointmentModal, setShowAddAppointmentModal] = useState(false);
  const [showAllFilter, setShowAllFilter] = useState(false);
  const [expandedActive, setExpandedActive] = useState(true);
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
    stats,
    loading: statsLoading,
    error: statsError,
  } = useHomeownerStats();
  const {
    messages,
    loading: messagesLoading,
    error: messagesError,
  } = useHomeownerMessages();
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

  const handleMarkComplete = async (appointmentId: string) => {
    // TODO: Implement mark complete functionality
    console.log("Mark complete:", appointmentId);
  };

  // Calculate if there are any unread messages
  const hasUnreadMessages = useMemo(() => {
    return conversations.some((conv) => conv.unread_count > 0);
  }, [conversations]);

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
    [appointments]
  );

  // Today's appointments only (includes in_progress; active also shown in Active Cleanings)
  const todaysAppointments = useMemo(
    () =>
      appointments
        .filter((a) => a.scheduled_date === todayStr)
        .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time)),
    [appointments, todayStr]
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
      if (activeAppointments.length > 0) setExpandedActive(true);
      else setExpandedActive(false);
    }
  }, [appointmentsLoading, activeAppointments.length]);
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

  // Helper function to get cleaner name
  const getCleanerName = (appointment: any) => {
    if (appointment.cleaner_profile?.user_profile) {
      const { first_name, last_name } =
        appointment.cleaner_profile.user_profile;
      return `${first_name} ${last_name}`;
    }
    return null;
  };

  // Helper function to get property address
  const getPropertyAddress = (appointment: any) => {
    if (appointment.property) {
      const { address, city, state } = appointment.property;
      return `${address}, ${city}, ${state}`;
    }
    return "Address not available";
  };

  // Main nav tabs (header + mobile bottom bar) — Payments is in side panel only
  const headerTabs = [
    { id: "home", label: "Overview", icon: Home },
    { id: "bookings", label: "My Bookings", icon: Calendar },
    {
      id: "messages",
      label: "Messages",
      icon: MessageCircle,
      hasNotification: hasUnreadMessages,
    },
    { id: "services", label: "Services", icon: Briefcase },
    { id: "properties", label: "Properties", icon: Building },
  ];

  // Full tabs for side panel only (includes Payments and Profile)
  const sidebarTabs = [
    ...headerTabs,
    { id: "payments", label: "Payments", icon: CreditCard },
    { id: "profile", label: "Profile", icon: User },
  ];

  const getPaymentStatusTabConfig = (
    paymentStatus: "pending" | "paid" | "failed" | "refunded" | null
  ) => {
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

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Welcome Section with Inline Actions */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-4xl font-bold text-gray-900">Overview</h2>
            <span className="px-2.5 py-1 bg-primary-100 text-primary-700 text-xs font-semibold rounded-full">
              Homeowner Dashboard
            </span>
          </div>
          <p className="text-gray-600">
            Manage your cleaning appointments and properties from one central
            location.
          </p>
        </div>
        {/* Quick Actions - Pill Buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowAddAppointmentModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors shadow-sm hover:shadow-md"
          >
            <Plus className="w-5 h-5" />
            <span>Request New Cleaning</span>
          </button>
          <button
            onClick={() => setActiveTab("messages")}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 border border-gray-300 rounded-full font-medium hover:bg-gray-50 transition-colors shadow-sm"
          >
            <MessageCircle className="w-5 h-5" />
            <span>Contact Support</span>
          </button>
          <button
            onClick={() => setActiveTab("bookings")}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-gray-700 border border-gray-300 rounded-full font-medium hover:bg-gray-50 transition-colors shadow-sm"
          >
            <Calendar className="w-5 h-5" />
            <span>View Schedule</span>
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-primary-100 rounded-lg">
              <CheckCircle className="w-6 h-6 text-primary-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Total Cleanings
              </p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  {stats.totalCleanings}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Clock className="w-6 h-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Upcoming</p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  {stats.upcomingCleanings}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <CreditCard className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Spent</p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  ${stats.totalSpent}
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
              <p className="text-sm font-medium text-gray-600">
                Favorite Cleaners
              </p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  {stats.favoriteCleaners}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Active Cleanings - collapsible; auto-collapsed when empty */}
      <div>
        <button
          type="button"
          onClick={() => setExpandedActive((prev) => !prev)}
          className="w-full text-left flex items-center gap-2 mb-4 group"
        >
          {(activeAppointments.length > 0 ? expandedActive : false) ? (
            <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0 transition-transform group-hover:text-gray-700" />
          ) : (
            <ChevronRight className="w-5 h-5 text-gray-500 flex-shrink-0 transition-transform group-hover:text-gray-700" />
          )}
          <SprayCan className="w-5 h-5 text-primary-600" />
          <h3 className="text-xl font-semibold text-gray-900">
            Active Cleanings
          </h3>
          <span className="text-sm font-normal text-gray-500">
            ({activeAppointments.length})
          </span>
        </button>
        {(activeAppointments.length > 0 ? expandedActive : false) && (
          <div className="space-y-4">
            {activeAppointments.map((appointment) => (
              <div key={appointment.id} className="animate-pulse-glow-gold rounded-lg">
                <AppointmentCard
                  appointment={appointment as Parameters<typeof AppointmentCard>[0]["appointment"]}
                  onClick={() => setActiveTab("bookings")}
                  role="homeowner"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Today's Appointments - collapsible; auto-collapsed when empty */}
      <div>
        <button
          type="button"
          onClick={() => setExpandedToday((prev) => !prev)}
          className="w-full text-left flex items-center gap-2 mb-4 group"
        >
          {(todaysAppointments.length > 0 || appointmentsLoading ? expandedToday : false) ? (
            <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0 transition-transform group-hover:text-gray-700" />
          ) : (
            <ChevronRight className="w-5 h-5 text-gray-500 flex-shrink-0 transition-transform group-hover:text-gray-700" />
          )}
          <Clock className="w-5 h-5 text-primary-600" />
          <h3 className="text-xl font-semibold text-gray-900">
            Today&apos;s Appointments
          </h3>
          <span className="text-sm font-normal text-gray-500">
            ({todaysAppointments.length})
          </span>
        </button>
        {(todaysAppointments.length > 0 || appointmentsLoading ? expandedToday : false) && (
          <>
            {appointmentsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-600">Loading...</span>
              </div>
            ) : todaysAppointments.length > 0 ? (
              <div className="space-y-4">
                {todaysAppointments.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment as Parameters<typeof AppointmentCard>[0]["appointment"]}
                    onClick={() => setActiveTab("bookings")}
                    role="homeowner"
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-white rounded-lg border border-gray-200">
                <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">No appointments scheduled for today</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Upcoming Appointments - collapsible; auto-collapsed when empty */}
      <div>
        <button
          type="button"
          onClick={() => setExpandedUpcoming((prev) => !prev)}
          className="w-full text-left flex items-center gap-2 mb-4 group"
        >
          {(allUpcomingAppointments.length > 0 || appointmentsLoading ? expandedUpcoming : false) ? (
            <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0 transition-transform group-hover:text-gray-700" />
          ) : (
            <ChevronRight className="w-5 h-5 text-gray-500 flex-shrink-0 transition-transform group-hover:text-gray-700" />
          )}
          <MapPin className="w-5 h-5 text-primary-600" />
          <h3 className="text-xl font-semibold text-gray-900">
            Upcoming Appointments
          </h3>
          <span className="text-sm font-normal text-gray-500">
            ({allUpcomingAppointments.length})
          </span>
        </button>
        {(allUpcomingAppointments.length > 0 || appointmentsLoading ? expandedUpcoming : false) && (
          <>
            {appointmentsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-600">Loading appointments...</span>
              </div>
            ) : appointmentsError ? (
              <div className="text-center py-8 bg-white rounded-lg border border-gray-200">
                <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-2" />
                <p className="text-red-600">Failed to load appointments</p>
              </div>
            ) : allUpcomingAppointments.length > 0 ? (
              <div className="space-y-4">
                {upcomingAppointments.map((appointment) => (
                  <AppointmentCard
                    key={appointment.id}
                    appointment={appointment as Parameters<typeof AppointmentCard>[0]["appointment"]}
                    onClick={() => setActiveTab("bookings")}
                    role="homeowner"
                  />
                ))}
                {allUpcomingAppointments.length > 3 && (
                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setShowAllFilter(true);
                        setActiveTab("bookings");
                      }}
                      className="w-full text-center py-2.5 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors rounded-lg border border-primary-200 hover:bg-primary-50"
                    >
                      View all ({allUpcomingAppointments.length})
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 bg-white rounded-lg border border-gray-200">
                <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">No upcoming appointments</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
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
        onMarkComplete={handleMarkComplete}
        onRefreshAppointments={refetchAppointments}
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
                          payment.appointment.scheduled_date
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
    const formattedProperties = properties.map(prop => ({
      ...prop,
      bedrooms: prop.bedrooms ?? null,
      bathrooms: prop.bathrooms ?? null,
      square_feet: prop.square_feet ?? null,
      special_instructions: null,
      access_instructions: null,
      created_at: '',
      updated_at: '',
      owner_id: user?.id || '',
      homeowner: {
        id: user?.id || '',
        first_name: (user as any)?.user_metadata?.first_name || '',
        last_name: (user as any)?.user_metadata?.last_name || '',
        email: user?.email || '',
        phone: (user as any)?.user_metadata?.phone || null,
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
          />
        );
      case "profile":
        return <ProfileSettingsPage />;
      default:
        return renderOverview();
    }
  };

  return (
    <>
      {/* Hide header on mobile for all tabs */}
      <div className="hidden md:block">
      <DashboardHeader
        role="homeowner"
        tabs={headerTabs}
        sidebarTabs={sidebarTabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
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
        tabs={headerTabs}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onMenuClick={() => setIsSidebarOpen(true)}
      />
      <MobileSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        role="homeowner"
        tabs={sidebarTabs}
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
    </>
  );
}
