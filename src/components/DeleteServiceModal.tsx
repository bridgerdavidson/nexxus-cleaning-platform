"use client";

import React, { useState, useEffect } from "react";
import { X, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import {
  ServiceType,
  deleteService,
  canDeleteService,
} from "../hooks/useServices";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

interface DeleteServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  service: ServiceType | null;
}

export default function DeleteServiceModal({
  isOpen,
  onClose,
  onSuccess,
  service,
}: DeleteServiceModalProps) {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [canDelete, setCanDelete] = useState(false);
  const [appointmentCount, setAppointmentCount] = useState(0);
  const [seriesCount, setSeriesCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Check if service can be deleted when modal opens
  useEffect(() => {
    if (isOpen && service) {
      setChecking(true);
      setError(null);
      canDeleteService(service.id).then((result) => {
        setCanDelete(result.canDelete);
        setAppointmentCount(result.appointmentCount);
        setSeriesCount(result.seriesCount);
        setChecking(false);
      });
    }
  }, [isOpen, service]);

  const handleDelete = async () => {
    if (!service) return;

    setLoading(true);
    setError(null);

    try {
      const result = await deleteService(service.id);
      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.error || "Failed to delete service");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete service");
    } finally {
      setLoading(false);
    }
  };

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  if (!isOpen || !service) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
              <Trash2 className="w-5 h-5 text-red-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">
              Delete Service
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {checking ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-600">Checking...</span>
            </div>
          ) : canDelete ? (
            <>
              <p className="text-gray-600 mb-4">
                Are you sure you want to delete{" "}
                <span className="font-semibold text-gray-900">
                  {service.name}
                </span>
                ? This action cannot be undone.
              </p>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-yellow-800">
                    Cannot delete this service
                  </p>
                  <p className="text-sm text-yellow-700 mt-1">
                    This service is currently being used:
                  </p>
                  <ul className="text-sm text-yellow-700 mt-2 list-disc list-inside">
                    {appointmentCount > 0 && (
                      <li>
                        {appointmentCount} appointment
                        {appointmentCount !== 1 ? "s" : ""}
                      </li>
                    )}
                    {seriesCount > 0 && (
                      <li>
                        {seriesCount} recurring series
                        {seriesCount !== 1 ? "" : ""}
                      </li>
                    )}
                  </ul>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                Consider disabling this service instead of deleting it. Disabled
                services are hidden from new bookings but preserved for historical
                records.
              </p>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mt-4 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            disabled={loading}
          >
            {canDelete ? "Cancel" : "Close"}
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              className="px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              disabled={loading}
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Delete Service
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
