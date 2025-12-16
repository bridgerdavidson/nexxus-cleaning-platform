"use client";

import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Search,
  Calendar,
  Plus,
  Clock,
  User,
  MapPin,
  Briefcase,
  DollarSign,
} from "lucide-react";
import { format } from "date-fns";
import { AppointmentCardData } from "./AppointmentCard";
import StatusBadge from "./StatusBadge";

interface DayDetailSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: Date | null;
  appointments: AppointmentCardData[];
  onAppointmentClick: (appointment: AppointmentCardData) => void;
  onAddAppointment: () => void;
  canEdit?: boolean;
}

export default function DayDetailSidebar({
  isOpen,
  onClose,
  selectedDate,
  appointments,
  onAppointmentClick,
  onAddAppointment,
  canEdit = true,
}: DayDetailSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAnimating, setIsAnimating] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Start animating when opened
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
      setSearchQuery(""); // Reset search on open
    }
  }, [isOpen]);

  // Filter appointments by search query
  const filteredAppointments = useMemo(() => {
    if (!searchQuery.trim()) return appointments;

    const query = searchQuery.toLowerCase();
    return appointments.filter((apt) => {
      const homeownerName = apt.homeowner
        ? `${apt.homeowner.first_name} ${apt.homeowner.last_name}`.toLowerCase()
        : "";
      const cleanerName = apt.cleaner_profile?.user_profile
        ? `${apt.cleaner_profile.user_profile.first_name} ${apt.cleaner_profile.user_profile.last_name}`.toLowerCase()
        : "";
      const propertyAddress = apt.property
        ? `${apt.property.address} ${apt.property.city} ${apt.property.state}`.toLowerCase()
        : "";
      const serviceName = apt.service_type?.name.toLowerCase() || "";
      const status = apt.status.toLowerCase();

      return (
        homeownerName.includes(query) ||
        cleanerName.includes(query) ||
        propertyAddress.includes(query) ||
        serviceName.includes(query) ||
        status.includes(query)
      );
    });
  }, [appointments, searchQuery]);

  // Sort appointments by time
  const sortedAppointments = useMemo(() => {
    return [...filteredAppointments].sort((a, b) => {
      return a.scheduled_time.localeCompare(b.scheduled_time);
    });
  }, [filteredAppointments]);

  // Group appointments by status
  const appointmentsByStatus = useMemo(() => {
    const pending = sortedAppointments.filter((a) => a.status === "pending");
    const confirmed = sortedAppointments.filter((a) => a.status === "confirmed");
    const inProgress = sortedAppointments.filter(
      (a) => a.status === "in_progress"
    );
    const completed = sortedAppointments.filter((a) => a.status === "completed");
    const cancelled = sortedAppointments.filter((a) => a.status === "cancelled");

    return { pending, confirmed, inProgress, completed, cancelled };
  }, [sortedAppointments]);

  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(() => {
      onClose();
    }, 300);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  // Format time for display
  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  if (!mounted || (!isOpen && !isAnimating) || !selectedDate) return null;

  const formattedDate = format(selectedDate, "EEEE, MMMM d, yyyy");
  const isToday =
    format(selectedDate, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  const panel = (
    <div
      className={`fixed inset-0 z-[200] flex justify-end transition-colors duration-300 ${
        isOpen && isAnimating ? "bg-black/50" : "bg-transparent"
      }`}
      onClick={handleBackdropClick}
    >
      {/* Side Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`h-screen w-full sm:w-[450px] lg:w-[500px] bg-white shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${
          isOpen && isAnimating ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <Calendar className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {formattedDate}
                </h2>
                {isToday && (
                  <span className="text-xs font-medium text-primary-600">
                    Today
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search appointments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white text-sm"
            />
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          {sortedAppointments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <Calendar className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-1">
                {searchQuery ? "No matching appointments" : "No appointments"}
              </h3>
              <p className="text-sm text-gray-500 text-center mb-6">
                {searchQuery
                  ? "Try adjusting your search"
                  : "No appointments scheduled for this day"}
              </p>
              {canEdit && !searchQuery && (
                <button
                  onClick={onAddAppointment}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Appointment
                </button>
              )}
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {/* Summary Stats */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-yellow-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-yellow-700">
                    {appointmentsByStatus.pending.length}
                  </p>
                  <p className="text-xs text-yellow-600">Pending</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-green-700">
                    {appointmentsByStatus.confirmed.length}
                  </p>
                  <p className="text-xs text-green-600">Confirmed</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-gray-700">
                    {appointmentsByStatus.completed.length}
                  </p>
                  <p className="text-xs text-gray-600">Completed</p>
                </div>
              </div>

              {/* Results count */}
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-gray-500">
                  {filteredAppointments.length} appointment
                  {filteredAppointments.length !== 1 ? "s" : ""}
                  {searchQuery && " found"}
                </p>
              </div>

              {/* Appointment Cards */}
              {sortedAppointments.map((appointment) => (
                <AppointmentMiniCard
                  key={appointment.id}
                  appointment={appointment}
                  onClick={() => onAppointmentClick(appointment)}
                  formatTime={formatTime}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer - Add Appointment Button */}
        {canEdit && sortedAppointments.length > 0 && (
          <div className="flex-shrink-0 bg-white border-t border-gray-200 p-4">
            <button
              onClick={onAddAppointment}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Add Appointment
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

// Mini appointment card for sidebar
interface AppointmentMiniCardProps {
  appointment: AppointmentCardData;
  onClick: () => void;
  formatTime: (time: string) => string;
}

function AppointmentMiniCard({
  appointment,
  onClick,
  formatTime,
}: AppointmentMiniCardProps) {
  const homeownerName = appointment.homeowner
    ? `${appointment.homeowner.first_name} ${appointment.homeowner.last_name}`
    : "Unknown";

  const cleanerName = appointment.cleaner_profile?.user_profile
    ? `${appointment.cleaner_profile.user_profile.first_name} ${appointment.cleaner_profile.user_profile.last_name}`
    : "Unassigned";

  const propertyAddress = appointment.property
    ? `${appointment.property.address}, ${appointment.property.city}`
    : "No address";

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white border border-gray-200 rounded-lg p-4 hover:border-primary-300 hover:shadow-md transition-all group"
    >
      {/* Header - Time and Status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary-600" />
          <span className="font-semibold text-gray-900">
            {formatTime(appointment.scheduled_time)}
          </span>
        </div>
        <StatusBadge status={appointment.status} size="sm" />
      </div>

      {/* Service Type */}
      {appointment.service_type && (
        <div className="flex items-center gap-2 mb-2">
          <Briefcase className="w-4 h-4 text-gray-400" />
          <span className="font-medium text-gray-900">
            {appointment.service_type.name}
          </span>
        </div>
      )}

      {/* Homeowner */}
      <div className="flex items-center gap-2 mb-2">
        <User className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-600">{homeownerName}</span>
      </div>

      {/* Property */}
      <div className="flex items-center gap-2 mb-2">
        <MapPin className="w-4 h-4 text-gray-400" />
        <span className="text-sm text-gray-600 truncate">{propertyAddress}</span>
      </div>

      {/* Cleaner and Price */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100 mt-2">
        <span
          className={`text-sm ${
            cleanerName === "Unassigned"
              ? "text-gray-400 italic"
              : "text-gray-600"
          }`}
        >
          {cleanerName}
        </span>
        <div className="flex items-center gap-1">
          <DollarSign className="w-4 h-4 text-green-600" />
          <span className="font-bold text-gray-900">
            {appointment.total_price.toFixed(0)}
          </span>
        </div>
      </div>
    </button>
  );
}
