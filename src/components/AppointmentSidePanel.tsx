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
  Edit2,
  Trash2,
  Save,
  Loader2,
  FileText,
} from "lucide-react";
import { createPortal } from "react-dom";
import StatusBadge from "./StatusBadge";
import { AppointmentCardData } from "./AppointmentCard";
import { updateAppointment } from "../hooks/useAdminData";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

interface AppointmentSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  appointment: AppointmentCardData | null;
  onCancel?: (appointmentId: string) => void;
  onMarkComplete?: (appointmentId: string) => void;
  onDelete?: (appointmentId: string) => void;
  onApprove?: (appointmentId: string) => void;
  onDecline?: (appointmentId: string) => void;
  onAppointmentUpdated?: (updatedAppointment: AppointmentCardData) => void;
  role: "admin" | "manager";
  canEdit?: boolean;
}

export default function AppointmentSidePanel({
  isOpen,
  onClose,
  appointment,
  onCancel, // eslint-disable-line @typescript-eslint/no-unused-vars
  onMarkComplete, // eslint-disable-line @typescript-eslint/no-unused-vars
  onDelete,
  onApprove,
  onDecline,
  onAppointmentUpdated,
  role,
  canEdit = true,
}: AppointmentSidePanelProps) {
  // Lock body scroll when panel is open
  useBodyScrollLock(isOpen);

  const [isActionLoading, setIsActionLoading] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedAppointment, setEditedAppointment] = useState({
    scheduled_date: "",
    scheduled_time: "",
    total_price: 0,
    special_requests: "",
    notes: "",
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Start animating when opened
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
    }
  }, [isOpen]);

  // Update edited appointment when appointment prop changes
  useEffect(() => {
    if (appointment) {
      setEditedAppointment({
        scheduled_date: appointment.scheduled_date || "",
        scheduled_time: appointment.scheduled_time?.slice(0, 5) || "", // Remove seconds if present
        total_price: appointment.total_price || 0,
        special_requests: appointment.special_requests || "",
        notes: appointment.notes || "",
      });
    }
  }, [appointment]);

  // Reset editing state when panel closes
  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
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

  const handleSave = async () => {
    if (!appointment) return;

    setIsSaving(true);
    const result = await updateAppointment(appointment.id, {
      scheduled_date: editedAppointment.scheduled_date,
      scheduled_time: editedAppointment.scheduled_time + ":00", // Add seconds back
      total_price: editedAppointment.total_price,
      special_requests: editedAppointment.special_requests || null,
      notes: editedAppointment.notes || null,
    });
    setIsSaving(false);

    if (result.success && result.data) {
      // Merge updated data with existing appointment data
      const updatedAppointment: AppointmentCardData = {
        ...appointment,
        scheduled_date: result.data.scheduled_date,
        scheduled_time: result.data.scheduled_time,
        total_price: result.data.total_price,
        special_requests: result.data.special_requests,
        notes: result.data.notes,
        status: result.data.status,
      };

      // Update local edited state immediately
      setEditedAppointment({
        scheduled_date: updatedAppointment.scheduled_date || "",
        scheduled_time: updatedAppointment.scheduled_time?.slice(0, 5) || "",
        total_price: updatedAppointment.total_price || 0,
        special_requests: updatedAppointment.special_requests || "",
        notes: updatedAppointment.notes || "",
      });

      setIsEditing(false);
      if (onAppointmentUpdated) {
        onAppointmentUpdated(updatedAppointment);
      }
    } else {
      alert("Failed to update appointment: " + result.error);
    }
  };

  const handleCancelEdit = () => {
    if (appointment) {
      setEditedAppointment({
        scheduled_date: appointment.scheduled_date || "",
        scheduled_time: appointment.scheduled_time?.slice(0, 5) || "",
        total_price: appointment.total_price || 0,
        special_requests: appointment.special_requests || "",
        notes: appointment.notes || "",
      });
    }
    setIsEditing(false);
  };

  const handleClose = () => {
    // Don't close if editing
    if (isEditing) return;

    setIsAnimating(false);
    setTimeout(() => {
      onClose();
    }, 300); // match duration-300
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Don't close if editing
    if (isEditing) return;

    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

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
        className={`h-screen w-full sm:w-[450px] lg:w-[600px] bg-white shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${
          isOpen && isAnimating ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex-shrink-0 bg-white border-b border-gray-200 p-4 sm:p-6">
          <div className="flex items-center justify-between">
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
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 pb-6">
          {/* Status with Edit and Delete actions */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-gray-500 mb-2">Status</p>
              <StatusBadge status={appointment.status} size="lg" />
            </div>
            {canEdit && !isEditing && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEditing(true)}
                  className="p-2 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Edit appointment"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                {onDelete && (
                  <button
                    onClick={() => onDelete(appointment.id)}
                    disabled={isActionLoading}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                    title="Delete appointment"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}
            {canEdit && isEditing && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium disabled:opacity-50"
                >
                  {isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save
                </button>
              </div>
            )}
          </div>

          {/* Date & Time */}
          <div className="space-y-4">
            <div className="flex items-start gap-2">
              <Calendar className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-gray-500">Date</p>
                {isEditing ? (
                  <input
                    type="date"
                    value={editedAppointment.scheduled_date}
                    onChange={(e) =>
                      setEditedAppointment({
                        ...editedAppointment,
                        scheduled_date: e.target.value,
                      })
                    }
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                ) : (
                  <p className="font-medium text-gray-900">{date}</p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Clock className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-gray-500">Time</p>
                {isEditing ? (
                  <input
                    type="time"
                    value={editedAppointment.scheduled_time}
                    onChange={(e) =>
                      setEditedAppointment({
                        ...editedAppointment,
                        scheduled_time: e.target.value,
                      })
                    }
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                ) : (
                  <p className="font-medium text-gray-900">{time}</p>
                )}
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
            <div className="flex-1">
              <p className="text-sm text-gray-500">Total Amount</p>
              {isEditing ? (
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                    $
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editedAppointment.total_price}
                    onChange={(e) =>
                      setEditedAppointment({
                        ...editedAppointment,
                        total_price: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  ${appointment.total_price.toFixed(2)}
                </p>
              )}
            </div>
          </div>

          {/* Special Requests */}
          {(isEditing || appointment.special_requests) && (
            <div className="flex items-start gap-2">
              <FileText className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-gray-500">Special Requests</p>
                {isEditing ? (
                  <textarea
                    value={editedAppointment.special_requests}
                    onChange={(e) =>
                      setEditedAppointment({
                        ...editedAppointment,
                        special_requests: e.target.value,
                      })
                    }
                    placeholder="Any special requests..."
                    rows={3}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                  />
                ) : (
                  <p className="font-medium text-gray-900 mt-1">
                    {appointment.special_requests || "—"}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {(isEditing || appointment.notes) && (
            <div className="flex items-start gap-2">
              <FileText className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-gray-500">Notes</p>
                {isEditing ? (
                  <textarea
                    value={editedAppointment.notes}
                    onChange={(e) =>
                      setEditedAppointment({
                        ...editedAppointment,
                        notes: e.target.value,
                      })
                    }
                    placeholder="Internal notes..."
                    rows={3}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                  />
                ) : (
                  <p className="font-medium text-gray-900 mt-1">
                    {appointment.notes || "—"}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Approve/Decline buttons for pending appointments (admin only) */}
          {role === "admin" && appointment.status === "pending" && (onApprove || onDecline) && !isEditing && (
            <div className="flex items-center gap-2 pt-4 border-t border-gray-200 mt-4">
              {onApprove && (
                <button
                  onClick={async () => {
                    setIsActionLoading(true);
                    try {
                      await onApprove(appointment.id);
                      handleClose();
                    } finally {
                      setIsActionLoading(false);
                    }
                  }}
                  disabled={isActionLoading}
                  className="flex-1 px-4 py-2 text-sm font-medium bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors disabled:opacity-50"
                >
                  Approve
                </button>
              )}
              {onDecline && (
                <button
                  onClick={async () => {
                    setIsActionLoading(true);
                    try {
                      await onDecline(appointment.id);
                      handleClose();
                    } finally {
                      setIsActionLoading(false);
                    }
                  }}
                  disabled={isActionLoading}
                  className="flex-1 px-4 py-2 text-sm font-medium bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors disabled:opacity-50"
                >
                  Decline
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
