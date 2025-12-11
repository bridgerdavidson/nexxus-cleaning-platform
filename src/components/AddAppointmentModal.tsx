"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Calendar,
  Search,
  Plus,
  User,
  Home,
  Star,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";

interface Homeowner {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface Property {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  owner_id: string;
}

interface ServiceType {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  duration_minutes: number;
}

interface Cleaner {
  id: string;
  rating: number;
  total_jobs: number;
  user_profile: {
    first_name: string;
    last_name: string;
    avatar_url: string | null;
  } | null;
}

interface AddAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAppointmentCreated: () => void;
  preSelectedHomeownerId?: string;
  preSelectedPropertyId?: string;
}

export default function AddAppointmentModal({
  isOpen,
  onClose,
  onAppointmentCreated,
  preSelectedHomeownerId,
  preSelectedPropertyId,
}: AddAppointmentModalProps) {
  const { currentOrganizationId } = useAuth();

  // Step management - always start at step 1
  // When homeowner only is pre-selected: step 1 = select property, step 2 = appointment details, step 3 = cleaner
  // When homeowner and property are pre-selected: step 1 = appointment details, step 2 = cleaner
  // When not pre-selected: step 1 = homeowner/property, step 2 = appointment details, step 3 = cleaner
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1 state
  const [homeowners, setHomeowners] = useState<Homeowner[]>([]);
  const [homeownersLoading, setHomeownersLoading] = useState(false);
  const [homeownerSearch, setHomeownerSearch] = useState("");
  const [selectedHomeowner, setSelectedHomeowner] = useState<Homeowner | null>(
    null
  );

  const [properties, setProperties] = useState<Property[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertySearch, setPropertySearch] = useState("");
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(
    null
  );

  // Step 2 state
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [serviceTypesLoading, setServiceTypesLoading] = useState(false);
  const [selectedServiceType, setSelectedServiceType] =
    useState<ServiceType | null>(null);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [specialRequests, setSpecialRequests] = useState("");

  // Step 3 state
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [cleanersLoading, setCleanersLoading] = useState(false);
  const [cleanerSearch, setCleanerSearch] = useState("");
  const [selectedCleaner, setSelectedCleaner] = useState<Cleaner | null>(null);
  const [skipCleaner, setSkipCleaner] = useState(false);

  // Creation state
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch and set pre-selected homeowner
  const fetchPreSelectedHomeowner = async () => {
    if (!preSelectedHomeownerId || !currentOrganizationId) return;

    try {
      // Fetch homeowner
      const { data: homeownerData, error: homeownerError } = await supabase
        .from("user_profiles")
        .select("id, first_name, last_name, email")
        .eq("id", preSelectedHomeownerId)
        .single();

      if (homeownerError) throw homeownerError;

      if (homeownerData) {
        const homeowner: Homeowner = {
          id: homeownerData.id,
          first_name: homeownerData.first_name,
          last_name: homeownerData.last_name,
          email: homeownerData.email,
        };
        setSelectedHomeowner(homeowner);

        // If property is also pre-selected, fetch it
        if (preSelectedPropertyId) {
          const { data: propertyData, error: propertyError } = await supabase
            .from("properties")
            .select("*")
            .eq("id", preSelectedPropertyId)
            .single();

          if (propertyError) throw propertyError;

          if (propertyData) {
            const property: Property = {
              id: propertyData.id,
              name: propertyData.name,
              address: propertyData.address,
              city: propertyData.city,
              state: propertyData.state,
              zip_code: propertyData.zip_code,
              owner_id: propertyData.owner_id,
            };
            setSelectedProperty(property);
          }
        } else {
          // If only homeowner is pre-selected, fetch their properties for step 1
          fetchProperties(preSelectedHomeownerId);
        }
      }
    } catch (err) {
      console.error("Error fetching pre-selected homeowner:", err);
      setError("Failed to load homeowner information");
    }
  };

  // Fetch homeowners on modal open
  useEffect(() => {
    if (isOpen && currentOrganizationId) {
      fetchServiceTypes();
      fetchCleaners();

      // If homeowner is pre-selected, fetch homeowner (and property if also pre-selected)
      if (preSelectedHomeownerId) {
        fetchPreSelectedHomeowner();
      } else {
        // Otherwise, fetch all homeowners
        fetchHomeowners();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isOpen,
    currentOrganizationId,
    preSelectedHomeownerId,
    preSelectedPropertyId,
  ]);

  // Fetch properties when homeowner is selected (only when not pre-selected)
  useEffect(() => {
    if (selectedHomeowner && !preSelectedHomeownerId) {
      fetchProperties(selectedHomeowner.id);
    } else if (!selectedHomeowner && !preSelectedHomeownerId) {
      // Clear properties if homeowner is deselected
      setProperties([]);
      setSelectedProperty(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHomeowner, preSelectedHomeownerId]);

  const fetchHomeowners = async () => {
    if (!currentOrganizationId) return;

    try {
      setHomeownersLoading(true);

      // Get all users in this organization with homeowner role
      // This now works directly thanks to the RLS policies for organization_members
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
        `
        )
        .eq("organization_id", currentOrganizationId)
        .eq("role", "homeowner");

      if (membersError) throw membersError;

      // Transform the data to flatten it
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

  const fetchProperties = async (ownerId: string) => {
    if (!currentOrganizationId) return;

    try {
      setPropertiesLoading(true);
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("owner_id", ownerId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setProperties(data || []);
    } catch (err) {
      console.error("Error fetching properties:", err);
      setError("Failed to load properties");
    } finally {
      setPropertiesLoading(false);
    }
  };

  const fetchServiceTypes = async () => {
    if (!currentOrganizationId) return;

    try {
      setServiceTypesLoading(true);
      const { data, error } = await supabase
        .from("service_types")
        .select("id, name, description, base_price, duration_minutes")
        .eq("is_active", true)
        .eq("organization_id", currentOrganizationId)
        .order("name", { ascending: true });

      if (error) throw error;
      setServiceTypes(data || []);
    } catch (err) {
      console.error("Error fetching service types:", err);
      setError("Failed to load service types");
    } finally {
      setServiceTypesLoading(false);
    }
  };

  const fetchCleaners = async () => {
    if (!currentOrganizationId) return;

    try {
      setCleanersLoading(true);
      const { data, error } = await supabase
        .from("cleaner_profiles")
        .select(
          `
          id,
          rating,
          total_jobs,
          user_profile:user_profiles!id(
            first_name,
            last_name,
            avatar_url
          )
        `
        )
        .eq("organization_id", currentOrganizationId)
        .eq("is_available", true)
        .order("rating", { ascending: false });

      if (error) throw error;

      // Transform the data to handle array responses
      const transformedData = (data || []).map((cleaner) => ({
        ...cleaner,
        user_profile: Array.isArray(cleaner.user_profile)
          ? cleaner.user_profile[0]
          : cleaner.user_profile,
      }));

      setCleaners(transformedData);
    } catch (err) {
      console.error("Error fetching cleaners:", err);
      setError("Failed to load cleaners");
    } finally {
      setCleanersLoading(false);
    }
  };

  const handleCreateAppointment = async () => {
    if (
      !selectedHomeowner ||
      !selectedProperty ||
      !selectedServiceType ||
      !scheduledDate ||
      !scheduledTime ||
      !currentOrganizationId
    ) {
      setError("Please fill in all required fields");
      return;
    }

    if (!skipCleaner && !selectedCleaner) {
      setError('Please select a cleaner or check "Skip for now"');
      return;
    }

    try {
      setIsCreating(true);
      setError(null);

      const { data: insertData, error: insertError } = await supabase
        .from("appointments")
        .insert({
          organization_id: currentOrganizationId,
          homeowner_id: selectedHomeowner.id,
          cleaner_id: skipCleaner ? null : selectedCleaner?.id,
          property_id: selectedProperty.id,
          service_type_id: selectedServiceType.id,
          scheduled_date: scheduledDate,
          scheduled_time: scheduledTime,
          duration_minutes: selectedServiceType.duration_minutes,
          total_price: selectedServiceType.base_price,
          special_requests: specialRequests || null,
          status: "pending",
        });

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

      console.log("Appointment created successfully:", insertData);

      // Success! Close modal and refresh
      onAppointmentCreated();
      handleClose();
    } catch (err) {
      console.error("Error creating appointment:", err);
      let errorMessage = "Failed to create appointment";

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
    setCurrentStep(1);
    if (!preSelectedHomeownerId) {
      setSelectedHomeowner(null);
    }
    if (!preSelectedPropertyId) {
      setSelectedProperty(null);
    }
    setSelectedServiceType(null);
    setScheduledDate("");
    setScheduledTime("");
    setSpecialRequests("");
    setSelectedCleaner(null);
    setSkipCleaner(false);
    setHomeownerSearch("");
    setPropertySearch("");
    setCleanerSearch("");
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

  const filteredProperties = properties.filter((p) => {
    const searchLower = propertySearch.toLowerCase();
    return (
      p.name.toLowerCase().includes(searchLower) ||
      p.address.toLowerCase().includes(searchLower) ||
      p.city.toLowerCase().includes(searchLower)
    );
  });

  const filteredCleaners = cleaners.filter((c) => {
    if (!c.user_profile) return false;
    const searchLower = cleanerSearch.toLowerCase();
    return (
      c.user_profile.first_name.toLowerCase().includes(searchLower) ||
      c.user_profile.last_name.toLowerCase().includes(searchLower)
    );
  });

  // Validation
  const isStep1Valid = selectedHomeowner && selectedProperty;
  const isStep2Valid = selectedServiceType && scheduledDate && scheduledTime;
  const isStep3Valid = selectedCleaner || skipCleaner;

  // Get today's date for min date validation
  const today = new Date().toISOString().split("T")[0];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[300] overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden animate-slide-up"
          onClick={(e) => e.stopPropagation()}
        >
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
                <Calendar className="w-6 h-6" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-center mb-2">
              New Appointment
            </h2>
            <p className="text-primary-100 text-center text-sm">
              Step {currentStep} of{" "}
              {preSelectedHomeownerId && preSelectedPropertyId
                ? 2
                : preSelectedHomeownerId
                ? 3
                : 3}
            </p>

            {/* Step indicator */}
            <div className="flex justify-center gap-2 mt-4">
              {preSelectedHomeownerId && preSelectedPropertyId ? (
                // 2 steps: appointment details, cleaner
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
                // 3 steps: homeowner/property OR property selection, appointment details, cleaner
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

            {/* Step 1: Select Homeowner & Property (skip if pre-selected) */}
            {currentStep === 1 &&
              !preSelectedHomeownerId &&
              !preSelectedPropertyId && (
                <div className="space-y-6">
                  {/* Homeowner Selection */}
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
                      <button
                        type="button"
                        className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Add New
                      </button>
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

                  {/* Property Selection */}
                  {selectedHomeowner && (
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900 mb-3">
                        Select Property
                      </h3>

                      <div className="flex gap-2 mb-4">
                        <div className="flex-1 relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                          <input
                            type="text"
                            placeholder="Search properties..."
                            value={propertySearch}
                            onChange={(e) => setPropertySearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          />
                        </div>
                        <button
                          type="button"
                          className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
                        >
                          <Plus className="w-4 h-4" />
                          Add New
                        </button>
                      </div>

                      {propertiesLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                        </div>
                      ) : filteredProperties.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                          No properties found for this homeowner
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto">
                          {filteredProperties.map((property) => (
                            <button
                              key={property.id}
                              type="button"
                              onClick={() => setSelectedProperty(property)}
                              className={`p-4 border-2 rounded-lg text-left transition-all ${
                                selectedProperty?.id === property.id
                                  ? "border-primary-500 bg-primary-50"
                                  : "border-gray-200 hover:border-gray-300"
                              }`}
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                    <Home className="w-5 h-5 text-blue-600" />
                                  </div>
                                  <div>
                                    <p className="font-medium text-gray-900">
                                      {property.name}
                                    </p>
                                    <p className="text-sm text-gray-600">
                                      {property.address}, {property.city}
                                    </p>
                                  </div>
                                </div>
                                {selectedProperty?.id === property.id && (
                                  <CheckCircle className="w-5 h-5 text-primary-600 flex-shrink-0" />
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            {/* Step 1: Select Property (when only homeowner is pre-selected) */}
            {currentStep === 1 &&
              preSelectedHomeownerId &&
              !preSelectedPropertyId && (
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">
                    Select Property
                  </h3>

                  <div className="flex gap-2 mb-4">
                    <div className="flex-1 relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                      <input
                        type="text"
                        placeholder="Search properties..."
                        value={propertySearch}
                        onChange={(e) => setPropertySearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <button
                      type="button"
                      className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add New
                    </button>
                  </div>

                  {propertiesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                    </div>
                  ) : filteredProperties.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      No properties found for this homeowner
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto">
                      {filteredProperties.map((property) => (
                        <button
                          key={property.id}
                          type="button"
                          onClick={() => setSelectedProperty(property)}
                          className={`p-4 border-2 rounded-lg text-left transition-all ${
                            selectedProperty?.id === property.id
                              ? "border-primary-500 bg-primary-50"
                              : "border-gray-200 hover:border-gray-300"
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                <Home className="w-5 h-5 text-blue-600" />
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">
                                  {property.name}
                                </p>
                                <p className="text-sm text-gray-600">
                                  {property.address}, {property.city}
                                </p>
                              </div>
                            </div>
                            {selectedProperty?.id === property.id && (
                              <CheckCircle className="w-5 h-5 text-primary-600 flex-shrink-0" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

            {/* Step 2: Appointment Details (or Step 1 when homeowner/property pre-selected) */}
            {((preSelectedHomeownerId &&
              preSelectedPropertyId &&
              currentStep === 1) ||
              (preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep === 2) ||
              (!preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep === 2)) && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Appointment Details
                </h3>

                {/* Service Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Service Type *
                  </label>
                  {serviceTypesLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
                    </div>
                  ) : (
                    <select
                      value={selectedServiceType?.id || ""}
                      onChange={(e) => {
                        const serviceType = serviceTypes.find(
                          (s) => s.id === e.target.value
                        );
                        setSelectedServiceType(serviceType || null);
                      }}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      required
                    >
                      <option value="">Select a service type</option>
                      {serviceTypes.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} - ${service.base_price} (
                          {service.duration_minutes} min)
                        </option>
                      ))}
                    </select>
                  )}
                  {selectedServiceType?.description && (
                    <p className="mt-2 text-sm text-gray-600">
                      {selectedServiceType.description}
                    </p>
                  )}
                </div>

                {/* Date and Time */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Scheduled Date *
                    </label>
                    <input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      min={today}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Scheduled Time *
                    </label>
                    <input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      required
                    />
                  </div>
                </div>

                {/* Special Requests */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Special Requests (Optional)
                  </label>
                  <textarea
                    value={specialRequests}
                    onChange={(e) => setSpecialRequests(e.target.value)}
                    rows={4}
                    placeholder="Any special instructions or requests for this appointment..."
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                  />
                </div>
              </div>
            )}

            {/* Step 3: Select Cleaner (or Step 2 when homeowner/property pre-selected) */}
            {((preSelectedHomeownerId &&
              preSelectedPropertyId &&
              currentStep === 2) ||
              (preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep === 3) ||
              (!preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep === 3)) && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-3">
                  Assign Cleaner
                </h3>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search cleaners..."
                    value={cleanerSearch}
                    onChange={(e) => setCleanerSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                </div>

                {cleanersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
                  </div>
                ) : filteredCleaners.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    No available cleaners found
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
                    {filteredCleaners.map((cleaner) => (
                      <button
                        key={cleaner.id}
                        type="button"
                        onClick={() => {
                          setSelectedCleaner(cleaner);
                          setSkipCleaner(false);
                        }}
                        disabled={skipCleaner}
                        className={`p-4 border-2 rounded-lg text-left transition-all ${
                          selectedCleaner?.id === cleaner.id
                            ? "border-primary-500 bg-primary-50"
                            : "border-gray-200 hover:border-gray-300"
                        } ${
                          skipCleaner ? "opacity-50 cursor-not-allowed" : ""
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                              <User className="w-5 h-5 text-green-600" />
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">
                                {cleaner.user_profile?.first_name}{" "}
                                {cleaner.user_profile?.last_name}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <div className="flex items-center">
                                  <Star className="w-4 h-4 text-yellow-400 fill-current" />
                                  <span className="text-sm text-gray-600 ml-1">
                                    {cleaner.rating.toFixed(1)}
                                  </span>
                                </div>
                                <span className="text-sm text-gray-600">
                                  • {cleaner.total_jobs} jobs
                                </span>
                              </div>
                            </div>
                          </div>
                          {selectedCleaner?.id === cleaner.id &&
                            !skipCleaner && (
                              <CheckCircle className="w-5 h-5 text-primary-600 flex-shrink-0" />
                            )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Skip for now option */}
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipCleaner}
                      onChange={(e) => {
                        setSkipCleaner(e.target.checked);
                        if (e.target.checked) {
                          setSelectedCleaner(null);
                        }
                      }}
                      className="w-5 h-5 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                    <div>
                      <p className="font-medium text-gray-900">Skip for now</p>
                      <p className="text-sm text-gray-600">
                        Assign a cleaner later
                      </p>
                    </div>
                  </label>
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

              {(preSelectedHomeownerId &&
                preSelectedPropertyId &&
                currentStep < 2) ||
              (preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep < 3) ||
              (!preSelectedHomeownerId &&
                !preSelectedPropertyId &&
                currentStep < 3) ? (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={Boolean(
                    // Step 1: Regular flow needs homeowner/property, homeowner-only flow needs property
                    (currentStep === 1 &&
                      !preSelectedHomeownerId &&
                      !preSelectedPropertyId &&
                      !isStep1Valid) ||
                      (currentStep === 1 &&
                        preSelectedHomeownerId &&
                        !preSelectedPropertyId &&
                        !isStep1Valid) ||
                      // Step 1: Both pre-selected flow needs appointment details
                      (currentStep === 1 &&
                        preSelectedHomeownerId &&
                        preSelectedPropertyId &&
                        !isStep2Valid) ||
                      // Step 2: Regular flow and homeowner-only flow need appointment details
                      (currentStep === 2 &&
                        !preSelectedHomeownerId &&
                        !preSelectedPropertyId &&
                        !isStep2Valid) ||
                      (currentStep === 2 &&
                        preSelectedHomeownerId &&
                        !preSelectedPropertyId &&
                        !isStep2Valid)
                  )}
                  className="px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreateAppointment}
                  disabled={!isStep3Valid || isCreating}
                  className="px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Appointment"
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
