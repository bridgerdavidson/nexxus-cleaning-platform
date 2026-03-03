"use client";

import React, { useState } from "react";
import {
  X,
  CheckCircle,
  XCircle,
  Loader2,
  Plus,
  Trash2,
  Calendar,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { formatTimeTo12h } from "../lib/formatTime";

interface SuggestedTime {
  date: string;
  time: string;
}

interface SuggestedWindow {
  date: string;
  startTime: string;
  endTime: string;
}

interface AppointmentInfo {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  homeowner_name: string;
  property_address: string;
  service_name: string;
}

interface ConfirmAvailabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onDecline: (reason: string, suggestedTimes: SuggestedTime[], suggestedWindows: SuggestedWindow[]) => Promise<void>;
  appointment: AppointmentInfo | null;
  mode: "confirm" | "decline";
}

export default function ConfirmAvailabilityModal({
  isOpen,
  onClose,
  onConfirm,
  onDecline,
  appointment,
  mode,
}: ConfirmAvailabilityModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [suggestedTimes, setSuggestedTimes] = useState<SuggestedTime[]>([]);
  const [suggestedWindows, setSuggestedWindows] = useState<SuggestedWindow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(isOpen);

  if (!isOpen || !appointment) return null;

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleConfirm = async () => {
    try {
      setIsSubmitting(true);
      setError(null);
      await onConfirm();
      handleReset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!reason.trim()) {
      setError("Please provide a reason for being unavailable.");
      return;
    }
    try {
      setIsSubmitting(true);
      setError(null);
      await onDecline(reason, suggestedTimes, suggestedWindows);
      handleReset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setReason("");
    setSuggestedTimes([]);
    setSuggestedWindows([]);
    setError(null);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const addSuggestedTime = () => {
    setSuggestedTimes([...suggestedTimes, { date: "", time: "" }]);
  };

  const removeSuggestedTime = (index: number) => {
    setSuggestedTimes(suggestedTimes.filter((_, i) => i !== index));
  };

  const updateSuggestedTime = (
    index: number,
    field: "date" | "time",
    value: string
  ) => {
    const updated = [...suggestedTimes];
    updated[index] = { ...updated[index], [field]: value };
    setSuggestedTimes(updated);
  };

  const addSuggestedWindow = () => {
    setSuggestedWindows([...suggestedWindows, { date: "", startTime: "", endTime: "" }]);
  };

  const removeSuggestedWindow = (index: number) => {
    setSuggestedWindows(suggestedWindows.filter((_, i) => i !== index));
  };

  const updateSuggestedWindow = (
    index: number,
    field: "date" | "startTime" | "endTime",
    value: string
  ) => {
    const updated = [...suggestedWindows];
    updated[index] = { ...updated[index], [field]: value };
    setSuggestedWindows(updated);
  };

  // Get today's date for min date validation
  const getTodayLocal = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  if (mode === "confirm") {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div
          className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
          onClick={handleClose}
        />
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-slide-up">
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
              disabled={isSubmitting}
            >
              <X className="w-6 h-6" />
            </button>

            <div className="flex items-start mb-4">
              <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mr-4">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-gray-900 mb-1">
                  Confirm Availability
                </h2>
                <p className="text-sm text-gray-600">
                  Are you sure you&apos;re available for this appointment?
                </p>
              </div>
            </div>

            {/* Appointment Details */}
            <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-gray-400" />
                <span className="font-medium text-gray-900">
                  {formatDate(appointment.scheduled_date)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Clock className="w-4 h-4 text-gray-400" />
                <span className="text-gray-700">
                  {formatTimeTo12h(appointment.scheduled_time)}
                </span>
              </div>
              <p className="text-sm text-gray-600">
                {appointment.homeowner_name} &middot;{" "}
                {appointment.service_name}
              </p>
              <p className="text-sm text-gray-500">
                {appointment.property_address}
              </p>
            </div>

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleClose}
                disabled={isSubmitting}
                className="flex-1 bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Confirming...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    <span>Yes, I&apos;m Available</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // mode === "decline"
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 animate-slide-up max-h-[90vh] overflow-y-auto modal-scrollbar">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isSubmitting}
          >
            <X className="w-6 h-6" />
          </button>

          <div className="flex items-start mb-4">
            <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mr-4">
              <XCircle className="w-6 h-6 text-red-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-gray-900 mb-1">
                Not Available
              </h2>
              <p className="text-sm text-gray-600">
                Let the admin know why you&apos;re not available and suggest
                alternative times.
              </p>
            </div>
          </div>

          {/* Appointment Details */}
          <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="font-medium text-gray-900">
                {formatDate(appointment.scheduled_date)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="text-gray-700">
                {formatTimeTo12h(appointment.scheduled_time)}
              </span>
            </div>
            <p className="text-sm text-gray-600">
              {appointment.homeowner_name} &middot; {appointment.service_name}
            </p>
          </div>

          {/* Reason */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why you're not available for this time..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
            />
          </div>

          {/* Suggested Times */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Suggest Alternative Times{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <button
                type="button"
                onClick={addSuggestedTime}
                className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Time
              </button>
            </div>

            {suggestedTimes.length === 0 && (
              <p className="text-sm text-gray-400 italic">
                No alternative times suggested yet. Click &quot;Add Time&quot; to suggest when you&apos;re available.
              </p>
            )}

            <div className="space-y-3">
              {suggestedTimes.map((st, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1">
                    <input
                      type="date"
                      value={st.date}
                      min={getTodayLocal()}
                      onChange={(e) =>
                        updateSuggestedTime(index, "date", e.target.value)
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <input
                      type="time"
                      value={st.time}
                      onChange={(e) =>
                        updateSuggestedTime(index, "time", e.target.value)
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeSuggestedTime(index)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Suggested Windows */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Suggest Availability Windows{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <button
                type="button"
                onClick={addSuggestedWindow}
                className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Window
              </button>
            </div>

            {suggestedWindows.length === 0 && (
              <p className="text-sm text-gray-400 italic">
                No availability windows suggested yet. Click &quot;Add Window&quot; to suggest time ranges when you&apos;re available.
              </p>
            )}

            <div className="space-y-3">
              {suggestedWindows.map((sw, index) => {
                const hasTimeError = sw.startTime && sw.endTime && sw.startTime >= sw.endTime;
                return (
                  <div
                    key={index}
                    className="flex flex-col gap-2 p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <input
                          type="date"
                          value={sw.date}
                          min={getTodayLocal()}
                          onChange={(e) =>
                            updateSuggestedWindow(index, "date", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                          placeholder="Date"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSuggestedWindow(index)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <input
                          type="time"
                          value={sw.startTime}
                          onChange={(e) =>
                            updateSuggestedWindow(index, "startTime", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                          placeholder="Start time"
                        />
                      </div>
                      <span className="text-gray-500 font-medium">to</span>
                      <div className="flex-1">
                        <input
                          type="time"
                          value={sw.endTime}
                          onChange={(e) =>
                            updateSuggestedWindow(index, "endTime", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                          placeholder="End time"
                        />
                      </div>
                    </div>
                    {hasTimeError && (
                      <p className="text-xs text-red-600 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        End time must be after start time
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <span className="text-sm text-red-700">{error}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1 bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDecline}
              disabled={isSubmitting || !reason.trim()}
              className="flex-1 bg-red-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5" />
                  <span>Submit Unavailability</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
