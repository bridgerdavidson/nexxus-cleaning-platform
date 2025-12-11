"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  User,
  Mail,
  Phone,
  Calendar,
  Home,
  DollarSign,
  Edit2,
  Save,
  Loader2,
  MapPin,
  Clock,
  ChevronRight,
  Plus,
} from "lucide-react";
import {
  AdminCustomer,
  CustomerAppointment,
  CustomerProperty,
  useCustomerDetails,
  updateCustomer,
} from "../hooks/useAdminData";
import AddPropertyModal from "./AddPropertyModal";
import AddAppointmentModal from "./AddAppointmentModal";

interface CustomerDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  customer: AdminCustomer | null;
  onCustomerUpdated?: () => void;
  onRefreshAppointments?: () => void;
  onRefreshProperties?: () => void;
}

export default function CustomerDetailModal({
  isOpen,
  onClose,
  customer,
  onCustomerUpdated,
  onRefreshAppointments,
  onRefreshProperties,
}: CustomerDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedCustomer, setEditedCustomer] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
  });
  const [activeTab, setActiveTab] = useState<"details" | "appointments" | "properties">("details");
  const [showAddPropertyModal, setShowAddPropertyModal] = useState(false);
  const [showAddAppointmentModal, setShowAddAppointmentModal] = useState(false);

  const { appointments, properties, loading, refetch: refetchDetails } = useCustomerDetails(
    isOpen ? customer?.id || null : null
  );

  // Update edited customer when customer prop changes
  useEffect(() => {
    if (customer) {
      setEditedCustomer({
        first_name: customer.first_name || "",
        last_name: customer.last_name || "",
        email: customer.email || "",
        phone: customer.phone || "",
      });
    }
  }, [customer]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
      setActiveTab("details");
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!customer) return;

    setIsSaving(true);
    const result = await updateCustomer(customer.id, editedCustomer);
    setIsSaving(false);

    if (result.success) {
      setIsEditing(false);
      if (onCustomerUpdated) {
        onCustomerUpdated();
      }
    } else {
      alert("Failed to update customer: " + result.error);
    }
  };

  const handleCancel = () => {
    if (customer) {
      setEditedCustomer({
        first_name: customer.first_name || "",
        last_name: customer.last_name || "",
        email: customer.email || "",
        phone: customer.phone || "",
      });
    }
    setIsEditing(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-700";
      case "confirmed":
        return "bg-blue-100 text-blue-700";
      case "in_progress":
        return "bg-purple-100 text-purple-700";
      case "completed":
        return "bg-green-100 text-green-700";
      case "cancelled":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const formatDate = (date: string) => {
    // Handle both date-only strings (YYYY-MM-DD) and full ISO timestamps
    // Extract just the date part (YYYY-MM-DD) from the string
    const dateOnly = date.split('T')[0]; // Get date part before 'T' if it exists
    const [year, month, day] = dateOnly.split('-').map(Number);
    
    // Validate that we have valid numbers
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return "Invalid Date";
    }
    
    // Parse date string as local date to avoid timezone issues
    const localDate = new Date(year, month - 1, day); // month is 0-indexed
    return localDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  if (!isOpen || !customer) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Side Panel */}
      <div className="fixed inset-y-0 right-0 flex max-w-full">
        <div className="w-screen max-w-lg">
          <div className="flex h-full flex-col bg-white shadow-xl">
            {/* Header */}
            <div className="bg-primary-600 px-6 py-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-4">
                  <div className="w-14 h-14 bg-white/20 rounded-full flex items-center justify-center">
                    {customer.avatar_url ? (
                      <img
                        src={customer.avatar_url}
                        alt=""
                        className="w-14 h-14 rounded-full object-cover"
                      />
                    ) : (
                      <User className="w-7 h-7 text-white" />
                    )}
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold text-white">
                      {customer.first_name} {customer.last_name}
                    </h2>
                    <p className="text-primary-100 text-sm">
                      Customer since {formatDate(customer.created_at)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Quick Stats */}
              <div className="mt-5 grid grid-cols-3 gap-4">
                <div className="bg-white/10 rounded-lg px-3 py-2">
                  <p className="text-primary-100 text-xs">Properties</p>
                  <p className="text-white font-semibold text-lg">
                    {customer.properties_count}
                  </p>
                </div>
                <div className="bg-white/10 rounded-lg px-3 py-2">
                  <p className="text-primary-100 text-xs">Appointments</p>
                  <p className="text-white font-semibold text-lg">
                    {customer.appointments_count}
                  </p>
                </div>
                <div className="bg-white/10 rounded-lg px-3 py-2">
                  <p className="text-primary-100 text-xs">Total Spent</p>
                  <p className="text-white font-semibold text-lg">
                    {formatCurrency(customer.total_spent)}
                  </p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200">
              <div className="flex">
                {(["details", "appointments", "properties"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                      activeTab === tab
                        ? "text-primary-600 border-b-2 border-primary-600"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {tab === "appointments" && (
                      <span className="ml-1 text-xs bg-gray-100 px-1.5 py-0.5 rounded-full">
                        {appointments.length}
                      </span>
                    )}
                    {tab === "properties" && (
                      <span className="ml-1 text-xs bg-gray-100 px-1.5 py-0.5 rounded-full">
                        {properties.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                </div>
              ) : (
                <>
                  {/* Details Tab */}
                  {activeTab === "details" && (
                    <div className="p-6 space-y-6">
                      {/* Edit Toggle */}
                      <div className="flex justify-end">
                        {!isEditing ? (
                          <button
                            onClick={() => setIsEditing(true)}
                            className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
                          >
                            <Edit2 className="w-4 h-4" />
                            Edit Profile
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={handleCancel}
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

                      {/* Contact Information */}
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 mb-4">
                          Contact Information
                        </h3>
                        <div className="space-y-4">
                          {/* First Name */}
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                              <User className="w-5 h-5 text-gray-500" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-gray-500">First Name</p>
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editedCustomer.first_name}
                                  onChange={(e) =>
                                    setEditedCustomer({
                                      ...editedCustomer,
                                      first_name: e.target.value,
                                    })
                                  }
                                  className="input-field mt-1 py-1.5"
                                />
                              ) : (
                                <p className="text-gray-900 font-medium">
                                  {customer.first_name || "—"}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Last Name */}
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                              <User className="w-5 h-5 text-gray-500" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-gray-500">Last Name</p>
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editedCustomer.last_name}
                                  onChange={(e) =>
                                    setEditedCustomer({
                                      ...editedCustomer,
                                      last_name: e.target.value,
                                    })
                                  }
                                  className="input-field mt-1 py-1.5"
                                />
                              ) : (
                                <p className="text-gray-900 font-medium">
                                  {customer.last_name || "—"}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Email */}
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                              <Mail className="w-5 h-5 text-gray-500" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-gray-500">Email</p>
                              {isEditing ? (
                                <input
                                  type="email"
                                  value={editedCustomer.email}
                                  onChange={(e) =>
                                    setEditedCustomer({
                                      ...editedCustomer,
                                      email: e.target.value,
                                    })
                                  }
                                  className="input-field mt-1 py-1.5"
                                />
                              ) : (
                                <p className="text-gray-900 font-medium">
                                  {customer.email}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Phone */}
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                              <Phone className="w-5 h-5 text-gray-500" />
                            </div>
                            <div className="flex-1">
                              <p className="text-xs text-gray-500">Phone</p>
                              {isEditing ? (
                                <input
                                  type="tel"
                                  value={editedCustomer.phone}
                                  onChange={(e) =>
                                    setEditedCustomer({
                                      ...editedCustomer,
                                      phone: e.target.value,
                                    })
                                  }
                                  className="input-field mt-1 py-1.5"
                                  placeholder="(555) 123-4567"
                                />
                              ) : (
                                <p className="text-gray-900 font-medium">
                                  {customer.phone || "—"}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Activity Summary */}
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900 mb-4">
                          Activity Summary
                        </h3>
                        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600 text-sm">Last Appointment</span>
                            <span className="text-gray-900 font-medium text-sm">
                              {customer.last_appointment_date
                                ? formatDate(customer.last_appointment_date)
                                : "No appointments yet"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600 text-sm">Total Appointments</span>
                            <span className="text-gray-900 font-medium text-sm">
                              {customer.appointments_count}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600 text-sm">Properties Registered</span>
                            <span className="text-gray-900 font-medium text-sm">
                              {customer.properties_count}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-gray-600 text-sm">Total Spent</span>
                            <span className="text-green-600 font-semibold text-sm">
                              {formatCurrency(customer.total_spent)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Appointments Tab */}
                  {activeTab === "appointments" && (
                    <div className="p-6">
                      {/* Add Appointment Button */}
                      <div className="mb-4">
                        <button
                          onClick={() => setShowAddAppointmentModal(true)}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
                        >
                          <Plus className="w-4 h-4" />
                          Add New Appointment
                        </button>
                      </div>

                      {appointments.length === 0 ? (
                        <div className="text-center py-12">
                          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                          <p className="text-gray-500">No appointments found</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {appointments.map((appointment) => (
                            <div
                              key={appointment.id}
                              className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors"
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Calendar className="w-4 h-4 text-gray-400" />
                                  <span className="text-gray-900 font-medium text-sm">
                                    {formatDate(appointment.scheduled_date)}
                                  </span>
                                  <Clock className="w-4 h-4 text-gray-400 ml-2" />
                                  <span className="text-gray-600 text-sm">
                                    {appointment.scheduled_time}
                                  </span>
                                </div>
                                <span
                                  className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(
                                    appointment.status
                                  )}`}
                                >
                                  {appointment.status.replace("_", " ")}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-gray-900 text-sm">
                                    {appointment.service_type?.name || "Service"}
                                  </p>
                                  <p className="text-gray-500 text-xs">
                                    {appointment.property?.address || "No address"}
                                  </p>
                                </div>
                                <span className="text-gray-900 font-semibold">
                                  {formatCurrency(appointment.total_price)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Properties Tab */}
                  {activeTab === "properties" && (
                    <div className="p-6">
                      {/* Add Property Button */}
                      <div className="mb-4">
                        <button
                          onClick={() => setShowAddPropertyModal(true)}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
                        >
                          <Plus className="w-4 h-4" />
                          Add New Property
                        </button>
                      </div>

                      {properties.length === 0 ? (
                        <div className="text-center py-12">
                          <Home className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                          <p className="text-gray-500">No properties found</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {properties.map((property) => (
                            <div
                              key={property.id}
                              className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <h4 className="text-gray-900 font-medium">
                                    {property.name}
                                  </h4>
                                  <div className="flex items-start gap-1 mt-1">
                                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                                    <p className="text-gray-600 text-sm">
                                      {property.address}, {property.city},{" "}
                                      {property.state} {property.zip_code}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-4 mt-2">
                                    {property.bedrooms && (
                                      <span className="text-xs text-gray-500">
                                        {property.bedrooms} bed
                                      </span>
                                    )}
                                    {property.bathrooms && (
                                      <span className="text-xs text-gray-500">
                                        {property.bathrooms} bath
                                      </span>
                                    )}
                                    {property.square_feet && (
                                      <span className="text-xs text-gray-500">
                                        {property.square_feet.toLocaleString()} sqft
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <ChevronRight className="w-5 h-5 text-gray-400" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Property Modal */}
      <AddPropertyModal
        isOpen={showAddPropertyModal}
        onClose={() => setShowAddPropertyModal(false)}
        onPropertyCreated={(newProperty) => {
          setShowAddPropertyModal(false);
          // Immediately refetch customer details to show the new property
          if (refetchDetails) {
            refetchDetails();
          }
          if (onRefreshProperties) {
            onRefreshProperties();
          }
          if (onCustomerUpdated) {
            onCustomerUpdated(); // Refresh customer data to update counts
          }
        }}
        preSelectedHomeownerId={customer?.id}
      />

      {/* Add Appointment Modal */}
      <AddAppointmentModal
        isOpen={showAddAppointmentModal}
        onClose={() => setShowAddAppointmentModal(false)}
        onAppointmentCreated={() => {
          setShowAddAppointmentModal(false);
          if (onRefreshAppointments) {
            onRefreshAppointments();
          }
          if (onCustomerUpdated) {
            onCustomerUpdated(); // Refresh customer data to update counts
          }
        }}
        preSelectedHomeownerId={customer?.id}
      />
    </div>
  );
}

