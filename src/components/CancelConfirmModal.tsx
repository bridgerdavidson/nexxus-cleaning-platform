import React from "react";
import { XCircle, Trash2, AlertTriangle } from "lucide-react";

interface CancelConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCancel: () => void;
  onDelete: () => void;
  appointmentInfo?: {
    date: string;
    time: string;
    homeowner: string;
  };
  isLoading?: boolean;
}

export default function CancelConfirmModal({
  isOpen,
  onClose,
  onCancel,
  onDelete,
  appointmentInfo,
  isLoading = false,
}: CancelConfirmModalProps) {
  if (!isOpen) return null;

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
                Cancel Appointment
              </h2>
              <p className="text-sm text-gray-600">
                Choose how to handle this appointment
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {appointmentInfo && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 mb-1">Appointment Details:</p>
              <p className="font-medium text-gray-900">
                {appointmentInfo.homeowner}
              </p>
              <p className="text-sm text-gray-600">
                {appointmentInfo.date} at {appointmentInfo.time}
              </p>
            </div>
          )}

          <p className="text-gray-700 mb-6">
            You can move this appointment to the cancelled list or permanently
            delete it. Choose an option below:
          </p>

          <div className="space-y-3">
            {/* Cancel Button (Soft Delete) */}
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <XCircle className="w-5 h-5" />
              <span>Move to Cancelled (Keep Record)</span>
            </button>

            {/* Delete Button (Hard Delete) */}
            <button
              onClick={onDelete}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-5 h-5" />
              <span>Permanently Delete</span>
            </button>

            {/* Keep Button */}
            <button
              onClick={onClose}
              disabled={isLoading}
              className="w-full px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Keep Appointment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

