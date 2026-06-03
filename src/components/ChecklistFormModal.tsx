"use client";

import React, { useState, useEffect, useMemo } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import {
  Checklist,
  ChecklistWithItems,
  createChecklist,
  updateChecklist,
} from "../hooks/useChecklists";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useDismissGuard } from "../hooks/useDismissGuard";
import { useFormDraft } from "../hooks/useFormDraft";
import { createDraftStore } from "@/lib/formDraft";
import DiscardChangesDialog from "./DiscardChangesDialog";

type ChecklistFormResult =
  | { type: "created"; checklist: ChecklistWithItems }
  | { type: "updated"; checklistId: string; name: string; priceAdder: number };

interface ChecklistFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (result: ChecklistFormResult) => void;
  checklist?: Checklist | null; // If provided, we're editing
  serviceTypeId?: string; // Required for creating new checklist
}

// --- Reload-restore draft -----------------------------------------------------------
// The CREATE-mode form's in-progress state, persisted to sessionStorage so a full page reload
// (or an accidental navigation and return) restores it. The owning serviceTypeId is stored so a
// restored draft only re-applies under the same service type. A 6h TTL + org check (in the
// store) keep a draft from resurrecting stale or across tenants. Zero server/database cost.
// EDIT mode (a `checklist` prop is present) is never persisted or restored.
interface ChecklistDraftBody {
  name: string;
  priceAdder: string;
  serviceTypeId: string | null;
}

const INITIAL_CHECKLIST_DRAFT: ChecklistDraftBody = {
  name: "",
  priceAdder: "0",
  serviceTypeId: null,
};

const checklistDraftStore = createDraftStore<ChecklistDraftBody>({
  key: "nexxus.checklistDraft.v1",
  version: 1,
  initial: INITIAL_CHECKLIST_DRAFT,
});

export default function ChecklistFormModal({
  isOpen,
  onClose,
  onSuccess,
  checklist,
  serviceTypeId,
}: ChecklistFormModalProps) {
  const isEditing = !!checklist;
  const { currentOrganizationId } = useAuth();

  // Form state
  const [name, setName] = useState("");
  const [priceAdder, setPriceAdder] = useState("0");

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Reload-restore wiring --------------------------------------------------------
  // Only the CREATE flow (no `checklist` prop) persists/restores. Edit launches are excluded
  // so an existing checklist's values are never written to the draft or resurrected on reload.
  const persistEligible = !checklist;

  // Tag the draft with its service type only once the user has entered something; a pristine
  // blank create form then equals INITIAL_CHECKLIST_DRAFT and never persists.
  const draftBody = useMemo<ChecklistDraftBody>(() => {
    const pristine = name === "" && priceAdder === "0";
    return {
      name,
      priceAdder,
      serviceTypeId: pristine ? null : serviceTypeId ?? null,
    };
  }, [name, priceAdder, serviceTypeId]);

  useFormDraft({
    store: checklistDraftStore,
    orgId: currentOrganizationId,
    isOpen,
    eligible: persistEligible,
    body: draftBody,
  });

  // Reset form when modal opens/closes or checklist changes. In CREATE mode the blank seed is
  // replaced by a saved draft (folded in here so there is no race with a separate hydration
  // effect), but only when the draft was saved under the same service type. EDIT mode (a
  // `checklist` prop) seeds from the checklist exactly as before and never reads the draft.
  useEffect(() => {
    if (isOpen) {
      if (checklist) {
        setName(checklist.name);
        setPriceAdder((checklist.price_adder ?? 0).toString());
      } else {
        const draft = currentOrganizationId
          ? checklistDraftStore.load(currentOrganizationId)
          : null;
        if (draft && draft.serviceTypeId === (serviceTypeId ?? null)) {
          setName(draft.name);
          setPriceAdder(draft.priceAdder);
        } else {
          setName("");
          setPriceAdder("0");
        }
      }
      setError(null);
    }
  }, [isOpen, checklist, currentOrganizationId, serviceTypeId]);

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
        const result = await updateChecklist(
          checklist.id,
          name.trim(),
          parsedPriceAdder,
        );
        if (result.success) {
          onSuccess({
            type: "updated",
            checklistId: checklist.id,
            name: name.trim(),
            priceAdder: parsedPriceAdder,
          });
          onClose();
        } else {
          setError(result.error || "Failed to update checklist");
        }
      } else {
        const result = await createChecklist(
          serviceTypeId!,
          name.trim(),
          parsedPriceAdder,
        );
        if (result.success && result.data) {
          // Create succeeded: drop the saved draft so a later reload starts clean.
          checklistDraftStore.clear();
          // Convert Checklist to ChecklistWithItems with empty items array
          const checklistWithItems: ChecklistWithItems = {
            ...result.data,
            checklist_line_items: [],
          };
          onSuccess({ type: "created", checklist: checklistWithItems });
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

  // Reset form state and close
  const handleClose = () => {
    // A deliberate close drops the saved draft (it only exists to survive a reload).
    checklistDraftStore.clear();
    setName("");
    setPriceAdder("0");
    setError(null);
    onClose();
  };

  const isDirty =
    name !== (checklist?.name ?? "") ||
    priceAdder !== (checklist?.price_adder ?? 0).toString();
  const guard = useDismissGuard({
    isOpen,
    isDirty,
    isSubmitting: loading,
    onConfirmClose: handleClose,
  });

  if (!isOpen) return null;

  return (
    <>
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" onClick={guard.requestClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEditing ? "Edit Checklist" : "Add New Checklist"}
          </h2>
          <button
            onClick={guard.requestClose}
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
              onClick={guard.requestClose}
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
    <DiscardChangesDialog
      isOpen={guard.confirmOpen}
      onConfirm={guard.confirmDiscard}
      onCancel={guard.cancelDiscard}
      zIndexClassName="z-[80]"
    />
    </>
  );
}
