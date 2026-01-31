"use client";

import React, { useState, useEffect } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import {
  ServiceType,
  CreateServiceData,
  createService,
  updateService,
} from "../hooks/useServices";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

interface ServiceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  service?: ServiceType | null; // If provided, we're editing
}

// Common service type suggestions
const SERVICE_TYPE_SUGGESTIONS = [
  "regular",
  "deep",
  "move_out",
  "move_in",
  "custom",
  "one_time",
  "recurring",
  "seasonal",
  "office",
  "commercial",
];

export default function ServiceFormModal({
  isOpen,
  onClose,
  onSuccess,
  service,
}: ServiceFormModalProps) {
  const { currentOrganizationId } = useAuth();
  const isEditing = !!service;

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [serviceType, setServiceType] = useState("");
  const [isActive, setIsActive] = useState(true);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Reset form when modal opens/closes or service changes
  useEffect(() => {
    if (isOpen) {
      if (service) {
        setName(service.name);
        setDescription(service.description || "");
        setBasePrice(service.base_price.toString());
        setDurationMinutes(service.duration_minutes.toString());
        setServiceType(service.service_type);
        setIsActive(service.is_active);
      } else {
        setName("");
        setDescription("");
        setBasePrice("");
        setDurationMinutes("");
        setServiceType("");
        setIsActive(true);
      }
      setError(null);
    }
  }, [isOpen, service]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentOrganizationId) {
      setError("Organization not found");
      return;
    }

    // Validate
    if (!name.trim()) {
      setError("Service name is required");
      return;
    }

    if (!basePrice || isNaN(parseFloat(basePrice)) || parseFloat(basePrice) < 0) {
      setError("Valid base price is required");
      return;
    }

    if (
      !durationMinutes ||
      isNaN(parseInt(durationMinutes)) ||
      parseInt(durationMinutes) <= 0
    ) {
      setError("Valid duration is required");
      return;
    }

    if (!serviceType.trim()) {
      setError("Service type is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data: CreateServiceData = {
        name: name.trim(),
        description: description.trim() || null,
        base_price: parseFloat(basePrice),
        duration_minutes: parseInt(durationMinutes),
        service_type: serviceType.trim().toLowerCase().replace(/\s+/g, "_"),
        is_active: isActive,
      };

      let result;
      if (isEditing && service) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/7c24847b-d529-420b-a9fe-f2c30df00549', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'ServiceFormModal.tsx:handleSubmit:beforeUpdate', message: 'edit submit', data: { serviceId: service.id, serviceOrgId: service.organization_id, currentOrganizationId: currentOrganizationId ?? null, orgMatch: currentOrganizationId === service.organization_id }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'B' }) }).catch(() => {});
        // #endregion
        result = await updateService(service.id, data, currentOrganizationId ?? undefined);
      } else {
        result = await createService(currentOrganizationId, data);
      }

      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.error || "Failed to save service");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save service");
    } finally {
      setLoading(false);
    }
  };

  const handleServiceTypeSelect = (type: string) => {
    setServiceType(type);
    setShowSuggestions(false);
  };

  const filteredSuggestions = SERVICE_TYPE_SUGGESTIONS.filter((type) =>
    type.toLowerCase().includes(serviceType.toLowerCase())
  );

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto modal-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEditing ? "Edit Service" : "Add New Service"}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Error message */}
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* Name */}
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Service Name *
            </label>
            <input
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
              placeholder="e.g., Deep Cleaning"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors resize-none"
              placeholder="Describe what this service includes..."
              rows={3}
            />
          </div>

          {/* Base Price and Duration */}
          <div className="grid grid-cols-2 gap-4">
            {/* Base Price */}
            <div>
              <label
                htmlFor="basePrice"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Base Price ($) *
              </label>
              <input
                type="number"
                id="basePrice"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                placeholder="0.00"
                min="0"
                step="0.01"
                required
              />
            </div>

            {/* Duration */}
            <div>
              <label
                htmlFor="duration"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Duration (minutes) *
              </label>
              <input
                type="number"
                id="duration"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                placeholder="120"
                min="1"
                step="1"
                required
              />
            </div>
          </div>

          {/* Service Type */}
          <div className="relative">
            <label
              htmlFor="serviceType"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Service Type *
            </label>
            <input
              type="text"
              id="serviceType"
              value={serviceType}
              onChange={(e) => {
                setServiceType(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => {
                // Delay to allow click on suggestion
                setTimeout(() => setShowSuggestions(false), 200);
              }}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
              placeholder="e.g., regular, deep, move_out"
              required
            />
            {/* Suggestions dropdown */}
            {showSuggestions && filteredSuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {filteredSuggestions.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    onMouseDown={() => handleServiceTypeSelect(type)}
                  >
                    {type.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-xs text-gray-500">
              Enter a category for this service (e.g., regular, deep, move_out)
            </p>
          </div>

          {/* Is Active */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700">
              Service is active and available for booking
            </label>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              disabled={loading}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Add Service"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
