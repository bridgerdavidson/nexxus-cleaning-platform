"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  Loader2,
  Building,
  Plus,
  CheckSquare,
  Square,
  Trash2,
  Home,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import PropertyCard, { PropertyCardData } from "./PropertyCard";
import PropertySidePanel from "./PropertySidePanel";
import DeleteConfirmModal from "./DeleteConfirmModal";
import BulkActionConfirmModal from "./BulkActionConfirmModal";
import AddPropertyModal from "./AddPropertyModal";
import {
  AdminProperty,
  deleteProperty,
  deleteProperties,
} from "../hooks/useAdminData";
import { useAuth } from "../hooks/useAuth";

interface PropertiesPageProps {
  properties: AdminProperty[];
  loading: boolean;
  error?: string | null;
  onRefreshProperties?: () => void;
  onPropertyUpdated?: (
    propertyId: string,
    updatedData: Partial<AdminProperty>
  ) => void;
  onRefreshAppointments?: () => void;
  role: "admin" | "manager";
}

export default function PropertiesPage({
  properties,
  loading,
  error,
  onRefreshProperties,
  onPropertyUpdated,
  onRefreshAppointments,
  role,
}: PropertiesPageProps) {
  const { currentOrganizationId } = useAuth();

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [homeownerFilter, setHomeownerFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [stateFilter, setStateFilter] = useState<string>("all");

  // Modal state
  const [showAddPropertyModal, setShowAddPropertyModal] = useState(false);
  const [selectedProperty, setSelectedProperty] =
    useState<PropertyCardData | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(false);

  // Delete modal state
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    propertyId: string | null;
    propertyName: string;
  }>({
    isOpen: false,
    propertyId: null,
    propertyName: "",
  });
  const [isDeleting, setIsDeleting] = useState(false);

  // Selection state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Filter properties
  const filteredProperties = useMemo(() => {
    let result = properties.map((p) => ({
      ...p,
      homeowner: p.homeowner,
    })) as PropertyCardData[];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((property) => {
        const propertyName = (property.name || "").toLowerCase();
        const fullAddress =
          `${property.address} ${property.city} ${property.state}`.toLowerCase();
        const homeownerName = property.homeowner
          ? `${property.homeowner.first_name} ${property.homeowner.last_name}`.toLowerCase()
          : "";
        const homeownerEmail = (property.homeowner?.email || "").toLowerCase();

        return (
          propertyName.includes(query) ||
          fullAddress.includes(query) ||
          homeownerName.includes(query) ||
          homeownerEmail.includes(query)
        );
      });
    }

    // Homeowner filter
    if (homeownerFilter !== "all") {
      result = result.filter(
        (property) => property.homeowner?.id === homeownerFilter
      );
    }

    // City filter
    if (cityFilter !== "all") {
      result = result.filter((property) => property.city === cityFilter);
    }

    // State filter
    if (stateFilter !== "all") {
      result = result.filter((property) => property.state === stateFilter);
    }

    return result;
  }, [properties, searchQuery, homeownerFilter, cityFilter, stateFilter]);

  // Get unique values for filters
  const uniqueHomeowners = useMemo(() => {
    const homeowners = properties
      .map((p) => p.homeowner)
      .filter((h) => h !== null) as Array<{
      id: string;
      first_name: string;
      last_name: string;
      email: string;
    }>;
    const unique = Array.from(
      new Map(homeowners.map((h) => [h.id, h])).values()
    );
    return unique.sort((a, b) =>
      `${a.first_name} ${a.last_name}`.localeCompare(
        `${b.first_name} ${b.last_name}`
      )
    );
  }, [properties]);

  const uniqueCities = useMemo(() => {
    const cities = Array.from(new Set(properties.map((p) => p.city))).sort();
    return cities;
  }, [properties]);

  const uniqueStates = useMemo(() => {
    const states = Array.from(new Set(properties.map((p) => p.state))).sort();
    return states;
  }, [properties]);

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
    if (selectedIds.size === filteredProperties.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProperties.map((p) => p.id)));
    }
  };

  const isAllSelected =
    filteredProperties.length > 0 &&
    selectedIds.size === filteredProperties.length;
  const isSomeSelected = selectedIds.size > 0 && !isAllSelected;

  // Delete handlers
  const handleDeleteClick = (
    property: PropertyCardData,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setDeleteConfirmModal({
      isOpen: true,
      propertyId: property.id,
      propertyName: property.name,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmModal.propertyId || !currentOrganizationId) return;

    setIsDeleting(true);
    const result = await deleteProperty(
      deleteConfirmModal.propertyId,
      currentOrganizationId
    );
    setIsDeleting(false);

    if (result.success) {
      setDeleteConfirmModal({
        isOpen: false,
        propertyId: null,
        propertyName: "",
      });
      if (onRefreshProperties) onRefreshProperties();
    } else {
      alert("Failed to delete property: " + result.error);
    }
  };

  const handleBulkDelete = () => {
    setShowBulkModal(true);
  };

  const confirmBulkDelete = async () => {
    if (!currentOrganizationId || selectedIds.size === 0) return;

    setIsBulkDeleting(true);
    const result = await deleteProperties(
      Array.from(selectedIds),
      currentOrganizationId
    );
    setIsBulkDeleting(false);

    if (result.success) {
      setShowBulkModal(false);
      setSelectedIds(new Set());
      setIsSelectMode(false);
      if (onRefreshProperties) onRefreshProperties();
    } else {
      alert("Failed to delete properties: " + result.error);
    }
  };

  // Property card click handler
  const handlePropertyClick = (property: PropertyCardData) => {
    if (isSelectMode) {
      toggleSelection(property.id);
    } else {
      setSelectedProperty(property);
      setShowSidePanel(true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-4xl font-bold text-gray-900">Properties</h2>
        <button
          onClick={() => setShowAddPropertyModal(true)}
          className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors whitespace-nowrap shadow-md"
        >
          <Plus className="w-5 h-5" />
          <span>New</span>
        </button>
      </div>

      {/* Search Input - Own line on mobile */}
      <div className="flex-1 relative md:hidden">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search by property name, address, homeowner name, or email..."
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
            placeholder="Search by property name, address, homeowner name, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
          />
        </div>

        {/* Filter Dropdowns */}
        {uniqueHomeowners.length > 0 && (
          <div className="relative flex-shrink-0 min-w-[140px]">
            <select
              value={homeownerFilter}
              onChange={(e) => setHomeownerFilter(e.target.value)}
              className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm appearance-none"
            >
              <option value="all">All Homeowners</option>
              {uniqueHomeowners.map((homeowner) => (
                <option key={homeowner.id} value={homeowner.id}>
                  {homeowner.first_name} {homeowner.last_name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}

        {uniqueCities.length > 0 && (
          <div className="relative flex-shrink-0 min-w-[140px]">
            <select
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm appearance-none"
            >
              <option value="all">All Cities</option>
              {uniqueCities.map((city) => (
                <option key={city} value={city}>
                  {city}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}

        {uniqueStates.length > 0 && (
          <div className="relative flex-shrink-0 min-w-[140px]">
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm appearance-none"
            >
              <option value="all">All States</option>
              {uniqueStates.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}

        {/* Select Many Button */}
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
                {selectedIds.size} property{selectedIds.size !== 1 ? "ies" : ""}{" "}
                selected
              </span>
            </div>

            {/* Bulk Actions */}
            {selectedIds.size > 0 && (
              <button
                onClick={handleBulkDelete}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                <Trash2 className="w-4 h-4" />
                Delete Selected
              </button>
            )}
          </div>
        </div>
      )}

      {/* Properties List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading properties...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Error loading properties
          </h3>
          <p className="text-gray-600">{error}</p>
        </div>
      ) : filteredProperties.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
          <Building className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchQuery ||
            homeownerFilter !== "all" ||
            cityFilter !== "all" ||
            stateFilter !== "all"
              ? "No properties found"
              : "No properties yet"}
          </h3>
          <p className="text-gray-600">
            {searchQuery ||
            homeownerFilter !== "all" ||
            cityFilter !== "all" ||
            stateFilter !== "all"
              ? "Try adjusting your search or filters"
              : "Create your first property to get started"}
          </p>
          {!searchQuery &&
            homeownerFilter === "all" &&
            cityFilter === "all" &&
            stateFilter === "all" && (
              <button
                onClick={() => setShowAddPropertyModal(true)}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
              >
                <Plus className="w-5 h-5" />
                Create Property
              </button>
            )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredProperties.map((property) => (
            <PropertyCard
              key={property.id}
              property={property}
              onClick={() => handlePropertyClick(property)}
              isSelectMode={isSelectMode}
              isSelected={selectedIds.has(property.id)}
              onToggleSelect={() => toggleSelection(property.id)}
              onDelete={(propertyId) => {
                const prop = filteredProperties.find(
                  (p) => p.id === propertyId
                );
                if (prop) {
                  handleDeleteClick(prop, {
                    stopPropagation: () => {},
                  } as React.MouseEvent);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* Side Panel */}
      <PropertySidePanel
        isOpen={showSidePanel}
        onClose={() => {
          setShowSidePanel(false);
          setSelectedProperty(null);
        }}
        property={selectedProperty}
        onPropertyUpdated={(updatedProperty) => {
          // Update selected property immediately for side panel display
          setSelectedProperty(updatedProperty);
          // Update the property in the parent list without refetch
          if (onPropertyUpdated) {
            onPropertyUpdated(updatedProperty.id, updatedProperty);
          } else if (onRefreshProperties) {
            // Fallback to full refresh if selective update not available
            onRefreshProperties();
          }
          // Only refresh appointments if address changed (appointments show property address)
          const addressChanged =
            selectedProperty &&
            (selectedProperty.address !== updatedProperty.address ||
              selectedProperty.city !== updatedProperty.city ||
              selectedProperty.state !== updatedProperty.state);
          if (addressChanged && onRefreshAppointments) {
            onRefreshAppointments();
          }
        }}
        onRefreshAppointments={onRefreshAppointments}
        role={role}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={deleteConfirmModal.isOpen}
        onClose={() =>
          setDeleteConfirmModal({
            isOpen: false,
            propertyId: null,
            propertyName: "",
          })
        }
        onConfirm={handleDeleteConfirm}
        title="Delete Property"
        message="Are you sure you want to delete this property? This action cannot be undone and will also delete all associated appointments."
        itemName={deleteConfirmModal.propertyName}
        isLoading={isDeleting}
      />

      {/* Bulk Delete Modal */}
      <BulkActionConfirmModal
        isOpen={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        onConfirm={confirmBulkDelete}
        count={selectedIds.size}
        action="delete"
        isLoading={isBulkDeleting}
      />

      {/* Add Property Modal */}
      <AddPropertyModal
        isOpen={showAddPropertyModal}
        onClose={() => setShowAddPropertyModal(false)}
        onPropertyCreated={() => {
          // Refresh properties and appointments (appointments might show property info)
          if (onRefreshProperties) {
            onRefreshProperties();
          }
          if (onRefreshAppointments) {
            onRefreshAppointments();
          }
        }}
      />
    </div>
  );
}
