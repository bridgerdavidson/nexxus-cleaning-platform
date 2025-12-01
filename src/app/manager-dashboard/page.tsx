"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import {
  Calendar,
  Users,
  MessageCircle,
  DollarSign,
  CheckCircle,
  Clock,
  MapPin,
  AlertCircle,
  Star,
  Loader2,
  Home,
  Search,
  Trash2,
} from "lucide-react";
import {
  useManagerAppointments,
  useManagerCleaners,
  useManagerPayments,
  useManagerMessages,
  updateAppointmentStatus,
  assignCleanerToAppointment,
  updateCleanerAvailability,
  deleteCleaner,
} from "../../hooks/useManagerData";
import DashboardHeader from "../../components/DashboardHeader";
import MobileNavigation from "../../components/MobileNavigation";
import MobileSidebar from "../../components/MobileSidebar";
import AddCleanerModal from "../../components/AddCleanerModal";
import DeleteConfirmModal from "../../components/DeleteConfirmModal";

export default function ManagerDashboard() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState("home");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showAddCleanerModal, setShowAddCleanerModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<"all" | "available" | "unavailable">("all");
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
  const router = useRouter();

  // Real data hooks - must be called at top level
  const {
    appointments,
    loading: appointmentsLoading,
    error: appointmentsError,
  } = useManagerAppointments();
  const {
    cleaners,
    loading: cleanersLoading,
    error: cleanersError,
    refetch: refetchCleaners,
  } = useManagerCleaners();
  const {
    payments,
    loading: paymentsLoading,
    error: paymentsError,
  } = useManagerPayments();
  const {
    messages,
    loading: messagesLoading,
    error: messagesError,
  } = useManagerMessages();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

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

  const tabs = [
    { id: "home", label: "Overview", icon: Home },
    { id: "appointments", label: "Appointments", icon: MapPin },
    { id: "cleaners", label: "Cleaners", icon: Users },
    { id: "payments", label: "Payments", icon: DollarSign },
    { id: "messages", label: "Messages", icon: MessageCircle },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "text-primary-600 bg-primary-100";
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

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-3xl font-bold text-gray-900">Overview</h2>
          <span className="px-2.5 py-1 bg-primary-100 text-primary-700 text-xs font-semibold rounded-full">
            Manager Dashboard
          </span>
        </div>
        <p className="text-gray-600">
          Manage your team operations and oversee cleaning services from one central location.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-primary-100 rounded-lg">
              <Calendar className="w-6 h-6 text-primary-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Total Appointments
              </p>
              {appointmentsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  {appointments.length}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <Users className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Active Cleaners
              </p>
              {cleanersLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  {cleaners.filter((c) => c.is_available).length}
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
              <p className="text-sm font-medium text-gray-600">
                Pending Appointments
              </p>
              {appointmentsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  {appointments.filter((a) => a.status === "pending").length}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <DollarSign className="w-6 h-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">
                Pending Payments
              </p>
              {paymentsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  {payments.filter((p) => p.status === "pending").length}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Appointments */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Recent Appointments
        </h3>
        {appointmentsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="space-y-4">
            {appointments.slice(0, 5).map((appointment) => (
              <div
                key={appointment.id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center space-x-4">
                  <Calendar className="w-8 h-8 text-primary-600" />
                  <div>
                    <p className="font-medium text-gray-900">
                      {appointment.homeowner
                        ? `${appointment.homeowner.first_name} ${appointment.homeowner.last_name}`
                        : "Unknown"}
                    </p>
                    <p className="text-sm text-gray-600">
                      {new Date(
                        appointment.scheduled_date
                      ).toLocaleDateString()}{" "}
                      at {appointment.scheduled_time}
                    </p>
                    <p className="text-sm text-gray-600">
                      {appointment.service_type?.name}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <span
                    className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${getStatusColor(
                      appointment.status
                    )}`}
                  >
                    {appointment.status}
                  </span>
                  <p className="text-lg font-semibold text-gray-900">
                    ${appointment.total_price}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderAppointments = () => (
    <div className="card">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
        All Appointments
      </h2>
      {appointmentsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : appointmentsError ? (
        <div className="text-center py-12">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <p className="text-gray-600">{appointmentsError}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Date/Time
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Homeowner
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Cleaner
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Service
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Price
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {appointments.map((appointment) => (
                <tr key={appointment.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {new Date(appointment.scheduled_date).toLocaleDateString()}
                    <br />
                    {appointment.scheduled_time}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {appointment.homeowner
                      ? `${appointment.homeowner.first_name} ${appointment.homeowner.last_name}`
                      : "N/A"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {appointment.cleaner_profile?.user_profile
                      ? `${appointment.cleaner_profile.user_profile.first_name} ${appointment.cleaner_profile.user_profile.last_name}`
                      : "Unassigned"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {appointment.service_type?.name || "N/A"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                        appointment.status
                      )}`}
                    >
                      {appointment.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    ${appointment.total_price}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const handleDeleteCleaner = async () => {
    if (!deleteConfirmModal.cleanerId) return;

    setIsDeleting(true);
    const result = await deleteCleaner(deleteConfirmModal.cleanerId);
    setIsDeleting(false);

    if (result.success) {
      setDeleteConfirmModal({ isOpen: false, cleanerId: null, cleanerName: "" });
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
      const matchesSearch =
        searchQuery === "" ||
        fullName.includes(searchQuery.toLowerCase()) ||
        cleaner.user_profile?.email?.toLowerCase().includes(searchQuery.toLowerCase());

      // Availability filter
      const matchesAvailability =
        availabilityFilter === "all" ||
        (availabilityFilter === "available" && cleaner.is_available) ||
        (availabilityFilter === "unavailable" && !cleaner.is_available);

      return matchesSearch && matchesAvailability;
    });

    return (
      <div className="card">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">
            Cleaner Management
          </h2>
          <button 
            className="btn-primary"
            onClick={() => setShowAddCleanerModal(true)}
          >
            Add New Cleaner
          </button>
        </div>

        {/* Search and Filter Controls */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          {/* Search Input */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field pl-10 w-full"
            />
          </div>

          {/* Availability Filter Dropdown */}
          <select
            value={availabilityFilter}
            onChange={(e) => setAvailabilityFilter(e.target.value as "all" | "available" | "unavailable")}
            className="input-field w-full sm:w-auto sm:min-w-[140px] text-sm"
          >
            <option value="all">All Cleaners</option>
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </div>

        {cleanersLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : cleanersError ? (
          <div className="text-center py-12">
            <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <p className="text-gray-600">{cleanersError}</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredCleaners.map((cleaner) => (
            <div
              key={cleaner.id}
              className="border border-gray-200 rounded-lg p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {cleaner.user_profile
                      ? `${cleaner.user_profile.first_name} ${cleaner.user_profile.last_name}`
                      : "Unknown"}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {cleaner.user_profile?.email}
                  </p>
                </div>
                <div className="flex items-center space-x-1">
                  <Star className="w-5 h-5 text-yellow-400 fill-current" />
                  <span className="text-sm font-medium text-gray-900">
                    {cleaner.rating.toFixed(1)}
                  </span>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Total Jobs:</span>
                  <span className="font-medium text-gray-900">
                    {cleaner.total_jobs}
                  </span>
                </div>
                {cleaner.experience_years && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Experience:</span>
                    <span className="font-medium text-gray-900">
                      {cleaner.experience_years} years
                    </span>
                  </div>
                )}
                {cleaner.hourly_rate && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">Hourly Rate:</span>
                    <span className="font-medium text-gray-900">
                      ${cleaner.hourly_rate}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center space-x-2 mb-4">
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

              <div className="space-y-2">
                <button
                  className={`w-full py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
                    cleaner.is_available
                      ? "bg-green-100 text-green-700 hover:bg-green-200"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {cleaner.is_available ? "Available" : "Unavailable"}
                </button>
                <button
                  className="w-full bg-red-100 text-red-600 hover:bg-red-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center space-x-2"
                  onClick={() =>
                    setDeleteConfirmModal({
                      isOpen: true,
                      cleanerId: cleaner.id,
                      cleanerName: cleaner.user_profile
                        ? `${cleaner.user_profile.first_name} ${cleaner.user_profile.last_name}`
                        : "Unknown",
                    })
                  }
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete</span>
                </button>
              </div>
            </div>
            ))}
            {filteredCleaners.length === 0 && (
              <div className="col-span-full text-center py-12">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">
                  {cleaners.length === 0
                    ? "No cleaners found"
                    : "No cleaners match your search or filter criteria"}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderPayments = () => (
    <div className="card">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">
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
    <div className="card">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Messages</h2>
      {messagesLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : messagesError ? (
        <div className="text-center py-12">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <p className="text-gray-600">{messagesError}</p>
        </div>
      ) : messages.length === 0 ? (
        <div className="text-center py-12">
          <MessageCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">No messages</p>
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <div key={message.id} className="border-b border-gray-200 pb-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="flex items-center space-x-2">
                    <p className="font-medium text-gray-900">
                      {message.sender
                        ? `${message.sender.first_name} ${message.sender.last_name}`
                        : "Unknown"}
                    </p>
                    <span className="text-xs text-gray-500">→</span>
                    <p className="font-medium text-gray-900">
                      {message.recipient
                        ? `${message.recipient.first_name} ${message.recipient.last_name}`
                        : "Unknown"}
                    </p>
                  </div>
                  {message.subject && (
                    <p className="text-sm font-medium text-gray-800 mt-1">
                      {message.subject}
                    </p>
                  )}
                  <p className="text-sm text-gray-600 mt-1">
                    {message.content}
                  </p>
                </div>
                <span className="text-xs text-gray-500">
                  {new Date(message.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case "home":
        return renderOverview();
      case "appointments":
        return renderAppointments();
      case "cleaners":
        return renderCleaners();
      case "payments":
        return renderPayments();
      case "messages":
        return renderMessages();
      default:
        return renderOverview();
    }
  };

  return (
    <>
      <DashboardHeader
        role="manager"
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24 md:pb-8">
          {/* Tab Content */}
          {renderContent()}
        </div>
      </div>
      <MobileNavigation
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onMenuClick={() => setIsSidebarOpen(true)}
      />
      <MobileSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        role="manager"
      />
      <AddCleanerModal
        isOpen={showAddCleanerModal}
        onClose={() => setShowAddCleanerModal(false)}
      />
      <DeleteConfirmModal
        isOpen={deleteConfirmModal.isOpen}
        onClose={() =>
          setDeleteConfirmModal({ isOpen: false, cleanerId: null, cleanerName: "" })
        }
        onConfirm={handleDeleteCleaner}
        title="Delete Cleaner"
        message="Are you sure you want to delete this cleaner? This action cannot be undone."
        itemName={deleteConfirmModal.cleanerName}
        isLoading={isDeleting}
      />
    </>
  );
}
