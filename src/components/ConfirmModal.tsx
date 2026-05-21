"use client";

import React from "react";
import { X, AlertTriangle, AlertCircle, Loader2 } from "lucide-react";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useEscapeClose } from "../hooks/useEscapeClose";

export type ConfirmModalTone = "danger" | "warning" | "primary";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  loadingText?: string;
  tone?: ConfirmModalTone;
  isLoading?: boolean;
}

const TONE_STYLES: Record<
  ConfirmModalTone,
  { iconBg: string; iconColor: string; confirmBtn: string }
> = {
  danger: {
    iconBg: "bg-red-100",
    iconColor: "text-red-600",
    confirmBtn: "bg-red-600 hover:bg-red-700",
  },
  warning: {
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    confirmBtn: "bg-amber-600 hover:bg-amber-700",
  },
  primary: {
    iconBg: "bg-primary-100",
    iconColor: "text-primary-600",
    confirmBtn: "bg-primary-600 hover:bg-primary-700",
  },
};

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  loadingText = "Working…",
  tone = "danger",
  isLoading = false,
}: ConfirmModalProps) {
  useBodyScrollLock(isOpen);
  useEscapeClose(isOpen, isLoading ? () => undefined : onClose);

  if (!isOpen) return null;

  const styles = TONE_STYLES[tone];
  const Icon = tone === "primary" ? AlertCircle : AlertTriangle;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={isLoading ? undefined : onClose}
      />

      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-slide-up">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close modal"
            disabled={isLoading}
          >
            <X className="w-6 h-6" />
          </button>

          <div className="flex items-start mb-4">
            <div
              className={`flex-shrink-0 w-12 h-12 ${styles.iconBg} rounded-full flex items-center justify-center mr-4`}
            >
              <Icon className={`w-6 h-6 ${styles.iconColor}`} />
            </div>
            <div className="flex-1 pr-6">
              <h2 className="text-xl font-bold text-gray-900 mb-1">{title}</h2>
              <p className="text-sm text-gray-600">{message}</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mt-6">
            <button
              onClick={onClose}
              disabled={isLoading}
              className="flex-1 bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className={`flex-1 ${styles.confirmBtn} text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2`}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>{loadingText}</span>
                </>
              ) : (
                <span>{confirmText}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
