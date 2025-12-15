"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Home,
  MapPin,
  User,
  Mail,
  Bed,
  Bath,
  Square,
  Plus,
  Calendar,
  Edit2,
  Save,
  Loader2,
} from "lucide-react";
import { createPortal } from "react-dom";
import { PropertyCardData } from "./PropertyCard";
import AddAppointmentModal from "./AddAppointmentModal";
import { updateProperty } from "../hooks/useAdminData";

interface PropertySidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  property: PropertyCardData | null;
  onPropertyUpdated?: (updatedProperty: PropertyCardData) => void;
  onRefreshAppointments?: () => void;
  role: "admin" | "manager";
}

export default function PropertySidePanel({
  isOpen,
  onClose,
  property,
  onPropertyUpdated,
  onRefreshAppointments,
  role, // eslint-disable-line @typescript-eslint/no-unused-vars
}: PropertySidePanelProps) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showAddAppointmentModal, setShowAddAppointmentModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editedProperty, setEditedProperty] = useState({
    name: "",
    address: "",
    city: "",
    state: "",
    zip_code: "",
    bedrooms: null as number | null,
    bathrooms: null as number | null,
    square_feet: null as number | null,
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

  // Update edited property when property prop changes
  useEffect(() => {
    if (property) {
      setEditedProperty({
        name: property.name || "",
        address: property.address || "",
        city: property.city || "",
        state: property.state || "",
        zip_code: property.zip_code || "",
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        square_feet: property.square_feet,
      });
    }
  }, [property]);

  // Reset state when panel closes
  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
    }
  }, [isOpen]);

  if (!mounted || (!isOpen && !isAnimating) || !property) return null;

  const getHomeownerName = () => {
    if (property.homeowner) {
      const { first_name, last_name } = property.homeowner;
      return `${first_name} ${last_name}`;
    }
    return "Unknown";
  };

  const getFullAddress = () => {
    return `${property.address}, ${property.city}, ${property.state} ${property.zip_code}`;
  };

  const handleClose = () => {
    // Don't close if modal is open or if editing
    if (showAddAppointmentModal || isEditing) return;

    setIsAnimating(false);
    setTimeout(() => {
      onClose();
    }, 300); // match duration-300
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Don't close if clicking on the modal or if modal is open
    if (showAddAppointmentModal || isEditing) return;

    // Only close if clicking directly on the backdrop (not on children)
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleSave = async () => {
    if (!property) return;

    setIsSaving(true);
    const result = await updateProperty(property.id, editedProperty);
    setIsSaving(false);

    if (result.success && result.data) {
      // Merge updated data with existing property data to preserve homeowner info
      const updatedProperty: PropertyCardData = {
        ...property,
        name: result.data.name,
        address: result.data.address,
        city: result.data.city,
        state: result.data.state,
        zip_code: result.data.zip_code,
        bedrooms: result.data.bedrooms,
        bathrooms: result.data.bathrooms,
        square_feet: result.data.square_feet,
      };

      // Update local edited state immediately
      setEditedProperty({
        name: updatedProperty.name || "",
        address: updatedProperty.address || "",
        city: updatedProperty.city || "",
        state: updatedProperty.state || "",
        zip_code: updatedProperty.zip_code || "",
        bedrooms: updatedProperty.bedrooms,
        bathrooms: updatedProperty.bathrooms,
        square_feet: updatedProperty.square_feet,
      });

      setIsEditing(false);
      if (onPropertyUpdated) {
        onPropertyUpdated(updatedProperty);
      }
    } else {
      alert("Failed to update property: " + result.error);
    }
  };

  const handleCancel = () => {
    if (property) {
      setEditedProperty({
        name: property.name || "",
        address: property.address || "",
        city: property.city || "",
        state: property.state || "",
        zip_code: property.zip_code || "",
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        square_feet: property.square_feet,
      });
    }
    setIsEditing(false);
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">
              Property Details
            </h2>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
          {/* Edit Toggle */}
          <div className="flex justify-end">
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
              >
                <Edit2 className="w-4 h-4" />
                Edit Property
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
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 pb-6">
          {/* Property Name */}
          <div>
            <div className="flex items-start gap-2">
              <Home className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-gray-500">Property Name</p>
                {isEditing ? (
                  <input
                    type="text"
                    value={editedProperty.name}
                    onChange={(e) =>
                      setEditedProperty({
                        ...editedProperty,
                        name: e.target.value,
                      })
                    }
                    className="input-field mt-1 py-1.5"
                  />
                ) : (
                  <p className="font-medium text-gray-900 text-lg">
                    {property.name}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Address */}
          <div>
            <p className="text-sm text-gray-500 mb-3">Address</p>
            {isEditing ? (
              <div className="space-y-3">
                <div>
                  <input
                    type="text"
                    value={editedProperty.address}
                    onChange={(e) =>
                      setEditedProperty({
                        ...editedProperty,
                        address: e.target.value,
                      })
                    }
                    placeholder="Street address"
                    className="input-field py-1.5"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input
                      type="text"
                      value={editedProperty.city}
                      onChange={(e) =>
                        setEditedProperty({
                          ...editedProperty,
                          city: e.target.value,
                        })
                      }
                      placeholder="City"
                      className="input-field py-1.5"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={editedProperty.state}
                      onChange={(e) =>
                        setEditedProperty({
                          ...editedProperty,
                          state: e.target.value,
                        })
                      }
                      placeholder="State"
                      className="input-field py-1.5"
                    />
                  </div>
                </div>
                <div>
                  <input
                    type="text"
                    value={editedProperty.zip_code}
                    onChange={(e) =>
                      setEditedProperty({
                        ...editedProperty,
                        zip_code: e.target.value,
                      })
                    }
                    placeholder="ZIP Code"
                    className="input-field py-1.5"
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <MapPin className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-gray-900">
                    {getFullAddress()}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Property Details */}
          {(property.bedrooms !== null ||
            property.bathrooms !== null ||
            property.square_feet !== null ||
            isEditing) && (
            <div>
              <p className="text-sm text-gray-500 mb-3">Property Details</p>
              {isEditing ? (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Bedrooms</p>
                    <input
                      type="number"
                      value={editedProperty.bedrooms || ""}
                      onChange={(e) =>
                        setEditedProperty({
                          ...editedProperty,
                          bedrooms: e.target.value
                            ? parseInt(e.target.value)
                            : null,
                        })
                      }
                      placeholder="—"
                      className="input-field py-1.5"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Bathrooms</p>
                    <input
                      type="number"
                      value={editedProperty.bathrooms || ""}
                      onChange={(e) =>
                        setEditedProperty({
                          ...editedProperty,
                          bathrooms: e.target.value
                            ? parseInt(e.target.value)
                            : null,
                        })
                      }
                      placeholder="—"
                      className="input-field py-1.5"
                    />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Square Feet</p>
                    <input
                      type="number"
                      value={editedProperty.square_feet || ""}
                      onChange={(e) =>
                        setEditedProperty({
                          ...editedProperty,
                          square_feet: e.target.value
                            ? parseInt(e.target.value)
                            : null,
                        })
                      }
                      placeholder="—"
                      className="input-field py-1.5"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-4">
                  {property.bedrooms !== null && (
                    <div className="flex items-center gap-2">
                      <Bed className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">Bedrooms</p>
                        <p className="font-medium text-gray-900">
                          {property.bedrooms}
                        </p>
                      </div>
                    </div>
                  )}
                  {property.bathrooms !== null && (
                    <div className="flex items-center gap-2">
                      <Bath className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">Bathrooms</p>
                        <p className="font-medium text-gray-900">
                          {property.bathrooms}
                        </p>
                      </div>
                    </div>
                  )}
                  {property.square_feet !== null && (
                    <div className="flex items-center gap-2">
                      <Square className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-xs text-gray-500">Square Feet</p>
                        <p className="font-medium text-gray-900">
                          {property.square_feet.toLocaleString()} sqft
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Homeowner */}
          {property.homeowner && (
            <div>
              <p className="text-sm text-gray-500 mb-3">Homeowner</p>
              <div className="flex items-start gap-2">
                <User className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium text-gray-900">
                    {getHomeownerName()}
                  </p>
                  {property.homeowner.email && (
                    <div className="flex items-center gap-1 mt-1">
                      <Mail className="w-4 h-4 text-gray-400" />
                      <p className="text-sm text-gray-600">
                        {property.homeowner.email}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Floating Action Footer */}
        <div className="flex-shrink-0 bg-white border-t border-gray-200 p-4 sm:p-6 shadow-lg">
          <button
            onClick={() => setShowAddAppointmentModal(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
          >
            <Calendar className="w-4 h-4" />
            New Appointment
          </button>
        </div>
      </div>

      {/* Add Appointment Modal - Rendered via portal, has higher z-index */}
      {showAddAppointmentModal && property.homeowner && (
        <AddAppointmentModal
          isOpen={showAddAppointmentModal}
          onClose={() => setShowAddAppointmentModal(false)}
          onAppointmentCreated={() => {
            setShowAddAppointmentModal(false);
            // Refresh appointments
            if (onRefreshAppointments) {
              onRefreshAppointments();
            }
          }}
          preSelectedHomeownerId={property.homeowner.id}
          preSelectedPropertyId={property.id}
        />
      )}
    </div>
  );

  return createPortal(panel, document.body);
}
