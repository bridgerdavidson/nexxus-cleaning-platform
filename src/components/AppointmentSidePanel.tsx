"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Calendar,
  MapPin,
  User,
  Briefcase,
  DollarSign,
  Clock,
  Mail,
  CheckCircle,
  XCircle,
  Edit,
  Trash2,
} from "lucide-react";
import { createPortal } from "react-dom";
import StatusBadge from "./StatusBadge";
import { AppointmentCardData } from "./AppointmentCard";

interface AppointmentSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  appointment: AppointmentCardData | null;
  onCancel?: (appointmentId: string) => void;
  onMarkComplete?: (appointmentId: string) => void;
  onEdit?: (appointmentId: string) => void;
  onDelete?: (appointmentId: string) => void;
  role: "admin" | "manager";
  canEdit?: boolean;
}

export default function AppointmentSidePanel({
  isOpen,
  onClose,
  appointment,
  onCancel,
  onMarkComplete,
  onEdit,
  onDelete,
  role, // eslint-disable-line @typescript-eslint/no-unused-vars
  canEdit = true,
}: AppointmentSidePanelProps) {
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Start animating when opened
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
    }
  }, [isOpen]);

  if (!mounted || (!isOpen && !isAnimating) || !appointment) return null;

  const formatDateTime = (date: string, time: string) => {
    // Parse date string (YYYY-MM-DD) as local date to avoid timezone issues
    const [year, month, day] = date.split("-").map(Number);
    const localDate = new Date(year, month - 1, day); // month is 0-indexed
    const formattedDate = localDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    // Convert military time (HH:MM:SS) to 12-hour format with AM/PM
    const [hours, minutes] = time.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12; // Convert 0 to 12 for midnight
    const formattedTime = `${displayHour}:${minutes} ${ampm}`;

    return { date: formattedDate, time: formattedTime };
  };

  const getHomeownerName = () => {
    if (appointment.homeowner) {
      const { first_name, last_name } = appointment.homeowner;
      return `${first_name} ${last_name}`;
    }
    return "Unknown";
  };

  const getCleanerName = () => {
    if (appointment.cleaner_profile?.user_profile) {
      const { first_name, last_name } =
        appointment.cleaner_profile.user_profile;
      return `${first_name} ${last_name}`;
    }
    return "Unassigned";
  };

  const getPropertyAddress = () => {
    if (appointment.property) {
      const { name, address, city, state } = appointment.property;
      return {
        name: name || "Property",
        fullAddress:
          address && city && state
            ? `${address}, ${city}, ${state}`
            : "Address not available",
      };
    }
    return { name: "Property", fullAddress: "Address not available" };
  };

  const { date, time } = formatDateTime(
    appointment.scheduled_date,
    appointment.scheduled_time
  );
  const property = getPropertyAddress();

  const handleCancel = async () => {
    if (!onCancel) return;
    setIsActionLoading(true);
    await onCancel(appointment.id);
    setIsActionLoading(false);
  };

  const handleMarkComplete = async () => {
    if (!onMarkComplete) return;
    setIsActionLoading(true);
    await onMarkComplete(appointment.id);
    setIsActionLoading(false);
  };

  const handleEdit = () => {
    if (onEdit) {
      onEdit(appointment.id);
    }
  };

  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(() => {
      onClose();
    }, 300); // match duration-300
  };

  const canMarkComplete =
    appointment.status !== "completed" && appointment.status !== "cancelled";
  const canCancel = appointment.status !== "cancelled";
  const isCancelled = appointment.status === "cancelled";

  const panel = (
    <div
      className={`fixed inset-0 z-[200] flex justify-end transition-colors duration-300 ${
        isOpen && isAnimating ? "bg-black/50" : "bg-transparent"
      }`}
      onClick={handleClose}
    >
      {/* Side Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`h-screen w-full sm:w-[450px] lg:w-[600px] bg-white shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${
          isOpen && isAnimating ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 p-4 sm:p-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            Appointment Details
          </h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 pb-6">
          {/* Status */}
          <div>
            <p className="text-sm text-gray-500 mb-2">Status</p>
            <StatusBadge status={appointment.status} size="lg" />
          </div>

          {/* Date & Time */}
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <Calendar className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-500">Date</p>
                <p className="font-medium text-gray-900">{date}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-500">Time</p>
                <p className="font-medium text-gray-900">{time}</p>
              </div>
            </div>
          </div>

          {/* Property */}
          <div className="flex items-start gap-2">
            <MapPin className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-gray-500">Property</p>
              <p className="font-medium text-gray-900">{property.name}</p>
              <p className="text-sm text-gray-600">{property.fullAddress}</p>
            </div>
          </div>

          {/* Service Type */}
          {appointment.service_type && (
            <div className="flex items-start gap-2">
              <Briefcase className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm text-gray-500">Service</p>
                <p className="font-medium text-gray-900">
                  {appointment.service_type.name}
                </p>
                {appointment.service_type.description && (
                  <p className="text-sm text-gray-600 mt-1">
                    {appointment.service_type.description}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Homeowner */}
          <div className="flex items-start gap-2">
            <User className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-gray-500">Homeowner</p>
              <p className="font-medium text-gray-900">{getHomeownerName()}</p>
              {appointment.homeowner?.email && (
                <div className="flex items-center gap-1 mt-1">
                  <Mail className="w-4 h-4 text-gray-400" />
                  <p className="text-sm text-gray-600">
                    {appointment.homeowner.email}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Cleaner */}
          <div className="flex items-start gap-2">
            <User className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-gray-500">Cleaner</p>
              <p
                className={`font-medium ${
                  getCleanerName() === "Unassigned"
                    ? "text-gray-400 italic"
                    : "text-gray-900"
                }`}
              >
                {getCleanerName()}
              </p>
            </div>
          </div>

          {/* Price */}
          <div className="flex items-start gap-2">
            <DollarSign className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-gray-500">Total Amount</p>
              <p className="text-2xl font-bold text-gray-900">
                ${appointment.total_price.toFixed(2)}
              </p>
            </div>
          </div>
        </div>

        {/* Floating Action Footer */}
        <div className="flex-shrink-0 bg-white border-t border-gray-200 p-4 sm:p-6 shadow-lg">
          {onEdit && (
            <button
              onClick={handleEdit}
              disabled={isActionLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-primary-500 text-primary-700 bg-transparent rounded-lg hover:bg-primary-50 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed mb-2"
            >
              <Edit className="w-4 h-4" />
              Edit Appointment
            </button>
          )}

          <div className="flex flex-col lg:flex-row gap-2">
            {/* For Cancelled Appointments - Show Delete Only */}
            {isCancelled && canEdit && onDelete ? (
              <button
                onClick={() => onDelete(appointment.id)}
                disabled={isActionLoading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-red-600 text-red-700 bg-transparent rounded-lg hover:bg-red-50 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
                Delete Permanently
              </button>
            ) : (
              <>
                {canMarkComplete && canEdit && onMarkComplete && (
                  <button
                    onClick={handleMarkComplete}
                    disabled={isActionLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-green-500 text-green-700 bg-transparent rounded-lg hover:bg-green-50 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Mark as Complete
                  </button>
                )}

                {canCancel && canEdit && onCancel && (
                  <button
                    onClick={handleCancel}
                    disabled={isActionLoading}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-red-500 text-red-700 bg-transparent rounded-lg hover:bg-red-50 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <XCircle className="w-4 h-4" />
                    Cancel Appointment
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
