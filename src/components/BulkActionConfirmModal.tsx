import React from "react";
import { AlertTriangle, Trash2, XCircle } from "lucide-react";

interface BulkActionConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  count: number;
  action: "cancel" | "delete";
  isLoading?: boolean;
}

export default function BulkActionConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  count,
  action,
  isLoading = false,
}: BulkActionConfirmModalProps) {
  if (!isOpen) return null;

  const actionText = action === "cancel" ? "Cancel" : "Delete";
  const actionIcon = action === "cancel" ? XCircle : Trash2;
  const ActionIcon = actionIcon;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-orange-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {actionText} {count} Appointment{count !== 1 ? "s" : ""}
              </h2>
              <p className="text-sm text-gray-600">
                This action cannot be undone
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-gray-700 mb-6">
            {action === "cancel"
              ? `Are you sure you want to cancel ${count} selected appointment${count !== 1 ? "s" : ""}? They will be moved to the cancelled list.`
              : `Are you sure you want to permanently delete ${count} selected appointment${count !== 1 ? "s" : ""}? This will remove them from the database.`}
          </p>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Keep Appointments
            </button>

            <button
              onClick={onConfirm}
              disabled={isLoading}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
                action === "cancel"
                  ? "bg-yellow-600 text-white hover:bg-yellow-700"
                  : "bg-red-600 text-white hover:bg-red-700"
              }`}
            >
              <ActionIcon className="w-5 h-5" />
              {actionText} {count} Appointment{count !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}




