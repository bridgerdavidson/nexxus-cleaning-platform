"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Home,
  Search,
  Plus,
  User,
  CheckCircle,
  Loader2,
  Camera,
  AlertCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { CustomerProperty } from "../hooks/useAdminData";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import {
  validateImageFile,
  PROPERTY_PHOTOS_ALLOWED_TYPES,
  PROPERTY_PHOTOS_MAX_FILE_SIZE,
  IMAGE_ACCEPT_ATTR,
} from "../lib/upload";
import { uploadOne } from "../lib/image-upload/uploadOne";

interface Homeowner {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface AddPropertyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPropertyCreated?: (property?: CustomerProperty) => void;
  preSelectedHomeownerId?: string;
}

export default function AddPropertyModal({
  isOpen,
  onClose,
  onPropertyCreated,
  preSelectedHomeownerId,
}: AddPropertyModalProps) {
  const { currentOrganizationId } = useAuth();
  const propertyPhotoInputRef = useRef<HTMLInputElement>(null);

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  // Step management - always start at step 1
  // When homeowner is pre-selected: step 1 = property info, step 2 = optional details
  // When not pre-selected: step 1 = select homeowner, step 2 = property info, step 3 = optional details
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1 state
  const [homeowners, setHomeowners] = useState<Homeowner[]>([]);
  const [homeownersLoading, setHomeownersLoading] = useState(false);
  const [homeownerSearch, setHomeownerSearch] = useState("");
  const [selectedHomeowner, setSelectedHomeowner] = useState<Homeowner | null>(
    null,
  );

  // Step 2 state
  const [propertyName, setPropertyName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zipCode, setZipCode] = useState("");

  // Step 3 state
  const [bedrooms, setBedrooms] = useState<number | null>(null);
  const [bathrooms, setBathrooms] = useState<number | null>(null);
  const [squareFeet, setSquareFeet] = useState<number | null>(null);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [accessInstructions, setAccessInstructions] = useState("");

  // Creation state
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Optional property photo (compressed file held until create)
  const [propertyPhotoFile, setPropertyPhotoFile] = useState<File | null>(null);
  const [propertyPhotoPreview, setPropertyPhotoPreview] = useState<
    string | null
  >(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Fetch homeowners on modal open
  useEffect(() => {
    if (isOpen && currentOrganizationId) {
      if (preSelectedHomeownerId) {
        // If homeowner is pre-selected, fetch that specific homeowner
        fetchPreSelectedHomeowner();
      } else {
        // Otherwise, fetch all homeowners
        fetchHomeowners();
      }
    }
  }, [isOpen, currentOrganizationId, preSelectedHomeownerId]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(1);
      setSelectedHomeowner(null);
      setPropertyName("");
      setAddress("");
      setCity("");
      setState("");
      setZipCode("");
      setBedrooms(null);
      setBathrooms(null);
      setSquareFeet(null);
      setSpecialInstructions("");
      setAccessInstructions("");
      setError(null);
      setPropertyPhotoFile(null);
      if (propertyPhotoPreview) URL.revokeObjectURL(propertyPhotoPreview);
      setPropertyPhotoPreview(null);
      setPhotoError(null);
    }
  }, [isOpen, preSelectedHomeownerId, propertyPhotoPreview]);

  const fetchPreSelectedHomeowner = async () => {
    if (!preSelectedHomeownerId || !currentOrganizationId) return;

    try {
      setHomeownersLoading(true);
      const { data, error } = await supabase
        .from("user_profiles")
        .select("id, first_name, last_name, email")
        .eq("id", preSelectedHomeownerId)
        .single();

      if (error) throw error;

      if (data) {
        const homeowner: Homeowner = {
          id: data.id,
          first_name: data.first_name || "",
          last_name: data.last_name || "",
          email: data.email || "",
        };
        setSelectedHomeowner(homeowner);
      }
    } catch (err) {
      console.error("Error fetching pre-selected homeowner:", err);
      setError("Failed to load homeowner");
    } finally {
      setHomeownersLoading(false);
    }
  };

  const fetchHomeowners = async () => {
    if (!currentOrganizationId) return;

    try {
      setHomeownersLoading(true);

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

      setHomeowners(homeownersData);
    } catch (err) {
      console.error("Error fetching homeowners:", err);
      setError("Failed to load homeowners");
    } finally {
      setHomeownersLoading(false);
    }
  };

  const handlePropertyPhotoChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      const validation = validateImageFile(
        file,
        PROPERTY_PHOTOS_ALLOWED_TYPES,
        PROPERTY_PHOTOS_MAX_FILE_SIZE,
      );
      if (!validation.valid) {
        setPhotoError(validation.error ?? "Invalid file.");
        return;
      }
      setPhotoError(null);
      // Keep the original file — compression + HEIC conversion happen at
      // upload time inside uploadOne. Preview is built from the original so
      // the user sees their actual selection.
      if (propertyPhotoPreview) URL.revokeObjectURL(propertyPhotoPreview);
      setPropertyPhotoFile(file);
      setPropertyPhotoPreview(URL.createObjectURL(file));
    },
    [propertyPhotoPreview],
  );

  const handleRemovePropertyPhoto = useCallback(() => {
    setPropertyPhotoFile(null);
    if (propertyPhotoPreview) URL.revokeObjectURL(propertyPhotoPreview);
    setPropertyPhotoPreview(null);
    setPhotoError(null);
  }, [propertyPhotoPreview]);

  const handleCreateProperty = async () => {
    if (
      !selectedHomeowner ||
      !propertyName ||
      !address ||
      !city ||
      !state ||
      !zipCode ||
      !currentOrganizationId
    ) {
      setError("Please fill in all required fields");
      return;
    }

    try {
      setIsCreating(true);
      setError(null);

      const { data: insertData, error: insertError } = await supabase
        .from("properties")
        .insert({
          owner_id: selectedHomeowner.id,
          organization_id: currentOrganizationId,
          name: propertyName,
          address: address,
          city: city,
          state: state,
          zip_code: zipCode,
          bedrooms: bedrooms || null,
          bathrooms: bathrooms || null,
          square_feet: squareFeet || null,
          special_instructions: specialInstructions || null,
          access_instructions: accessInstructions || null,
        })
        .select(
          `
          id,
          name,
          address,
          city,
          state,
          zip_code,
          bedrooms,
          bathrooms,
          square_feet
        `,
        )
        .single();

      if (insertError) {
        console.error("Insert error details:", {
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
          code: insertError.code,
          fullError: insertError,
        });
        throw insertError;
      }

      let finalProperty: CustomerProperty = insertData as CustomerProperty;

      // If user selected a photo, upload it to the new property. Compression
      // and HEIC conversion happen inside uploadOne. Non-fatal: if the upload
      // fails the property is still created without a photo.
      if (propertyPhotoFile && insertData?.id) {
        try {
          const uploadResult = await uploadOne(propertyPhotoFile, {
            kind: "property",
            ctx: { propertyId: insertData.id, currentPhotoUrl: null },
          });
          finalProperty = {
            ...insertData,
            photo_url: uploadResult.url,
          } as CustomerProperty;
        } catch (err) {
          console.error("Property photo upload failed after create:", err);
        }
      }

      if (onPropertyCreated) {
        onPropertyCreated(finalProperty);
      }
      handleClose();
    } catch (err) {
      console.error("Error creating property:", err);
      let errorMessage = "Failed to create property";

      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === "object" && err !== null) {
        if ("message" in err) {
          errorMessage = String(err.message);
        } else if ("details" in err) {
          errorMessage = String(err.details) || errorMessage;
        } else if ("hint" in err) {
          errorMessage = String(err.hint) || errorMessage;
        }
      }

      // Also log the full error for debugging
      console.error("Full error object:", JSON.stringify(err, null, 2));

      setError(errorMessage);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    // Reset all state
    setCurrentStep(preSelectedHomeownerId ? 2 : 1);
    setSelectedHomeowner(null);
    setPropertyName("");
    setAddress("");
    setCity("");
    setState("");
    setZipCode("");
    setBedrooms(null);
    setBathrooms(null);
    setSquareFeet(null);
    setSpecialInstructions("");
    setAccessInstructions("");
    setHomeownerSearch("");
    setError(null);
    onClose();
  };

  const handleNext = () => {
    setError(null);
    setCurrentStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setError(null);
    setCurrentStep((prev) => prev - 1);
  };

  // Filter functions
  const filteredHomeowners = homeowners.filter((h) => {
    const searchLower = homeownerSearch.toLowerCase();
    return (
      h.first_name.toLowerCase().includes(searchLower) ||
      h.last_name.toLowerCase().includes(searchLower) ||
      h.email.toLowerCase().includes(searchLower)
    );
  });

  // Validation
  const isStep1Valid = selectedHomeowner !== null;
  const isStep2Valid =
    propertyName.trim() !== "" &&
    address.trim() !== "" &&
    city.trim() !== "" &&
    state.trim() !== "" &&
    zipCode.trim() !== "";

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden animate-slide-up">
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors z-10"
            aria-label="Close modal"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Header */}
          <div className="bg-gradient-to-r from-primary-600 to-primary-700 text-white px-8 py-6">
            <div className="flex items-center justify-center mb-3">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-white/20 rounded-full">
                <Home className="w-6 h-6" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-center mb-2">
              New Property
            </h2>
            <p className="text-primary-100 text-center text-sm">
              {preSelectedHomeownerId
                ? `Step ${currentStep} of 2`
                : `Step ${currentStep} of 3`}
            </p>

            {/* Step indicator */}
            <div className="flex justify-center gap-2 mt-4">
              {preSelectedHomeownerId ? (
                // 2 steps when homeowner pre-selected
                <>
                  <div
                    className={`h-1 w-16 rounded-full transition-colors ${
                      currentStep >= 1 ? "bg-white" : "bg-white/30"
                    }`}
                  />
                  <div
                    className={`h-1 w-16 rounded-full transition-colors ${
                      currentStep >= 2 ? "bg-white" : "bg-white/30"
                    }`}
                  />
                </>
              ) : (
                // 3 steps when not pre-selected
                <>
                  <div
                    className={`h-1 w-16 rounded-full transition-colors ${
                      currentStep >= 1 ? "bg-white" : "bg-white/30"
                    }`}
                  />
                  <div
                    className={`h-1 w-16 rounded-full transition-colors ${
                      currentStep >= 2 ? "bg-white" : "bg-white/30"
                    }`}
                  />
                  <div
                    className={`h-1 w-16 rounded-full transition-colors ${
                      currentStep >= 3 ? "bg-white" : "bg-white/30"
                    }`}
                  />
                </>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="p-8 overflow-y-auto max-h-[calc(90vh-250px)]">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                {error}
              </div>
            )}

            {/* Step 1: Select Homeowner (only when homeowner is NOT pre-selected) */}
            {currentStep === 1 && !preSelectedHomeownerId && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    Select Homeowner
                  </h3>

                  <div className="flex gap-2 mb-4">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <input
                        type="text"
                        placeholder="Search homeowners..."
                        value={homeownerSearch}
                        onChange={(e) => setHomeownerSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                  </div>

                  {homeownersLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                    </div>
                  ) : filteredHomeowners.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      No homeowners found
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto">
                      {filteredHomeowners.map((homeowner) => (
                        <button
                          key={homeowner.id}
                          type="button"
                          onClick={() => setSelectedHomeowner(homeowner)}
                          className={`p-4 border-2 rounded-lg text-left transition-all ${
                            selectedHomeowner?.id === homeowner.id
                              ? "border-primary-500 bg-primary-50"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                                <User className="w-5 h-5 text-primary-600" />
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">
                                  {homeowner.first_name} {homeowner.last_name}
                                </p>
                                <p className="text-sm text-gray-600">
                                  {homeowner.email}
                                </p>
                              </div>
                            </div>
                            {selectedHomeowner?.id === homeowner.id && (
                              <CheckCircle className="w-5 h-5 text-primary-600 flex-shrink-0" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 1: Property Name and Address (when homeowner pre-selected) OR Step 2 (when not pre-selected) */}
            {((preSelectedHomeownerId && currentStep === 1) ||
              (!preSelectedHomeownerId && currentStep === 2)) && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Property Information
                </h3>

                {/* Property Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Property Name *
                  </label>
                  <input
                    type="text"
                    value={propertyName}
                    onChange={(e) => setPropertyName(e.target.value)}
                    placeholder="e.g., Main House, Vacation Home"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    required
                  />
                </div>

                {/* Address */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Street Address *
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main Street"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    required
                  />
                </div>

                {/* City, State, Zip */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      City *
                    </label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="City"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      State *
                    </label>
                    <input
                      type="text"
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      placeholder="State"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Zip Code *
                    </label>
                    <input
                      type="text"
                      value={zipCode}
                      onChange={(e) => setZipCode(e.target.value)}
                      placeholder="12345"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      required
                    />
                  </div>
                </div>

                {/* Optional Property Photo */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Property Photo (optional)
                  </label>
                  {propertyPhotoFile || propertyPhotoPreview ? (
                    <div className="flex items-center gap-3">
                      <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-100 ring-2 ring-gray-200">
                        <img
                          src={propertyPhotoPreview ?? undefined}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={handleRemovePropertyPhoto}
                          className="text-sm text-gray-600 hover:text-red-600"
                        >
                          Remove photo
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        ref={propertyPhotoInputRef}
                        type="file"
                        accept={IMAGE_ACCEPT_ATTR}
                        onChange={handlePropertyPhotoChange}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => propertyPhotoInputRef.current?.click()}
                        className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Camera className="w-4 h-4" />
                        Choose photo
                      </button>
                    </div>
                  )}
                  {photoError && (
                    <div className="flex items-center gap-1.5 text-red-600 text-sm mt-1">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <span>{photoError}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 2: Optional Details (when homeowner pre-selected) OR Step 3 (when not pre-selected) */}
            {((preSelectedHomeownerId && currentStep === 2) ||
              (!preSelectedHomeownerId && currentStep === 3)) && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Additional Details (Optional)
                </h3>

                {/* Bedrooms, Bathrooms, Square Feet */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Bedrooms
                    </label>
                    <input
                      type="number"
                      value={bedrooms || ""}
                      onChange={(e) =>
                        setBedrooms(
                          e.target.value ? parseInt(e.target.value) : null,
                        )
                      }
                      min="0"
                      placeholder="0"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Bathrooms
                    </label>
                    <input
                      type="number"
                      value={bathrooms || ""}
                      onChange={(e) =>
                        setBathrooms(
                          e.target.value ? parseInt(e.target.value) : null,
                        )
                      }
                      min="0"
                      step="0.5"
                      placeholder="0"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Square Feet
                    </label>
                    <input
                      type="number"
                      value={squareFeet || ""}
                      onChange={(e) =>
                        setSquareFeet(
                          e.target.value ? parseInt(e.target.value) : null,
                        )
                      }
                      min="0"
                      placeholder="0"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                </div>

                {/* Special Instructions */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Special Instructions
                  </label>
                  <textarea
                    value={specialInstructions}
                    onChange={(e) => setSpecialInstructions(e.target.value)}
                    rows={4}
                    placeholder="Any special cleaning instructions or notes..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                  />
                </div>

                {/* Access Instructions */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Access Instructions
                  </label>
                  <textarea
                    value={accessInstructions}
                    onChange={(e) => setAccessInstructions(e.target.value)}
                    rows={4}
                    placeholder="How to access the property (door code, key location, etc.)..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-200 px-8 py-4 bg-gray-50">
            <div className="flex justify-between items-center">
              {currentStep === 1 ? (
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-6 py-2 text-gray-700 hover:text-gray-900 font-medium transition-colors"
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleBack}
                  className="px-6 py-2 text-gray-700 hover:text-gray-900 font-medium transition-colors"
                >
                  Back
                </button>
              )}

              {(preSelectedHomeownerId && currentStep < 2) ||
              (!preSelectedHomeownerId && currentStep < 3) ? (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={
                    // When homeowner pre-selected: step 1 needs property info
                    (preSelectedHomeownerId &&
                      currentStep === 1 &&
                      !isStep2Valid) ||
                    // When not pre-selected: step 1 needs homeowner, step 2 needs property info
                    (!preSelectedHomeownerId &&
                      currentStep === 1 &&
                      !isStep1Valid) ||
                    (!preSelectedHomeownerId &&
                      currentStep === 2 &&
                      !isStep2Valid)
                  }
                  className="px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreateProperty}
                  disabled={isCreating}
                  className="px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Property"
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
