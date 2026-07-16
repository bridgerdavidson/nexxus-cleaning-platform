"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  ClipboardList,
} from "lucide-react";
import {
  ServiceType,
  CreateServiceData,
  createService,
  updateService,
} from "../hooks/useServices";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { supabase } from "../lib/supabase";

export const SERVICE_UPDATE_PERMISSION_ERROR =
  "Service not found or you don't have permission to update it.";

export type ServiceUpdateDiagnostic = {
  userId: string | null;
  memberships: Array<{ organization_id: string; role: string }>;
  serviceRow: { id: string; organization_id: string } | null;
  selectError: string | null;
  currentOrganizationId: string | null;
};

interface ServiceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  // On create, receives the newly created service so the parent can route into
  // checklist setup. On edit, called with no argument.
  onSuccess: (created?: ServiceType) => void;
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
  const [diagnostic, setDiagnostic] = useState<ServiceUpdateDiagnostic | null>(
    null,
  );
  const [showDebug, setShowDebug] = useState(false);

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
      setDiagnostic(null);
      setShowDebug(false);
    }
  }, [isOpen, service]);

  async function runServiceUpdateDiagnostic(
    serviceId: string,
    currentOrgId: string | null,
  ): Promise<ServiceUpdateDiagnostic> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const userId = user?.id ?? null;

    let memberships: Array<{ organization_id: string; role: string }> = [];
    if (userId) {
      const { data: rows } = await supabase
        .from("organization_members")
        .select("organization_id, role")
        .eq("user_id", userId);
      memberships = rows ?? [];
    }

    const { data: serviceRow, error: selectError } = await supabase
      .from("service_types")
      .select("id, organization_id")
      .eq("id", serviceId)
      .maybeSingle();

    return {
      userId,
      memberships,
      serviceRow: serviceRow ?? null,
      selectError: selectError?.message ?? null,
      currentOrganizationId: currentOrgId,
    };
  }

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

    if (
      !basePrice ||
      isNaN(parseFloat(basePrice)) ||
      parseFloat(basePrice) < 0
    ) {
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
        result = await updateService(
          service.id,
          data,
          currentOrganizationId ?? undefined,
        );
      } else {
        result = await createService(currentOrganizationId, data);
      }

      if (result.success) {
        // On create, hand the new service back so the parent can route into
        // checklist setup. On edit, there's nothing to set up.
        onSuccess(isEditing ? undefined : result.data);
        onClose();
      } else {
        const errMsg = result.error || "Failed to save service";
        setError(errMsg);
        if (
          isEditing &&
          service &&
          (errMsg === SERVICE_UPDATE_PERMISSION_ERROR ||
            errMsg.includes("permission"))
        ) {
          setDiagnostic(null);
          runServiceUpdateDiagnostic(
            service.id,
            currentOrganizationId ?? null,
          ).then(setDiagnostic);
        }
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
    type.toLowerCase().includes(serviceType.toLowerCase()),
  );

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

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
            <div className="space-y-2">
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
              {diagnostic && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowDebug((d) => !d)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100"
                  >
                    Debug: why did this fail?
                    {showDebug ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>
                  {showDebug && (
                    <div className="p-4 bg-gray-50 border-t border-gray-200 space-y-3 text-sm">
                      <p className="text-gray-600">
                        RLS allows update only if you have role
                        owner/admin/manager in the service&apos;s organization.
                        Run the SQL in{" "}
                        <code className="bg-gray-200 px-1 rounded">
                          docs/debug-service-update-rls.sql
                        </code>{" "}
                        in Supabase SQL Editor with the IDs below to verify.
                      </p>
                      <pre className="p-3 bg-white border border-gray-200 rounded overflow-x-auto text-xs text-gray-800 whitespace-pre-wrap">
                        {JSON.stringify(diagnostic, null, 2)}
                      </pre>
                      <div className="flex flex-wrap gap-2">
                        <span className="font-medium text-gray-700">
                          Checks:
                        </span>
                        {!diagnostic.userId && (
                          <span className="text-amber-700">
                            No user session (auth.uid() is null)
                          </span>
                        )}
                        {diagnostic.userId &&
                          diagnostic.memberships.length === 0 && (
                            <span className="text-amber-700">
                              No organization_members rows for this user
                            </span>
                          )}
                        {diagnostic.serviceRow === null && (
                          <span className="text-amber-700">
                            Cannot read service row (SELECT blocked by RLS?)
                          </span>
                        )}
                        {diagnostic.serviceRow &&
                          diagnostic.currentOrganizationId &&
                          diagnostic.serviceRow.organization_id !==
                            diagnostic.currentOrganizationId && (
                            <span className="text-amber-700">
                              Service org_id does not match current org
                            </span>
                          )}
                        {diagnostic.serviceRow &&
                          diagnostic.memberships.length > 0 &&
                          !diagnostic.memberships.some(
                            (m) =>
                              m.organization_id ===
                                diagnostic.serviceRow?.organization_id &&
                              ["owner", "admin", "manager"].includes(m.role),
                          ) && (
                            <span className="text-amber-700">
                              No membership with role owner/admin/manager for
                              service&apos;s org (role is case-sensitive)
                            </span>
                          )}
                        {diagnostic.serviceRow &&
                          diagnostic.memberships.some(
                            (m) =>
                              m.organization_id ===
                                diagnostic.serviceRow?.organization_id &&
                              ["owner", "admin", "manager"].includes(m.role),
                          ) && (
                            <span className="text-green-700">
                              Membership looks OK. Check auth.uid() in Supabase
                              or run SQL script
                            </span>
                          )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const text = JSON.stringify(diagnostic, null, 2);
                          void navigator.clipboard.writeText(text);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copy debug info
                      </button>
                    </div>
                  )}
                </div>
              )}
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

          {/* Checklist heads-up (create only) */}
          {!isEditing && (
            <div className="flex items-start gap-2.5 rounded-lg border border-primary-200 bg-primary-50/60 p-3">
              <ClipboardList
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-600"
                aria-hidden="true"
              />
              <p className="text-xs text-secondary-600">
                Next, you&apos;ll set up this service&apos;s{" "}
                <span className="font-semibold text-secondary-900">checklist</span>: the steps
                your cleaners follow. We&apos;ll start you with a default one; you can edit it or
                add more checklists (like a deep clean) that add to the price.
              </p>
            </div>
          )}

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
