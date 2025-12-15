import React, { useState, useMemo } from "react";
import {
  Search,
  Loader2,
  Calendar,
  CheckSquare,
  Square,
  Trash2,
  XCircle,
  Plus,
  ChevronDown,
} from "lucide-react";
import AppointmentCard, { AppointmentCardData } from "./AppointmentCard";
import AppointmentSidePanel from "./AppointmentSidePanel";
import CancelConfirmModal from "./CancelConfirmModal";
import BulkActionConfirmModal from "./BulkActionConfirmModal";
import AddAppointmentModal from "./AddAppointmentModal";

type TabType = "upcoming" | "all" | "completed" | "cancelled";

interface BookingsPageProps {
  appointments: AppointmentCardData[];
  loading: boolean;
  onCancelAppointment: (appointmentId: string) => Promise<void>;
  onDeleteAppointment: (appointmentId: string) => Promise<void>;
  onMarkComplete: (appointmentId: string) => Promise<void>;
  onEdit?: (appointmentId: string) => void;
  onRefreshAppointments?: () => void;
  role: "admin" | "manager";
  canEdit?: boolean;
}

export default function BookingsPage({
  appointments,
  loading,
  onCancelAppointment,
  onDeleteAppointment,
  onMarkComplete,
  onEdit,
  onRefreshAppointments,
  role,
  canEdit = true,
}: BookingsPageProps) {
  const [activeTab, setActiveTab] = useState<TabType>("upcoming");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentCardData | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancellingAppointmentId, setCancellingAppointmentId] = useState<
    string | null
  >(null);
  const [showAddAppointmentModal, setShowAddAppointmentModal] = useState(false);

  // Selection state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkAction, setBulkAction] = useState<"cancel" | "delete">("delete");
  const [isBulkActionLoading, setIsBulkActionLoading] = useState(false);

  // Get today's date for filtering
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Filter appointments by tab
  const filterByTab = (appointment: AppointmentCardData): boolean => {
    // Parse date string (YYYY-MM-DD) as local date to avoid timezone issues
    const [year, month, day] = appointment.scheduled_date
      .split("-")
      .map(Number);
    const appointmentDate = new Date(year, month - 1, day); // month is 0-indexed
    appointmentDate.setHours(0, 0, 0, 0);

    switch (activeTab) {
      case "upcoming":
        // Future appointments, excluding completed/cancelled
        return (
          appointmentDate >= today &&
          appointment.status !== "completed" &&
          appointment.status !== "cancelled"
        );
      case "all":
        return true;
      case "completed":
        return appointment.status === "completed";
      case "cancelled":
        return appointment.status === "cancelled";
      default:
        return true;
    }
  };

  // Filter by search query
  const filterBySearch = (appointment: AppointmentCardData): boolean => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    const homeownerName = appointment.homeowner
      ? `${appointment.homeowner.first_name} ${appointment.homeowner.last_name}`.toLowerCase()
      : "";
    const cleanerName = appointment.cleaner_profile?.user_profile
      ? `${appointment.cleaner_profile.user_profile.first_name} ${appointment.cleaner_profile.user_profile.last_name}`.toLowerCase()
      : "";
    const propertyAddress = appointment.property
      ? `${appointment.property.address} ${appointment.property.city} ${appointment.property.state}`.toLowerCase()
      : "";
    const serviceName = appointment.service_type?.name.toLowerCase() || "";

    return (
      homeownerName.includes(query) ||
      cleanerName.includes(query) ||
      propertyAddress.includes(query) ||
      serviceName.includes(query)
    );
  };

  // Filter by status
  const filterByStatus = (appointment: AppointmentCardData): boolean => {
    if (statusFilter === "all") return true;
    return appointment.status === statusFilter;
  };

  // Apply all filters
  const filteredAppointments = useMemo(() => {
    return appointments.filter(
      (apt) => filterByTab(apt) && filterBySearch(apt) && filterByStatus(apt)
    );
  }, [appointments, activeTab, searchQuery, statusFilter]);

  // Get unique statuses for filter dropdown
  const availableStatuses = useMemo(() => {
    const statuses = new Set(
      appointments.filter(filterByTab).map((apt) => apt.status)
    );
    return Array.from(statuses);
  }, [appointments, activeTab]);

  // Tab configuration
  const tabs: { id: TabType; label: string; count: number }[] = [
    {
      id: "upcoming",
      label: "Upcoming",
      count: appointments.filter((apt) => {
        // Parse date string (YYYY-MM-DD) as local date to avoid timezone issues
        const [year, month, day] = apt.scheduled_date.split("-").map(Number);
        const aptDate = new Date(year, month - 1, day); // month is 0-indexed
        aptDate.setHours(0, 0, 0, 0);
        return (
          aptDate >= today &&
          apt.status !== "completed" &&
          apt.status !== "cancelled"
        );
      }).length,
    },
    {
      id: "all",
      label: "All",
      count: appointments.length,
    },
    {
      id: "completed",
      label: "Completed",
      count: appointments.filter((apt) => apt.status === "completed").length,
    },
    {
      id: "cancelled",
      label: "Cancelled",
      count: appointments.filter((apt) => apt.status === "cancelled").length,
    },
  ];

  // Handle appointment card click
  const handleAppointmentClick = (appointment: AppointmentCardData) => {
    setSelectedAppointment(appointment);
    setShowSidePanel(true);
  };

  // Handle cancel from side panel
  const handleCancelFromPanel = (appointmentId: string) => {
    setCancellingAppointmentId(appointmentId);
    setShowCancelModal(true);
    setShowSidePanel(false);
  };

  // Handle cancel (soft delete)
  const handleCancel = async () => {
    if (cancellingAppointmentId) {
      await onCancelAppointment(cancellingAppointmentId);
      setShowCancelModal(false);
      setCancellingAppointmentId(null);
    }
  };

  // Handle delete (hard delete)
  const handleDelete = async () => {
    if (cancellingAppointmentId) {
      await onDeleteAppointment(cancellingAppointmentId);
      setShowCancelModal(false);
      setCancellingAppointmentId(null);
    }
  };

  // Handle mark complete
  const handleMarkComplete = async (appointmentId: string) => {
    await onMarkComplete(appointmentId);
    setShowSidePanel(false);
  };

  // Selection handlers
  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
    setSelectedIds(new Set());
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredAppointments.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredAppointments.map((apt) => apt.id)));
    }
  };

  const handleBulkCancel = () => {
    setBulkAction("cancel");
    setShowBulkModal(true);
  };

  const handleBulkDelete = () => {
    setBulkAction("delete");
    setShowBulkModal(true);
  };

  const confirmBulkAction = async () => {
    setIsBulkActionLoading(true);
    const selectedAppointments = Array.from(selectedIds);

    try {
      if (bulkAction === "cancel") {
        await Promise.all(
          selectedAppointments.map((id) => onCancelAppointment(id))
        );
      } else {
        await Promise.all(
          selectedAppointments.map((id) => onDeleteAppointment(id))
        );
      }
      setSelectedIds(new Set());
      setIsSelectMode(false);
      setShowBulkModal(false);
    } finally {
      setIsBulkActionLoading(false);
    }
  };

  // Check if all are selected
  const isAllSelected =
    filteredAppointments.length > 0 &&
    selectedIds.size === filteredAppointments.length;
  const isSomeSelected = selectedIds.size > 0 && !isAllSelected;

  // Get appointment info for cancel modal
  const cancellingAppointment = appointments.find(
    (apt) => apt.id === cancellingAppointmentId
  );
  const cancelModalInfo = cancellingAppointment
    ? {
        date: (() => {
          // Parse date string (YYYY-MM-DD) as local date to avoid timezone issues
          const [year, month, day] = cancellingAppointment.scheduled_date
            .split("-")
            .map(Number);
          const localDate = new Date(year, month - 1, day); // month is 0-indexed
          return localDate.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          });
        })(),
        time: cancellingAppointment.scheduled_time,
        homeowner: cancellingAppointment.homeowner
          ? `${cancellingAppointment.homeowner.first_name} ${cancellingAppointment.homeowner.last_name}`
          : "Unknown",
      }
    : undefined;

  // Get current tab label and count for dropdown display
  const currentTab = tabs.find((tab) => tab.id === activeTab);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-4xl font-bold text-gray-900">Bookings</h2>
        {/* Add New Appointment Button */}
        {canEdit && (
          <button
            onClick={() => setShowAddAppointmentModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors whitespace-nowrap shadow-md"
          >
            <Plus className="w-5 h-5" />
            <span>New</span>
          </button>
        )}
      </div>

      {/* Search Input - Own line on mobile */}
      <div className="flex-1 relative md:hidden">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search by homeowner, cleaner, property, or service..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
        />
      </div>

      {/* Filters Row - Mobile: Filters and Select Many inline, Desktop: All in one line with search */}
      <div className="flex flex-row gap-3 overflow-x-auto">
        {/* Search Input - Desktop only (in same line as filters) */}
        <div className="hidden md:flex flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by homeowner, cleaner, property, or service..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
          />
        </div>

        {/* Tab Dropdown */}
        <div className="relative flex-shrink-0 min-w-[140px]">
          <select
            value={activeTab}
            onChange={(e) => {
              setActiveTab(e.target.value as TabType);
              setStatusFilter("all");
            }}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white appearance-none pr-10 font-medium text-sm"
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label} ({tab.count})
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>

        {/* Status Filter Dropdown */}
        {availableStatuses.length > 0 && (
          <div className="relative flex-shrink-0 min-w-[140px]">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm appearance-none"
            >
              <option value="all">All Statuses</option>
              {availableStatuses.map((status) => (
                <option key={status} value={status}>
                  {status.charAt(0).toUpperCase() +
                    status.slice(1).replace("_", " ")}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}

        {/* Select Many Button - Only show if can edit */}
        {canEdit && (
          <button
            onClick={toggleSelectMode}
            className={`px-4 py-2.5 rounded-full font-medium transition-colors whitespace-nowrap border border-gray-300 flex-shrink-0 ${
              isSelectMode
                ? "bg-gray-600 text-white hover:bg-gray-700 border-gray-600"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {isSelectMode ? "Cancel Selection" : "Select Many"}
          </button>
        )}
      </div>

      {/* Bulk Action Bar */}
      {isSelectMode && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Select All Checkbox */}
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {isAllSelected ? (
                  <CheckSquare className="w-5 h-5 text-primary-600" />
                ) : isSomeSelected ? (
                  <div className="w-5 h-5 border-2 border-primary-600 rounded bg-primary-100 flex items-center justify-center">
                    <div className="w-2.5 h-0.5 bg-primary-600" />
                  </div>
                ) : (
                  <Square className="w-5 h-5 text-gray-400" />
                )}
                <span className="font-medium text-gray-700">
                  {isAllSelected ? "Deselect All" : "Select All"}
                </span>
              </button>

              <span className="text-sm text-gray-600">
                {selectedIds.size} appointment
                {selectedIds.size !== 1 ? "s" : ""} selected
              </span>
            </div>

            {/* Bulk Actions */}
            {selectedIds.size > 0 && (
              <div className="flex gap-2">
                {/* Cancel Selected - Only for upcoming/all tabs, not for completed/cancelled */}
                {canEdit &&
                  activeTab !== "completed" &&
                  activeTab !== "cancelled" && (
                    <button
                      onClick={handleBulkCancel}
                      className="flex items-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-medium"
                    >
                      <XCircle className="w-4 h-4" />
                      Cancel Selected
                    </button>
                  )}

                {/* Delete Selected */}
                {canEdit && (
                  <button
                    onClick={handleBulkDelete}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Selected
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Appointments List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading appointments...</span>
        </div>
      ) : filteredAppointments.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Calendar className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No appointments found
          </h3>
          <p className="text-gray-600">
            {searchQuery || statusFilter !== "all"
              ? "Try adjusting your search or filters"
              : `No ${activeTab} appointments at this time`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredAppointments.map((appointment) => (
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              onClick={() => handleAppointmentClick(appointment)}
              isSelectMode={isSelectMode}
              isSelected={selectedIds.has(appointment.id)}
              onToggleSelect={() => toggleSelection(appointment.id)}
            />
          ))}
        </div>
      )}

      {/* Side Panel */}
      <AppointmentSidePanel
        isOpen={showSidePanel}
        onClose={() => setShowSidePanel(false)}
        appointment={selectedAppointment}
        onCancel={canEdit ? handleCancelFromPanel : undefined}
        onMarkComplete={canEdit ? handleMarkComplete : undefined}
        onEdit={canEdit ? onEdit : undefined}
        onDelete={
          canEdit
            ? async (id) => {
                await onDeleteAppointment(id);
                setShowSidePanel(false);
              }
            : undefined
        }
        role={role}
        canEdit={canEdit}
      />

      {/* Cancel Confirmation Modal */}
      <CancelConfirmModal
        isOpen={showCancelModal}
        onClose={() => {
          setShowCancelModal(false);
          setCancellingAppointmentId(null);
        }}
        onCancel={handleCancel}
        onDelete={handleDelete}
        appointmentInfo={cancelModalInfo}
      />

      {/* Bulk Action Confirmation Modal */}
      <BulkActionConfirmModal
        isOpen={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        onConfirm={confirmBulkAction}
        count={selectedIds.size}
        action={bulkAction}
        isLoading={isBulkActionLoading}
      />

      {/* Add Appointment Modal */}
      <AddAppointmentModal
        isOpen={showAddAppointmentModal}
        onClose={() => setShowAddAppointmentModal(false)}
        onAppointmentCreated={() => {
          if (onRefreshAppointments) {
            onRefreshAppointments();
          }
        }}
      />
    </div>
  );
}
