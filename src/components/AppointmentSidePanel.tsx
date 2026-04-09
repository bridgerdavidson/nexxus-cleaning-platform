"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
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
  CreditCard,
  AlertCircle,
  Camera,
  Play,
} from "lucide-react";
import { createPortal } from "react-dom";
import StatusBadge from "./StatusBadge";
import { AppointmentCardData } from "./AppointmentCard";
import { updateAppointment } from "../hooks/useAdminData";
import { supabase } from "../lib/supabase";
import { useJobPhotosForAppointment } from "../hooks/useCleanerData";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { formatTimeTo12h } from "../lib/formatTime";
import PaymentMethodForm from "./PaymentMethodForm";

interface CleanerFeedback {
  id: string;
  reason: string | null;
  created_at: string;
  cleaner_suggested_times: {
    id: string;
    suggested_date: string;
    suggested_time: string;
  }[];
}

interface ServiceTypeOption {
  id: string;
  name: string;
  base_price: number;
}

interface ChecklistOption {
  id: string;
  name: string;
  service_type_id: string;
  price_adder: number;
}

interface AppointmentSidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  appointment: AppointmentCardData | null;
  onCancel?: (appointmentId: string) => void;
  onMarkComplete?: (appointmentId: string) => void;
  onDelete?: (appointmentId: string) => void;
  onApprove?: (appointmentId: string) => void;
  onDecline?: (appointmentId: string) => void;
  onStartJob?: (appointmentId: string) => void;
  onCompleteJob?: (appointmentId: string) => void;
  onAppointmentUpdated?: (updatedAppointment: AppointmentCardData) => void;
  onReschedule?: (appointment: AppointmentCardData) => void;
  role: "admin" | "manager" | "cleaner" | "homeowner";
  canEdit?: boolean;
  canApproveDecline?: boolean;
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
  onStartJob,
  onCompleteJob,
  onAppointmentUpdated,
  onReschedule,
  role,
  canEdit = true,
  canApproveDecline = false,
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
    service_type_id: "",
    checklist_id: "",
    total_price: 0,
    price_override_enabled: false,
    price_override_total: "",
    special_requests: "",
    notes: "",
  });
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([]);
  const [serviceTypesLoading, setServiceTypesLoading] = useState(false);
  const [checklists, setChecklists] = useState<ChecklistOption[]>([]);
  const [checklistsLoading, setChecklistsLoading] = useState(false);

  // Cleaner feedback state
  const [cleanerFeedback, setCleanerFeedback] = useState<CleanerFeedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  // Payment method state
  const [paymentMethodInfo, setPaymentMethodInfo] = useState<{
    last4: string;
    brand: string;
  } | null>(null);
  const [paymentMethodLoading, setPaymentMethodLoading] = useState(false);
  const [paymentMethodError, setPaymentMethodError] = useState<string | null>(null);
  const [showPaymentForm, setShowPaymentForm] = useState(false);

  // Job photos (admin, manager, cleaner can view via RLS)
  const {
    beforePhotos,
    afterPhotos,
    allPhotos,
    loading: photosLoading,
    error: photosError,
    refetch: refetchPhotos,
  } = useJobPhotosForAppointment(appointment?.id ?? null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch payment method info when appointment changes
  const fetchPaymentMethod = useCallback(async (homeownerId: string) => {
    setPaymentMethodLoading(true);
    setPaymentMethodError(null);
    try {
      const response = await fetch("/api/stripe/get-payment-method", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ homeowner_id: homeownerId }),
      });

      let data;
      try {
        data = await response.json();
      } catch {
        throw new Error("Failed to parse response from server");
      }

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to fetch payment method");
      }

      if (data.has_card && data.payment_method) {
        setPaymentMethodInfo({
          last4: data.payment_method.last4,
          brand: data.payment_method.brand,
        });
      } else {
        setPaymentMethodInfo(null);
      }
    } catch (err) {
      console.error("Error fetching payment method:", err);
      setPaymentMethodError(err instanceof Error ? err.message : "Failed to fetch payment method");
      setPaymentMethodInfo(null);
    } finally {
      setPaymentMethodLoading(false);
    }
  }, []);

  const getSystemCalculatedTotal = useCallback(
    (serviceTypeId: string, checklistId: string) => {
      const serviceType = serviceTypes.find((s) => s.id === serviceTypeId);
      const checklist = checklists.find((c) => c.id === checklistId);
      if (!serviceType || !checklist) return 0;
      return serviceType.base_price + (checklist.price_adder || 0);
    },
    [checklists, serviceTypes]
  );

  const editPricingPreview = useMemo(() => {
    const serviceType = serviceTypes.find(
      (s) => s.id === editedAppointment.service_type_id
    );
    const checklist = checklists.find(
      (c) => c.id === editedAppointment.checklist_id
    );
    if (!serviceType || !checklist) return null;
    const adder = checklist.price_adder ?? 0;
    return {
      base: serviceType.base_price,
      adder,
      total: serviceType.base_price + adder,
    };
  }, [
    editedAppointment.service_type_id,
    editedAppointment.checklist_id,
    serviceTypes,
    checklists,
  ]);

  const fetchServiceTypes = useCallback(async () => {
    try {
      setServiceTypesLoading(true);
      const { data, error } = await supabase
        .from("service_types")
        .select("id, name, base_price")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (error) throw error;
      setServiceTypes((data || []) as ServiceTypeOption[]);
    } catch (err) {
      console.error("Error fetching service types:", err);
      setServiceTypes([]);
    } finally {
      setServiceTypesLoading(false);
    }
  }, []);

  const fetchChecklists = useCallback(async (serviceTypeId: string) => {
    if (!serviceTypeId) {
      setChecklists([]);
      return;
    }
    try {
      setChecklistsLoading(true);
      const { data, error } = await supabase
        .from("checklists")
        .select("id, name, service_type_id, price_adder")
        .eq("service_type_id", serviceTypeId)
        .order("name", { ascending: true });

      if (error) throw error;
      setChecklists((data || []) as ChecklistOption[]);
    } catch (err) {
      console.error("Error fetching checklists:", err);
      setChecklists([]);
    } finally {
      setChecklistsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (appointment?.homeowner_id && isOpen) {
      fetchPaymentMethod(appointment.homeowner_id);
    }
    // Reset payment form state when appointment changes
    setShowPaymentForm(false);
  }, [appointment?.homeowner_id, isOpen, fetchPaymentMethod]);

  // Fetch cleaner feedback when appointment is rejected
  useEffect(() => {
    if (appointment?.cleaner_confirmation_status === 'rejected' && isOpen && (role === "admin" || role === "manager")) {
      const fetchFeedback = async () => {
        setFeedbackLoading(true);
        try {
          const response = await fetch(`/api/appointments/confirm?appointmentId=${appointment.id}`);
          const result = await response.json();
          if (result.success) {
            setCleanerFeedback(result.data || []);
          }
        } catch (err) {
          console.error("Error fetching cleaner feedback:", err);
        } finally {
          setFeedbackLoading(false);
        }
      };
      fetchFeedback();
    } else {
      setCleanerFeedback([]);
    }
  }, [appointment?.id, appointment?.cleaner_confirmation_status, isOpen, role]);

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
        service_type_id: appointment.service_type_id || "",
        checklist_id: appointment.checklist_id || "",
        total_price: appointment.total_price || 0,
        price_override_enabled: appointment.price_override_enabled || false,
        price_override_total:
          appointment.price_override_total != null
            ? appointment.price_override_total.toString()
            : "",
        special_requests: appointment.special_requests || "",
        notes: appointment.notes || "",
      });
    }
  }, [appointment]);

  useEffect(() => {
    if (isOpen && isEditing) {
      fetchServiceTypes();
    }
  }, [fetchServiceTypes, isEditing, isOpen]);

  useEffect(() => {
    if (isEditing && editedAppointment.service_type_id) {
      fetchChecklists(editedAppointment.service_type_id);
    } else {
      setChecklists([]);
    }
  }, [editedAppointment.service_type_id, fetchChecklists, isEditing]);

  useEffect(() => {
    if (!isEditing || checklists.length === 0) return;
    if (editedAppointment.checklist_id) return;

    const firstChecklist = checklists[0];
    setEditedAppointment((prev) => ({
      ...prev,
      checklist_id: firstChecklist.id,
      total_price: prev.price_override_enabled
        ? prev.total_price
        : getSystemCalculatedTotal(prev.service_type_id, firstChecklist.id),
    }));
  }, [
    checklists,
    editedAppointment.checklist_id,
    getSystemCalculatedTotal,
    isEditing,
  ]);

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

    const formattedTime = formatTimeTo12h(time);
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

    const priceOverrideEnabled = editedAppointment.price_override_enabled;
    const systemTotal = getSystemCalculatedTotal(
      editedAppointment.service_type_id,
      editedAppointment.checklist_id
    );
    const overrideTotal = parseFloat(editedAppointment.price_override_total);
    const finalTotal = priceOverrideEnabled
      ? Number.isFinite(overrideTotal)
        ? overrideTotal
        : editedAppointment.total_price
      : systemTotal || editedAppointment.total_price;

    setIsSaving(true);
    const result = await updateAppointment(appointment.id, {
      scheduled_date: editedAppointment.scheduled_date,
      scheduled_time: editedAppointment.scheduled_time + ":00", // Add seconds back
      service_type_id: editedAppointment.service_type_id || undefined,
      checklist_id: editedAppointment.checklist_id || null,
      total_price: finalTotal,
      price_override_enabled: priceOverrideEnabled,
      price_override_total: priceOverrideEnabled ? finalTotal : null,
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
        service_type_id: result.data.service_type_id,
        checklist_id: result.data.checklist_id,
        price_override_enabled: result.data.price_override_enabled,
        price_override_total: result.data.price_override_total,
        special_requests: result.data.special_requests,
        notes: result.data.notes,
        status: result.data.status,
        service_type: result.data.service_type,
        checklist: result.data.checklist,
      };

      // Update local edited state immediately
      setEditedAppointment({
        scheduled_date: updatedAppointment.scheduled_date || "",
        scheduled_time: updatedAppointment.scheduled_time?.slice(0, 5) || "",
        service_type_id: updatedAppointment.service_type_id || "",
        checklist_id: updatedAppointment.checklist_id || "",
        total_price: updatedAppointment.total_price || 0,
        price_override_enabled: updatedAppointment.price_override_enabled || false,
        price_override_total:
          updatedAppointment.price_override_total != null
            ? updatedAppointment.price_override_total.toString()
            : "",
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
        service_type_id: appointment.service_type_id || "",
        checklist_id: appointment.checklist_id || "",
        total_price: appointment.total_price || 0,
        price_override_enabled: appointment.price_override_enabled || false,
        price_override_total:
          appointment.price_override_total != null
            ? appointment.price_override_total.toString()
            : "",
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
              <div className="flex-1">
                <p className="text-sm text-gray-500">Service</p>
                {isEditing ? (
                  <div className="space-y-2 mt-1">
                    <select
                      value={editedAppointment.service_type_id}
                      onChange={(e) => {
                        const nextServiceTypeId = e.target.value;
                        setEditedAppointment((prev) => ({
                          ...prev,
                          service_type_id: nextServiceTypeId,
                          checklist_id: "",
                        }));
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      disabled={serviceTypesLoading}
                    >
                      <option value="">{serviceTypesLoading ? "Loading services..." : "Select service type"}</option>
                      {serviceTypes.map((serviceType) => (
                        <option key={serviceType.id} value={serviceType.id}>
                          {serviceType.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={editedAppointment.checklist_id}
                      onChange={(e) => {
                        const nextChecklistId = e.target.value;
                        setEditedAppointment((prev) => ({
                          ...prev,
                          checklist_id: nextChecklistId,
                          total_price: prev.price_override_enabled
                            ? prev.total_price
                            : getSystemCalculatedTotal(prev.service_type_id, nextChecklistId),
                        }));
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      disabled={!editedAppointment.service_type_id || checklistsLoading}
                    >
                      <option value="">
                        {checklistsLoading ? "Loading checklists..." : "Select checklist"}
                      </option>
                      {checklists.map((checklist) => (
                        <option key={checklist.id} value={checklist.id}>
                          {checklist.name} (+${checklist.price_adder.toFixed(2)})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <p className="font-medium text-gray-900">
                      {appointment.service_type.name}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                      {appointment.checklist?.name || "No checklist"}
                    </p>
                  </>
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

          {/* Price - Hide for cleaner role */}
          {role !== "cleaner" && (
            <div className="flex items-start gap-2">
              <DollarSign className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0 self-start">
                <p className="text-sm text-gray-500">Total Amount</p>
                {isEditing ? (
                  <div className="mt-1 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        {editedAppointment.price_override_enabled ? (
                          <div className="relative w-full max-w-full">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                              $
                            </span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={editedAppointment.price_override_total}
                              onChange={(e) =>
                                setEditedAppointment({
                                  ...editedAppointment,
                                  price_override_total: e.target.value,
                                  total_price: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
                            />
                          </div>
                        ) : !editedAppointment.service_type_id ? (
                          <p className="text-sm text-gray-500">
                            Select a service type to preview price.
                          </p>
                        ) : checklistsLoading ? (
                          <p className="text-sm text-gray-500">
                            Loading checklists…
                          </p>
                        ) : !editedAppointment.checklist_id ? (
                          <p className="text-sm text-gray-500">
                            Select a checklist to preview price.
                          </p>
                        ) : editPricingPreview ? (
                          <div className="space-y-1">
                            <p className="text-sm text-gray-600">
                              Base: ${editPricingPreview.base.toFixed(2)}
                            </p>
                            <p className="text-sm text-gray-600">
                              Checklist adder: +$
                              {editPricingPreview.adder.toFixed(2)}
                            </p>
                            <div className="text-2xl font-bold text-gray-900 pt-1">
                              ${editPricingPreview.total.toFixed(2)}
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500">
                            Unable to preview price for this selection.
                          </p>
                        )}
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer shrink-0 leading-snug">
                        <input
                          type="checkbox"
                          checked={editedAppointment.price_override_enabled}
                          onChange={(e) => {
                            const enabled = e.target.checked;
                            const calculatedTotal = getSystemCalculatedTotal(
                              editedAppointment.service_type_id,
                              editedAppointment.checklist_id
                            );
                            setEditedAppointment((prev) => ({
                              ...prev,
                              price_override_enabled: enabled,
                              price_override_total: enabled
                                ? (prev.total_price || calculatedTotal).toString()
                                : "",
                              total_price: enabled
                                ? prev.total_price
                                : calculatedTotal || prev.total_price,
                            }));
                          }}
                          className="w-4 h-4 mt-0.5 text-primary-600 border-gray-300 rounded focus:ring-primary-500 shrink-0"
                        />
                        Override total price
                      </label>
                    </div>

                    {editedAppointment.price_override_enabled &&
                      editPricingPreview && (
                        <div className="mt-3 pt-3 border-t border-gray-200 space-y-1">
                          <p className="text-xs text-gray-500">
                            Calculated from current service & checklist
                          </p>
                          <p className="text-sm text-gray-600">
                            Base: ${editPricingPreview.base.toFixed(2)}
                          </p>
                          <p className="text-sm text-gray-600">
                            Checklist adder: +$
                            {editPricingPreview.adder.toFixed(2)}
                          </p>
                          <p className="text-sm font-semibold text-gray-900">
                            ${editPricingPreview.total.toFixed(2)}
                          </p>
                        </div>
                      )}
                  </div>
                ) : (
                  <p className="text-2xl font-bold text-gray-900">
                    ${appointment.total_price.toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Payment Method */}
          {!isEditing && (
            <div className="flex items-start gap-2">
              <CreditCard className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-gray-500 mb-2">Payment Method</p>
                
                {showPaymentForm && appointment.homeowner_id ? (
                  <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                    <PaymentMethodForm
                      homeownerId={appointment.homeowner_id}
                      onSuccess={() => {
                        setShowPaymentForm(false);
                        if (appointment.homeowner_id) {
                          fetchPaymentMethod(appointment.homeowner_id);
                        }
                      }}
                      onError={(errorMsg) => {
                        setPaymentMethodError(errorMsg);
                      }}
                      onCancel={() => setShowPaymentForm(false)}
                    />
                  </div>
                ) : paymentMethodLoading ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading payment info...</span>
                  </div>
                ) : paymentMethodError ? (
                  <div className="flex items-start gap-2 text-amber-600">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm">Could not load payment info</p>
                      <button
                        onClick={() => setShowPaymentForm(true)}
                        className="text-sm text-primary-600 hover:text-primary-700 font-medium mt-1"
                      >
                        Add Card
                      </button>
                    </div>
                  </div>
                ) : paymentMethodInfo ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-gray-100 rounded-lg">
                        <CreditCard className="w-5 h-5 text-gray-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 capitalize">
                          {paymentMethodInfo.brand}
                        </p>
                        <p className="text-sm text-gray-600">
                          •••• {paymentMethodInfo.last4}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowPaymentForm(true)}
                      className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                    >
                      Change Card
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <p className="text-gray-500 italic">No card on file</p>
                    <button
                      onClick={() => setShowPaymentForm(true)}
                      className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                    >
                      Add Card
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

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

          {/* Job Photos - before/after evidence; when job is in progress or completed */}
          {!isEditing &&
            (appointment.status === "in_progress" || appointment.status === "completed") &&
            (role === "admin" || role === "manager" || role === "cleaner" || role === "homeowner") && (
            <div className="space-y-3 pt-2 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-gray-500 flex-shrink-0" />
                <p className="text-sm font-medium text-gray-700">Job Photos</p>
              </div>
              {photosLoading ? (
                <div className="flex items-center gap-2 text-gray-500 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading photos...</span>
                </div>
              ) : photosError ? (
                <p className="text-sm text-amber-600 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {photosError}
                </p>
              ) : allPhotos.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No photos uploaded for this job yet.</p>
              ) : (
                <div className="space-y-4">
                  {beforePhotos.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Before</p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {beforePhotos.map((photo) => (
                          <a
                            key={photo.id}
                            href={photo.photo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block aspect-square rounded-lg overflow-hidden bg-gray-100 ring-1 ring-gray-200 hover:ring-2 hover:ring-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          >
                            <img
                              src={photo.photo_url}
                              alt="Before"
                              className="w-full h-full object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {afterPhotos.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">After</p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {afterPhotos.map((photo) => (
                          <a
                            key={photo.id}
                            href={photo.photo_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block aspect-square rounded-lg overflow-hidden bg-gray-100 ring-1 ring-gray-200 hover:ring-2 hover:ring-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                          >
                            <img
                              src={photo.photo_url}
                              alt="After"
                              className="w-full h-full object-cover"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {allPhotos.some((p) => p.photo_type === "during") && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">During</p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {allPhotos
                          .filter((p) => p.photo_type === "during")
                          .map((photo) => (
                            <a
                              key={photo.id}
                              href={photo.photo_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block aspect-square rounded-lg overflow-hidden bg-gray-100 ring-1 ring-gray-200 hover:ring-2 hover:ring-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                            >
                              <img
                                src={photo.photo_url}
                                alt="During"
                                className="w-full h-full object-cover"
                              />
                            </a>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Cleaner Confirmation Status - Awaiting */}
          {appointment.cleaner_confirmation_status === 'awaiting' && !isEditing && (role === "admin" || role === "manager") && (
            <div className="border-l-4 border-amber-400 bg-amber-50 rounded-r-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <h4 className="font-semibold text-amber-800">Awaiting Cleaner Confirmation</h4>
              </div>
              <p className="text-sm text-amber-700">
                Waiting for the cleaner to confirm their availability for this appointment.
              </p>
            </div>
          )}

          {/* Cleaner Confirmation Status - Rejected */}
          {appointment.cleaner_confirmation_status === 'rejected' && !isEditing && (role === "admin" || role === "manager") && (
            <div className="border-l-4 border-red-500 bg-red-50 rounded-r-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                <h4 className="font-semibold text-red-800">Cleaner Declined This Time</h4>
              </div>

              {feedbackLoading ? (
                <div className="flex items-center gap-2 text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading feedback...</span>
                </div>
              ) : cleanerFeedback.length > 0 ? (
                <div className="space-y-3">
                  {cleanerFeedback.map((fb) => (
                    <div key={fb.id} className="bg-white rounded-lg p-3 border border-red-200">
                      {fb.reason && (
                        <div className="mb-2">
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Reason</p>
                          <p className="text-sm text-gray-800">{fb.reason}</p>
                        </div>
                      )}
                      {fb.cleaner_suggested_times && fb.cleaner_suggested_times.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Suggested Times</p>
                          <div className="space-y-1">
                            {fb.cleaner_suggested_times.map((st) => {
                              const [y, m, d] = st.suggested_date.split("-").map(Number);
                              const sugDate = new Date(y, m - 1, d);
                              const dateStr = sugDate.toLocaleDateString("en-US", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              });
                              const [hours, minutes] = st.suggested_time.split(":");
                              const hour = parseInt(hours);
                              const ampm = hour >= 12 ? "PM" : "AM";
                              const displayHour = hour % 12 || 12;
                              const timeStr = `${displayHour}:${minutes} ${ampm}`;
                              return (
                                <div
                                  key={st.id}
                                  className="flex items-center gap-2 text-sm text-gray-700 bg-green-50 px-2 py-1 rounded"
                                >
                                  <Calendar className="w-3.5 h-3.5 text-green-600" />
                                  <span>{dateStr} at {timeStr}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-gray-400 mt-2">
                        {new Date(fb.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-red-700">
                  The cleaner declined but no detailed feedback was provided.
                </p>
              )}

              {onReschedule && (
                <button
                  onClick={() => onReschedule(appointment)}
                  className="w-full mt-2 px-4 py-2.5 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Reschedule Appointment
                </button>
              )}
            </div>
          )}

          {/* Start/Complete Job buttons for cleaners */}
          {role === "cleaner" &&
            (onStartJob || onCompleteJob) &&
            !isEditing && (
              <div className="flex items-center gap-2 pt-4 border-t border-gray-200 mt-4">
                {/* Start Job button - shows when status is confirmed */}
                {onStartJob &&
                  appointment.status === "confirmed" && (
                    <button
                      onClick={async () => {
                        setIsActionLoading(true);
                        try {
                          await onStartJob(appointment.id);
                          // Don't close panel - let user see the status change
                        } finally {
                          setIsActionLoading(false);
                        }
                      }}
                      disabled={isActionLoading}
                      className="flex-1 px-5 py-3 text-sm font-semibold bg-primary-600 text-white rounded-xl shadow-md hover:shadow-lg hover:bg-primary-700 hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-md flex items-center justify-center gap-2"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      {isActionLoading ? "Starting Job..." : "Start Job"}
                    </button>
                  )}
                {/* Complete Job button - shows when status is in_progress */}
                {onCompleteJob && appointment.status === "in_progress" && (
                  <button
                    onClick={async () => {
                      setIsActionLoading(true);
                      try {
                        await onCompleteJob(appointment.id);
                        // Don't close panel - let user see the status change
                      } finally {
                        setIsActionLoading(false);
                      }
                    }}
                    disabled={isActionLoading}
                    className="flex-1 px-4 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isActionLoading ? "Completing..." : "Complete Job"}
                  </button>
                )}
              </div>
            )}

          {/* Review button for pending appointments (admin or manager with permission) */}
          {((role === "admin" || (role === "manager" && canApproveDecline)) &&
            appointment.status === "pending" &&
            !isEditing) && (
              <div className="flex items-center gap-2 pt-4 border-t border-gray-200 mt-4">
                <button
                  className="flex-1 px-4 py-2 text-sm font-medium bg-primary-100 text-primary-700 rounded-lg hover:bg-primary-200 transition-colors"
                >
                  Review
                </button>
              </div>
            )}
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
