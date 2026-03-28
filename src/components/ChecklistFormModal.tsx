"use client";

import React, { useState, useEffect } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import {
  Checklist,
  ChecklistWithItems,
  createChecklist,
  updateChecklist,
} from "../hooks/useChecklists";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

type ChecklistFormResult = 
  | { type: 'created'; checklist: ChecklistWithItems }
  | { type: 'updated'; checklistId: string; name: string; priceAdder: number };

interface ChecklistFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: ChecklistFormResult) => void;
  checklist?: Checklist | null; // If provided, we're editing
  serviceTypeId?: string; // Required for creating new checklist
}

export default function ChecklistFormModal({
  isOpen,
  onClose,
  onSuccess,
  checklist,
  serviceTypeId,
}: ChecklistFormModalProps) {
  const isEditing = !!checklist;

  // Form state
  const [name, setName] = useState("");
  const [priceAdder, setPriceAdder] = useState("0");

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens/closes or checklist changes
  useEffect(() => {
    if (isOpen) {
      if (checklist) {
        setName(checklist.name);
        setPriceAdder((checklist.price_adder ?? 0).toString());
      } else {
        setName("");
        setPriceAdder("0");
      }
      setError(null);
    }
  }, [isOpen, checklist]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    if (!name.trim()) {
      setError("Checklist name is required");
      return;
    }

    if (!isEditing && !serviceTypeId) {
      setError("Service type ID is required to create a checklist");
      return;
    }

    const parsedPriceAdder = parseFloat(priceAdder || "0");
    if (Number.isNaN(parsedPriceAdder) || parsedPriceAdder < 0) {
      setError("Price adder must be 0 or greater");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      if (isEditing && checklist) {
        const result = await updateChecklist(checklist.id, name.trim(), parsedPriceAdder);
        if (result.success) {
          onSuccess({ type: 'updated', checklistId: checklist.id, name: name.trim(), priceAdder: parsedPriceAdder });
          onClose();
        } else {
          setError(result.error || "Failed to update checklist");
        }
      } else {
        const result = await createChecklist(serviceTypeId!, name.trim(), parsedPriceAdder);
        if (result.success && result.data) {
          // Convert Checklist to ChecklistWithItems with empty items array
          const checklistWithItems: ChecklistWithItems = {
            ...result.data,
            checklist_line_items: [],
          };
          onSuccess({ type: 'created', checklist: checklistWithItems });
          onClose();
        } else {
          setError(result.error || "Failed to create checklist");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save checklist");
    } finally {
      setLoading(false);
    }
  };

  // Lock body scroll when modal is open
  useBodyScrollLock(isOpen);

  if (!isOpen) return null;

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
          <h2 className="text-xl font-semibold text-gray-900">
            {isEditing ? "Edit Checklist" : "Add New Checklist"}
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
              htmlFor="checklist-name"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Checklist Name *
            </label>
            <input
              type="text"
              id="checklist-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
              placeholder="e.g., Kitchen Checklist"
              autoFocus
              required
            />
          </div>

          {/* Price adder */}
          <div>
            <label
              htmlFor="checklist-price-adder"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Price Adder ($)
            </label>
            <input
              type="number"
              id="checklist-price-adder"
              value={priceAdder}
              onChange={(e) => setPriceAdder(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
              placeholder="0.00"
              min="0"
              step="0.01"
            />
            <p className="mt-1 text-xs text-gray-500">
              Added to the service base price when this checklist is selected.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-gray-700 font-medium hover:bg-gray-100 rounded-lg transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEditing ? "Save Changes" : "Create Checklist"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
