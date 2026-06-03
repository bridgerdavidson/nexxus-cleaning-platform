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
  Calendar,
  Edit2,
  Save,
  Loader2,
  Search,
  CheckCircle,
  UserPlus,
  Trash2,
} from "lucide-react";
import StatusBadge from "./StatusBadge";
import { createPortal } from "react-dom";
import { PropertyCardData } from "./PropertyCard";
import AddAppointmentModal from "./AddAppointmentModal";
import PropertyPhotoUpload from "./PropertyPhotoUpload";
import { updateProperty } from "../hooks/useAdminData";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "@/contexts/ToastContext";
import { supabase } from "../lib/supabase";
import { stripeSelfPayUiEnabled } from "../lib/stripe/flags";

interface AttachHomeowner {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface PropertySidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  property: PropertyCardData | null;
  onPropertyUpdated?: (updatedProperty: PropertyCardData) => void;
  onRefreshAppointments?: () => void;
  role: "admin" | "manager" | "homeowner";
  // When the panel opens with this true, it starts in edit mode (used by the card's
  // "Edit" action). Resets to view mode on close.
  startInEdit?: boolean;
  // Delete the property (runs the parent's existing delete-confirm flow). When set,
  // a small trash-can button appears in the header next to Edit (staff only).
  onDelete?: (propertyId: string) => void;
}

