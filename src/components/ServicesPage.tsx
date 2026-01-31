"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  ChevronDown,
  Plus,
  Loader2,
  Briefcase,
  AlertCircle,
} from "lucide-react";
import { ServiceType, toggleServiceActive } from "../hooks/useServices";
import ServiceCard from "./ServiceCard";
import ServiceFormModal from "./ServiceFormModal";
import DeleteServiceModal from "./DeleteServiceModal";
import ServiceDetailView from "./ServiceDetailView";

interface ServicesPageProps {
  services: ServiceType[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  canManageServices: boolean;
  updateServiceInState?: (serviceId: string, patch: Partial<ServiceType>) => void;
}

type StatusFilter = "active" | "all" | "disabled";

export default function ServicesPage({
  services,
  loading,
  error,
  refetch,
  canManageServices,
  updateServiceInState,
}: ServicesPageProps) {

  // Filter and search state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  // Modal state
  const [showFormModal, setShowFormModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceType | null>(null);

  // Detail view state
  const [viewingService, setViewingService] = useState<ServiceType | null>(null);

  // Toggle active loading state
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  // Toggle error state
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Filter services
  const filteredServices = useMemo(() => {
    let filtered = [...services];

    // Apply status filter
    if (statusFilter === "active") {
      filtered = filtered.filter((s) => s.is_active);
    } else if (statusFilter === "disabled") {
      filtered = filtered.filter((s) => !s.is_active);
    }

    // Apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query) ||
          s.service_type.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [services, statusFilter, searchQuery]);

  // Handle edit
  const handleEdit = (service: ServiceType) => {
    setSelectedService(service);
    setShowFormModal(true);
  };

  // Handle delete
  const handleDelete = (service: ServiceType) => {
    setSelectedService(service);
    setShowDeleteModal(true);
  };

  // Handle toggle active (optimistic update with rollback)
  const handleToggleActive = async (service: ServiceType) => {
    const newIsActive = !service.is_active;
    const previousIsActive = service.is_active;

    // Clear any previous toggle error
    setToggleError(null);

    // Track that we're toggling this service
    setTogglingIds((prev) => new Set(prev).add(service.id));

    // Optimistic update: immediately update UI
    if (updateServiceInState) {
      updateServiceInState(service.id, { is_active: newIsActive });
    }

    try {
      const result = await toggleServiceActive(service.id, newIsActive, service.organization_id);
      if (!result.success) {
        // Rollback on failure
        if (updateServiceInState) {
          updateServiceInState(service.id, { is_active: previousIsActive });
        }
        setToggleError(result.error || 'Failed to update service status');
      }
    } catch {
      // Rollback on unexpected error
      if (updateServiceInState) {
        updateServiceInState(service.id, { is_active: previousIsActive });
      }
      setToggleError('Failed to update service status');
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(service.id);
        return next;
      });
    }
  };

  // Handle add new
  const handleAddNew = () => {
    setSelectedService(null);
    setShowFormModal(true);
  };

  // Handle form success
  const handleFormSuccess = () => {
    refetch();
  };

  // Handle delete success
  const handleDeleteSuccess = () => {
    refetch();
    setViewingService(null);
  };

  // Handle view service details
  const handleViewService = (service: ServiceType) => {
    setViewingService(service);
  };

  // Handle back to list
  const handleBackToList = () => {
    setViewingService(null);
  };

  // Handle toggle from detail view (optimistic update with rollback)
  const handleToggleActiveFromDetail = async (service: ServiceType) => {
    const newIsActive = !service.is_active;
    const previousIsActive = service.is_active;

    // Clear any previous toggle error
    setToggleError(null);

    // Track that we're toggling this service
    setTogglingIds((prev) => new Set(prev).add(service.id));

    // Optimistic update: immediately update both the list and detail view
    if (updateServiceInState) {
      updateServiceInState(service.id, { is_active: newIsActive });
    }
    setViewingService((prev) =>
      prev && prev.id === service.id
        ? { ...prev, is_active: newIsActive }
        : prev
    );

    try {
      const result = await toggleServiceActive(service.id, newIsActive, service.organization_id);
      if (!result.success) {
        // Rollback on failure
        if (updateServiceInState) {
          updateServiceInState(service.id, { is_active: previousIsActive });
        }
        setViewingService((prev) =>
          prev && prev.id === service.id
            ? { ...prev, is_active: previousIsActive }
            : prev
        );
        setToggleError(result.error || 'Failed to update service status');
      }
    } catch {
      // Rollback on unexpected error
      if (updateServiceInState) {
        updateServiceInState(service.id, { is_active: previousIsActive });
      }
      setViewingService((prev) =>
        prev && prev.id === service.id
          ? { ...prev, is_active: previousIsActive }
          : prev
      );
      setToggleError('Failed to update service status');
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(service.id);
        return next;
      });
    }
  };

  // Handle edit from detail view
  const handleEditFromDetail = (service: ServiceType) => {
    setSelectedService(service);
    setShowFormModal(true);
  };

  // Handle delete from detail view
  const handleDeleteFromDetail = (service: ServiceType) => {
    setSelectedService(service);
    setShowDeleteModal(true);
  };

  // Handle form success - also update viewing service if it was edited
  const handleFormSuccessWithUpdate = () => {
    refetch();
    // We'll update the viewing service after refetch completes
    // For now, just close the modal - the service list will refresh
  };

  // If viewing a service, show the detail view
  if (viewingService) {
    // Find the latest version of this service from the services array
    const latestService = services.find((s) => s.id === viewingService.id) || viewingService;
    
    return (
      <>
        <ServiceDetailView
          service={latestService}
          canManage={canManageServices && !togglingIds.has(latestService.id)}
          onBack={handleBackToList}
          onEdit={handleEditFromDetail}
          onDelete={handleDeleteFromDetail}
          onToggleActive={handleToggleActiveFromDetail}
        />

        {/* Service Form Modal */}
        <ServiceFormModal
          isOpen={showFormModal}
          onClose={() => {
            setShowFormModal(false);
            setSelectedService(null);
          }}
          onSuccess={handleFormSuccessWithUpdate}
          service={selectedService}
        />

        {/* Delete Service Modal */}
        <DeleteServiceModal
          isOpen={showDeleteModal}
          onClose={() => {
            setShowDeleteModal(false);
            setSelectedService(null);
          }}
          onSuccess={handleDeleteSuccess}
          service={selectedService}
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toggle Error Banner */}
      {toggleError && (
        <div className="flex items-center justify-between gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">{toggleError}</span>
          </div>
          <button
            onClick={() => setToggleError(null)}
            className="text-red-500 hover:text-red-700 text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-4xl font-bold text-gray-900">Services</h2>
        {canManageServices && (
          <button
            onClick={handleAddNew}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors whitespace-nowrap shadow-md"
          >
            <Plus className="w-5 h-5" />
            <span>Add Service</span>
          </button>
        )}
      </div>

      {/* Search Input - Mobile */}
      <div className="flex-1 relative md:hidden">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search by name, type, or description..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
        />
      </div>

      {/* Filters Row */}
      <div className="flex flex-row gap-3 overflow-x-auto">
        {/* Search Input - Desktop */}
        <div className="hidden md:flex flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by name, type, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
          />
        </div>

        {/* Status Filter Dropdown */}
        <div className="relative flex-shrink-0 min-w-[140px]">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm appearance-none"
          >
            <option value="active">Active</option>
            <option value="all">All</option>
            <option value="disabled">Disabled</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading services...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Failed to load services
          </h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={refetch}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="text-center py-12">
          <Briefcase className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {services.length === 0 ? "No services yet" : "No services found"}
          </h3>
          <p className="text-gray-600 mb-4">
            {services.length === 0
              ? canManageServices
                ? "Add your first service to get started."
                : "No services have been added yet."
              : "Try adjusting your search or filter."}
          </p>
          {canManageServices && services.length === 0 && (
            <button
              onClick={handleAddNew}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              Add Service
            </button>
          )}
        </div>
      ) : (
        /* Card Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredServices.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              canManage={canManageServices && !togglingIds.has(service.id)}
              onClick={handleViewService}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleActive={handleToggleActive}
            />
          ))}
        </div>
      )}

      {/* Service Form Modal */}
      <ServiceFormModal
        isOpen={showFormModal}
        onClose={() => {
          setShowFormModal(false);
          setSelectedService(null);
        }}
        onSuccess={handleFormSuccess}
        service={selectedService}
      />

      {/* Delete Service Modal */}
      <DeleteServiceModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedService(null);
        }}
        onSuccess={handleDeleteSuccess}
        service={selectedService}
      />
    </div>
  );
}
