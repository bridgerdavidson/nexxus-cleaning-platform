"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import {
  Calendar,
  Users,
  MessageCircle,
  DollarSign,
  BarChart3,
  Settings,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  TrendingUp,
  UserCheck,
  Home,
  Loader2,
  Search,
  Trash2,
  Star,
  Building,
  HelpCircle,
  LayoutGrid,
  ChevronDown,
  ChevronUp,
  Clock,
  Mail,
} from "lucide-react";
import {
  useAdminAppointments,
  useAdminCleaners,
  useAdminCustomers,
  useAdminProperties,
  useAdminStats,
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
import PaymentsPage from "../../components/PaymentsPage";
import CleanerSidePanel from "../../components/CleanerSidePanel";

export default function AdminDashboard() {
  const { user, loading, signOut } = useAuth();
  const [activeGroup, setActiveGroup] = useState("operations");
  const [activeTab, setActiveTab] = useState("home");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
  const [selectedCleaner, setSelectedCleaner] = useState<any | null>(null);
  const [isCleanerSidePanelOpen, setIsCleanerSidePanelOpen] = useState(false);
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
  const { stats, loading: statsLoading } = useAdminStats();
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
      return `${first_name} ${last_name}`;
    }
    return "Unknown";
  };

  const getCleanerName = (appointment: any) => {
    if (appointment.cleaner_profile?.user_profile) {
      const { first_name, last_name } =
        appointment.cleaner_profile.user_profile;
      return `${first_name} ${last_name}`;
    }
    return null;
  };

  const getPropertyAddress = (appointment: any) => {
    if (appointment.property) {
      const { address, city, state } = appointment.property;
      return `${address}, ${city}, ${state}`;
    }
    return "Address not available";
  };

  const getCleanerFullName = (cleaner: any) => {
    if (cleaner.user_profile) {
      const { first_name, last_name } = cleaner.user_profile;
      return `${first_name} ${last_name}`;
    }
    return "Unknown";
  };

  const handleApproveAppointment = async (appointmentId: string) => {
    const result = await updateAppointmentStatus(appointmentId, "confirmed");
    if (result.success) {
      // Refresh appointments data (pending approvals and bookings table)
      await refetchAppointments();
    } else {
      alert("Failed to approve appointment: " + result.error);
    }
  };

  const handleDeclineAppointment = async (appointmentId: string) => {
    const result = await updateAppointmentStatus(appointmentId, "cancelled");
    if (result.success) {
      // Refresh appointments data (pending approvals and bookings table)
      await refetchAppointments();
    } else {
      alert("Failed to decline appointment: " + result.error);
    }
  };

  const handleLogout = async () => {
    await signOut();
  };

  // Hierarchical navigation structure
  const navigationGroups = {
    operations: {
      id: "operations" as const,
      label: "Operations",
      icon: LayoutGrid,
      tabs: [
        { id: "home", label: "Overview", icon: Home },
        { id: "bookings", label: "Bookings", icon: Calendar },
        { id: "messages", label: "Messages", icon: MessageCircle },
        { id: "customers", label: "Customers", icon: Users },
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
        { id: "cleaners", label: "Cleaners", icon: UserCheck },
        { id: "team", label: "Team Members", icon: Users },
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
    admin: {
      id: "admin" as const,
      label: "Administration",
      icon: Settings,
      tabs: [
        { id: "settings", label: "Settings", icon: Settings },
        { id: "support", label: "Support", icon: HelpCircle },
      ],
    },
  };

  // Get groups array for sidebar
  const groups = Object.values(navigationGroups);

  // Get tabs for current group
  const currentGroupTabs =
    navigationGroups[activeGroup as keyof typeof navigationGroups]?.tabs || [];

  // Filter out "customers" from top navigation when in operations group (it appears in Accounts sidebar instead)
  const topNavTabs =
    activeGroup === "operations"
      ? currentGroupTabs.filter((tab) => tab.id !== "customers")
      : currentGroupTabs;

  // Get all tabs for mobile (deduplicate by id to avoid duplicates when tab appears in multiple groups)
  const allTabs = Array.from(
    new Map(groups.flatMap((g) => g.tabs).map((tab) => [tab.id, tab])).values()
  );

  // Handle group change - switch to first tab of new group
  const handleGroupChange = (groupId: string) => {
    setActiveGroup(groupId);
    const newGroup = navigationGroups[groupId as keyof typeof navigationGroups];
    if (newGroup && newGroup.tabs.length > 0) {
      setActiveTab(newGroup.tabs[0].id);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "text-yellow-600 bg-yellow-100";
      case "confirmed":
        return "text-primary-600 bg-primary-100";
      case "completed":
        return "text-green-600 bg-green-100";
      case "cancelled":
        return "text-red-600 bg-red-100";
      default:
        return "text-gray-600 bg-gray-100";
    }
  };

  // Get upcoming appointments (confirmed, not completed)
  const upcomingAppointments = appointments
    .filter((a) => a.status === "confirmed" || a.status === "pending")
    .sort((a, b) => {
      const dateA = new Date(`${a.scheduled_date}T${a.scheduled_time}`);
      const dateB = new Date(`${b.scheduled_date}T${b.scheduled_time}`);
      return dateA.getTime() - dateB.getTime();
    })
    .slice(0, 5);

  const pendingAppointments = appointments.filter(
    (a) => a.status === "pending"
  );

  const renderOverview = () => (
    <div className="space-y-4 md:space-y-6">
      {/* Mobile Header - Compact */}
      <div className="md:hidden">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-4xl font-bold text-gray-900">Overview</h2>
          <span className="px-2 py-0.5 bg-primary-100 text-primary-700 text-xs font-semibold rounded-full">
            Admin
          </span>
        </div>
      </div>

      {/* Desktop Header - Original */}
      <div className="hidden md:block mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-4xl font-bold text-gray-900">Overview</h2>
          <span className="px-2.5 py-1 bg-primary-100 text-primary-700 text-xs font-semibold rounded-full">
            Admin Dashboard
          </span>
        </div>
        <p className="text-gray-600">
          Manage your cleaning business operations from one central location.
        </p>
      </div>

      {/* Mobile Quick Stats Bar */}
      <div className="md:hidden bg-white rounded-xl shadow-sm border border-gray-100 p-3">
        <div className="flex items-center justify-between">
          {statsLoading ? (
            <div className="flex items-center justify-center w-full py-2">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              <div className="flex-1 text-center border-r border-gray-200">
                <p className="text-xl font-bold text-amber-600">
                  {stats.pendingApprovals}
                </p>
                <p className="text-xs text-gray-500">Pending</p>
              </div>
              <div className="flex-1 text-center border-r border-gray-200">
                <p className="text-xl font-bold text-primary-600">
                  {stats.totalBookings}
                </p>
                <p className="text-xs text-gray-500">Bookings</p>
              </div>
              <div className="flex-1 text-center">
                <p className="text-xl font-bold text-green-600">
                  ${stats.totalRevenue}
                </p>
                <p className="text-xs text-gray-500">Revenue</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mobile Pending Approvals - Priority Section */}
      <div className="md:hidden">
        {pendingAppointments.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-amber-200 overflow-hidden">
            <div className="bg-amber-50 px-4 py-3 border-b border-amber-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <h3 className="font-semibold text-gray-900">
                    Pending Approvals
                  </h3>
                </div>
                <span className="bg-amber-600 text-white text-xs font-bold px-2 py-1 rounded-full">
                  {pendingAppointments.length}
                </span>
              </div>
            </div>
            <div className="divide-y divide-gray-100">
              {appointmentsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : (
                pendingAppointments.slice(0, 3).map((appointment) => (
                  <div key={appointment.id} className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {getHomeownerName(appointment)}
                        </p>
                        <div className="flex items-center gap-1 text-sm text-gray-500 mt-1">
                          <Clock className="w-3.5 h-3.5" />
                          <span>
                            {formatDateTime(
                              appointment.scheduled_date,
                              appointment.scheduled_time
                            )}
                          </span>
                        </div>
                        {appointment.service_type && (
                          <p className="text-sm text-gray-500 mt-0.5">
                            {appointment.service_type.name}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApproveAppointment(appointment.id)}
                        className="flex-1 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium text-sm"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => handleDeclineAppointment(appointment.id)}
                        className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium text-sm"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
            {pendingAppointments.length > 3 && (
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                <button
                  onClick={() => setActiveTab("bookings")}
                  className="w-full text-center text-sm font-medium text-primary-600"
                >
                  View all {pendingAppointments.length} pending
                </button>
              </div>
            )}
          </div>
        )}
        {pendingAppointments.length === 0 && !appointmentsLoading && (
          <div className="bg-white rounded-xl shadow-sm border border-green-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-full">
                <CheckCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="font-medium text-gray-900">All caught up!</p>
                <p className="text-sm text-gray-500">No pending approvals</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Collapsible All Stats Section */}
      <div className="md:hidden">
        <button
          onClick={() => setIsStatsExpanded(!isStatsExpanded)}
          className="w-full bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center justify-between"
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
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign className="w-4 h-4 text-green-600" />
                <span className="text-xs text-gray-500">Revenue</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">
                ${stats.totalRevenue}
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <span className="text-xs text-gray-500">Growth</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {stats.monthlyGrowth}%
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-xs text-gray-500">Completion</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {stats.completionRate}%
              </p>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="text-xs text-gray-500">Pending</span>
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {stats.pendingApprovals}
              </p>
            </div>
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
            upcomingAppointments.map((appointment) => (
              <div key={appointment.id} className="p-4 flex items-center gap-4">
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
                      <span>{appointment.scheduled_time}</span>
                    </div>
                    {appointment.service_type && (
                      <span className="text-sm text-gray-500">
                        {appointment.service_type.name}
                      </span>
                    )}
                  </div>
                </div>
                <span
                  className={`px-2 py-1 text-xs font-medium rounded-full ${
                    appointment.status === "confirmed"
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {appointment.status}
                </span>
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">No upcoming appointments</p>
            </div>
          )}
        </div>
      </div>

      {/* Desktop Stats Cards - Original Layout */}
      <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
        <div className="card flex items-center">
          <div className="p-2 bg-primary-100 rounded-lg">
            <Calendar className="w-6 h-6 text-primary-600" />
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600">Total Bookings</p>
            {statsLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            ) : (
              <p className="text-2xl font-bold text-gray-900">
                {stats.totalBookings}
              </p>
            )}
          </div>
        </div>

        <div className="card flex items-center">
          <div className="p-2 bg-primary-100 rounded-lg">
            <Users className="w-6 h-6 text-primary-600" />
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600">Active Cleaners</p>
            {statsLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            ) : (
              <p className="text-2xl font-bold text-gray-900">
                {stats.activeCleaners}
              </p>
            )}
          </div>
        </div>

        <div className="card flex items-center">
          <div className="p-2 bg-primary-100 rounded-lg">
            <DollarSign className="w-6 h-6 text-primary-600" />
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600">Total Revenue</p>
            {statsLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            ) : (
              <p className="text-2xl font-bold text-gray-900">
                ${stats.totalRevenue}
              </p>
            )}
          </div>
        </div>

        <div className="card flex items-center">
          <div className="p-2 bg-primary-100 rounded-lg">
            <AlertTriangle className="w-6 h-6 text-primary-600" />
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600">Pending</p>
            {statsLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            ) : (
              <p className="text-2xl font-bold text-gray-900">
                {stats.pendingApprovals}
              </p>
            )}
          </div>
        </div>

        <div className="card flex items-center">
          <div className="p-2 bg-primary-100 rounded-lg">
            <TrendingUp className="w-6 h-6 text-primary-600" />
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600">Growth</p>
            {statsLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            ) : (
              <p className="text-2xl font-bold text-gray-900">
                {stats.monthlyGrowth}%
              </p>
            )}
          </div>
        </div>

        <div className="card flex items-center">
          <div className="p-2 bg-primary-100 rounded-lg">
            <CheckCircle className="w-6 h-6 text-primary-600" />
          </div>
          <div className="ml-4">
            <p className="text-sm font-medium text-gray-600">Completion</p>
            {statsLoading ? (
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            ) : (
              <p className="text-2xl font-bold text-gray-900">
                {stats.completionRate}%
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Desktop Quick Actions - Original Two Column Layout */}
      <div className="hidden md:grid md:grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Pending Approvals
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
              {pendingAppointments.slice(0, 3).map((appointment) => (
                <div
                  key={appointment.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-900">
                      {getHomeownerName(appointment)}
                    </p>
                    <p className="text-sm text-gray-600">
                      {formatDateTime(
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
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleApproveAppointment(appointment.id)}
                      className="px-4 py-3 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors font-medium"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleDeclineAppointment(appointment.id)}
                      className="px-4 py-3 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors font-medium"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
              {pendingAppointments.length === 0 && (
                <div className="text-center py-8">
                  <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-2" />
                  <p className="text-gray-600">No pending approvals</p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Upcoming Appointments
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
              {upcomingAppointments.slice(0, 3).map((appointment) => (
                <div
                  key={appointment.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                      <Calendar className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {getHomeownerName(appointment)}
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatDateTime(
                          appointment.scheduled_date,
                          appointment.scheduled_time
                        )}
                      </p>
                      {appointment.service_type && (
                        <p className="text-sm text-gray-500">
                          {appointment.service_type.name}
                        </p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      appointment.status === "confirmed"
                        ? "text-green-600 bg-green-100"
                        : "text-amber-600 bg-amber-100"
                    }`}
                  >
                    {appointment.status}
                  </span>
                </div>
              ))}
              {upcomingAppointments.length === 0 && (
                <div className="text-center py-8">
                  <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">No upcoming appointments</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
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

  const renderBookings = () => (
    <BookingsPage
      appointments={appointments}
      loading={appointmentsLoading}
      onCancelAppointment={handleCancelAppointment}
      onDeleteAppointment={handleDeleteAppointment}
      onMarkComplete={handleMarkComplete}
      onRefreshAppointments={refetchAppointments}
      onAppointmentUpdated={(id, data) => updateAppointmentInState(id, data)}
      role="admin"
    />
  );

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
          <button
            onClick={() => setShowAddCleanerModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors whitespace-nowrap shadow-md"
          >
            <UserCheck className="w-5 h-5" />
            <span>New</span>
          </button>
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
            {!searchQuery && availabilityFilter === "all" && (
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
                  <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-primary-600 font-semibold text-sm">
                      {getCleanerInitials(cleaner)}
                    </span>
                  </div>
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

  const renderMessages = () => (
    <MessagesPage
      userId={user.id}
      userRole="admin"
      conversations={conversations}
      loading={conversationsLoading}
      error={conversationsError}
      onRefresh={refetchConversations}
      onUpdateUnreadCount={updateUnreadCount}
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

  const renderAnalytics = () => (
    <div className="space-y-6">
      <h2 className="text-4xl font-bold text-gray-900">Analytics & Reports</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Booking Trends
          </h3>
          <div className="text-center py-12">
            <BarChart3 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">Chart visualization coming soon</p>
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Revenue Growth
          </h3>
          <div className="text-center py-12">
            <TrendingUp className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">Revenue chart coming soon</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Key Metrics
        </h3>
        {statsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Loading analytics...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">
                {stats.completionRate}%
              </p>
              <p className="text-sm text-gray-600">Completion Rate</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">
                {stats.avgRating}
              </p>
              <p className="text-sm text-gray-600">Avg Rating</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">
                {stats.avgJobsPerDay}
              </p>
              <p className="text-sm text-gray-600">Avg Jobs/Day</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">
                ${stats.avgJobValue}
              </p>
              <p className="text-sm text-gray-600">Avg Job Value</p>
            </div>
          </div>
        )}
      </div>
    </div>
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
      case "settings":
        return renderPlaceholder(
          "Settings",
          "Configure system settings, notifications, and preferences."
        );
      case "support":
        return renderPlaceholder(
          "Support Center",
          "Access help resources and contact support."
        );
      default:
        return renderOverview();
    }
  };

  return (
    <div
      className={`min-h-screen ${
        activeTab === "messages" ? "bg-white md:bg-gray-50" : "bg-gray-50"
      }`}
    >
      {/* Persistent Desktop Sidebar - Shows Groups */}
      <DesktopSidebar
        groups={groups}
        activeGroup={activeGroup}
        onGroupChange={handleGroupChange}
        onLogout={handleLogout}
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
            onTabChange={setActiveTab}
            onMobileMenuClick={() => setIsSidebarOpen(true)}
          />
        </div>

        {/* Main Content Area */}
        <main
          className={`${
            activeTab === "messages"
              ? "p-0 md:p-4 md:sm:p-6 md:lg:p-8"
              : "p-4 sm:p-6 lg:p-8"
          } pb-24 md:pb-8`}
        >
          {renderContent()}
        </main>
      </div>

      {/* Mobile Bottom Navigation - Show first 4 tabs */}
      <MobileNavigation
        tabs={navigationGroups.operations.tabs}
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
    </div>
  );
}