export default function PropertySidePanel({
  isOpen,
  onClose,
  property,
  onPropertyUpdated,
  onRefreshAppointments,
  role,
  startInEdit = false,
  onDelete,
}: PropertySidePanelProps) {
  // Lock body scroll when panel is open
  useBodyScrollLock(isOpen);

  const { currentOrganizationId } = useAuth();
  const { showToast } = useToast();

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

  // Homeowner picker state (attach / change / remove — self-pay flag-gated)
  // pickerMode: "attach" = no current homeowner; "change" = replacing existing
  const [showHomeownerPicker, setShowHomeownerPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<"attach" | "change">("attach");
  const [attachHomeowners, setAttachHomeowners] = useState<AttachHomeowner[]>([]);
  const [attachHomeownersLoading, setAttachHomeownersLoading] = useState(false);
  const [attachHomeownerSearch, setAttachHomeownerSearch] = useState("");
  const [selectedAttachHomeowner, setSelectedAttachHomeowner] =
    useState<AttachHomeowner | null>(null);
  const [isAttaching, setIsAttaching] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Start animating when opened. When opened via the card's "Edit" action
  // (startInEdit), enter edit mode immediately; otherwise open in view mode.
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
      setIsEditing(startInEdit);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setShowHomeownerPicker(false);
      setPickerMode("attach");
      setAttachHomeowners([]);
      setAttachHomeownerSearch("");
      setSelectedAttachHomeowner(null);
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

  const fetchAttachHomeowners = async () => {
    if (!currentOrganizationId) return;
    try {
      setAttachHomeownersLoading(true);
      const { data: members, error: membersError } = await supabase
        .from("organization_members")
        .select(
          `
          user_id,
          user_profiles!inner(
            id,
            first_name,
            last_name,
            email
          )
        `,
        )
        .eq("organization_id", currentOrganizationId)
        .eq("role", "homeowner");
      if (membersError) throw membersError;
      const homeownersData = (members || [])
        .map((member) => {
          const profile = Array.isArray(member.user_profiles)
            ? member.user_profiles[0]
            : member.user_profiles;
          return {
            id: profile.id,
            first_name: profile.first_name,
            last_name: profile.last_name,
            email: profile.email,
          };
        })
        .sort((a, b) => a.first_name.localeCompare(b.first_name));
      setAttachHomeowners(homeownersData);
    } catch (err) {
      console.error("Error fetching homeowners:", err);
      showToast("Failed to load homeowners", { variant: "error" });
    } finally {
      setAttachHomeownersLoading(false);
    }
  };

  const handleConfirmHomeownerChange = async () => {
    if (!property || !selectedAttachHomeowner) return;
    setIsAttaching(true);
    try {
      const { error } = await supabase
        .from("properties")
        .update({ owner_id: selectedAttachHomeowner.id })
        .eq("id", property.id);
      if (error) throw error;
      const msg =
        pickerMode === "attach"
          ? "Homeowner attached. They can now see this property's cleanings."
          : "Homeowner updated.";
      showToast(msg, { variant: "success" });
      const updatedProperty: PropertyCardData = {
        ...property,
        homeowner: {
          id: selectedAttachHomeowner.id,
          first_name: selectedAttachHomeowner.first_name,
          last_name: selectedAttachHomeowner.last_name,
          email: selectedAttachHomeowner.email,
        },
      };
      setShowHomeownerPicker(false);
      setAttachHomeownerSearch("");
      setSelectedAttachHomeowner(null);
      if (onPropertyUpdated) {
        onPropertyUpdated(updatedProperty);
      }
    } catch (err) {
      console.error("Error updating homeowner:", err);
      showToast("Failed to update homeowner. Please try again.", {
        variant: "error",
      });
    } finally {
      setIsAttaching(false);
    }
  };

  const handleRemoveHomeowner = async () => {
    if (!property) return;
    setIsRemoving(true);
    try {
      const { error } = await supabase
        .from("properties")
        .update({ owner_id: null })
        .eq("id", property.id);
      if (error) throw error;
      showToast("Homeowner removed. This property is now company-owned.", {
        variant: "success",
      });
      const updatedProperty: PropertyCardData = {
        ...property,
        homeowner: null,
      };
      if (onPropertyUpdated) {
        onPropertyUpdated(updatedProperty);
      }
    } catch (err) {
      console.error("Error removing homeowner:", err);
      showToast("Failed to remove homeowner. Please try again.", {
        variant: "error",
      });
    } finally {
      setIsRemoving(false);
    }
  };

  const filteredAttachHomeowners = attachHomeowners.filter((h) => {
    const q = attachHomeownerSearch.toLowerCase();
    return (
      h.first_name.toLowerCase().includes(q) ||
      h.last_name.toLowerCase().includes(q) ||
      h.email.toLowerCase().includes(q)
    );
  });

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
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit Property
                </button>
                {/* Small trash-can delete — staff only, when a handler is provided */}
                {role !== "homeowner" && onDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(property.id);
                      handleClose();
                    }}
                    aria-label="Delete property"
                    title="Delete property"
                    className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
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
          {/* Property Photo */}
          <div>
            <p className="text-sm text-gray-500 mb-2">Property Photo</p>
            {isEditing ? (
              <PropertyPhotoUpload
                propertyId={property.id}
                currentPhotoUrl={property.photo_url}
                onUploadSuccess={(url) => {
                  if (onPropertyUpdated) {
                    onPropertyUpdated({ ...property, photo_url: url });
                  }
                }}
                disabled={false}
              />
            ) : (
              <div className="flex justify-center">
                {property.photo_url ? (
                  <img
                    src={property.photo_url}
                    alt="Property"
                    className="w-28 h-28 rounded-full object-cover ring-2 ring-gray-200"
                  />
                ) : (
                  <div className="w-28 h-28 rounded-full bg-gray-100 flex items-center justify-center ring-2 ring-gray-200">
                    <Home className="w-12 h-12 text-primary-600" />
                  </div>
                )}
              </div>
            )}
          </div>

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

          {/* Homeowner section — staff only */}
          {role !== "homeowner" && (
            <div>
              <p className="text-sm text-gray-500 mb-3">Homeowner</p>

              {/* Current homeowner display */}
              {property.homeowner && (
                <div className="flex items-start gap-2 mb-3">
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
              )}

              {/* No homeowner: org-owned badge (flag off) or attach action (flag on) */}
              {property.homeowner === null && !stripeSelfPayUiEnabled() && (
                <StatusBadge status="org_owned" size="sm" />
              )}

              {property.homeowner === null && stripeSelfPayUiEnabled() && (
                <StatusBadge status="org_owned" size="sm" />
              )}

              {/* Self-pay flag: change / remove / attach actions */}
              {stripeSelfPayUiEnabled() && !showHomeownerPicker && (
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  {property.homeowner ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setPickerMode("change");
                          setShowHomeownerPicker(true);
                          fetchAttachHomeowners();
                        }}
                        className="flex items-center gap-2 px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
                      >
                        <UserPlus className="w-4 h-4" />
                        Change homeowner
                      </button>
                      <button
                        type="button"
                        onClick={handleRemoveHomeowner}
                        disabled={isRemoving}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors font-medium disabled:opacity-60"
                      >
                        {isRemoving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <User className="w-4 h-4" />
                        )}
                        Remove homeowner
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setPickerMode("attach");
                        setShowHomeownerPicker(true);
                        fetchAttachHomeowners();
                      }}
                      className="flex items-center gap-2 px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium"
                    >
                      <UserPlus className="w-4 h-4" />
                      Attach a homeowner
                    </button>
                  )}
                </div>
              )}

              {/* Picker (attach or change) */}
              {stripeSelfPayUiEnabled() && showHomeownerPicker && (
                <div className="space-y-3 mt-2">
                  <p className="text-xs font-medium text-gray-600">
                    {pickerMode === "attach" ? "Select a homeowner to attach" : "Select a new homeowner"}
                  </p>
                  {/* Search input */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Search homeowners..."
                      value={attachHomeownerSearch}
                      onChange={(e) => setAttachHomeownerSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                    />
                  </div>

                  {/* Results list */}
                  {attachHomeownersLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
                    </div>
                  ) : filteredAttachHomeowners.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-4">
                      No homeowners found
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {filteredAttachHomeowners.map((homeowner) => (
                        <button
                          key={homeowner.id}
                          type="button"
                          onClick={() => setSelectedAttachHomeowner(homeowner)}
                          className={`w-full p-3 border-2 rounded-lg text-left transition-all ${
                            selectedAttachHomeowner?.id === homeowner.id
                              ? "border-primary-500 bg-primary-50"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <User className="w-4 h-4 text-primary-600" />
                              </div>
                              <div>
                                <p className="font-medium text-gray-900 text-sm">
                                  {homeowner.first_name} {homeowner.last_name}
                                </p>
                                <p className="text-xs text-gray-600">
                                  {homeowner.email}
                                </p>
                              </div>
                            </div>
                            {selectedAttachHomeowner?.id === homeowner.id && (
                              <CheckCircle className="w-4 h-4 text-primary-600 flex-shrink-0" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowHomeownerPicker(false);
                        setAttachHomeownerSearch("");
                        setSelectedAttachHomeowner(null);
                      }}
                      className="flex-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 font-medium border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmHomeownerChange}
                      disabled={!selectedAttachHomeowner || isAttaching}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium disabled:opacity-60 transition-colors"
                    >
                      {isAttaching ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : null}
                      Confirm
                    </button>
                  </div>
                </div>
              )}
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

      {/* Add Appointment Modal - Rendered via portal, has higher z-index.
          Opens pre-filled to this property on step 2 of the full 3-step flow (Back
          returns to an editable step 1). No homeowner gate: org-owned properties
          (homeowner === null) open in self-pay mode. */}
      {showAddAppointmentModal && (
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
          preSelectedHomeownerId={property.homeowner?.id}
          preSelectedPropertyId={property.id}
          startOnDetailsStep
        />
      )}
    </div>
  );

  return createPortal(panel, document.body);
}
