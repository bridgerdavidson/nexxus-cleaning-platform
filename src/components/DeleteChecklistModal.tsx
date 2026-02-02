"use client";

import React, { useState } from "react";
import { X, Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { Checklist, deleteChecklist } from "../hooks/useChecklists";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

interface DeleteChecklistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  checklist: Checklist | null;
  itemCount?: number; // Optional: show count of items that will be deleted
}

export default function DeleteChecklistModal({
  isOpen,
  onClose,
  onSuccess,
  checklist,
  itemCount = 0,
}: DeleteChecklistModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!checklist) return;

    setLoading(true);
    setError(null);

    try {
      const result = await deleteChecklist(checklist.id);
      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.error || "Failed to delete checklist");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete checklist");
    } finally {
      setLoading(false);
    }
  };

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  if (!isOpen || !checklist) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
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
              Delete Checklist
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
          <p className="text-gray-600 mb-4">
            Are you sure you want to delete{" "}
            <span className="font-semibold text-gray-900">
              {checklist.name}
            </span>
            ?
          </p>

          {/* Warning about items being deleted */}
          {itemCount > 0 && (
            <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg mb-4">
              <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-yellow-800">
                  This will also delete{" "}
                  <span className="font-semibold">
                    {itemCount} item{itemCount !== 1 ? "s" : ""}
                  </span>{" "}
                  in this checklist.
                </p>
              </div>
            </div>
          )}

          <p className="text-sm text-gray-500">
            This action cannot be undone.
          </p>

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
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="px-4 py-2.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            disabled={loading}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Delete Checklist
          </button>
        </div>
      </div>
    </div>
  );
}
