import React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";

interface NoPhotosWarningModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContinue: () => void;
  photoType: "before" | "after";
}

export default function NoPhotosWarningModal({
  isOpen,
  onClose,
  onContinue,
  photoType,
}: NoPhotosWarningModalProps) {
  if (!isOpen) return null;

  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop - appears instantly, no animation */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal - animates in (slide up to center) */}
      <div
        className="relative z-10 bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 animate-slide-up"
        role="dialog"
        aria-modal="true"
        aria-labelledby="warning-modal-title"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Warning icon */}
        <div className="flex items-center justify-center w-16 h-16 mx-auto bg-yellow-100 rounded-full">
          <AlertTriangle className="w-8 h-8 text-yellow-600" />
        </div>

        {/* Title */}
        <h2
          id="warning-modal-title"
          className="text-xl font-bold text-gray-900 text-center"
        >
          No Photos Uploaded
        </h2>

        {/* Message */}
        <p className="text-gray-600 text-center">
          You haven't uploaded any {photoType} photos. You can continue without
          photos, but they may be required by your organization.
        </p>

        {/* Buttons */}
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-white border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          >
            Back to Photos
          </button>
          <button
            onClick={onContinue}
            className="flex-1 px-4 py-3 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          >
            Continue Without Photos
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
