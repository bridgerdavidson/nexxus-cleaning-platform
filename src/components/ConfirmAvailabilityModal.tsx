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
import type { FreeSlot } from "../lib/cleanerFreeSlots";
import type { DeclineReason } from "../types";

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

export type ConfirmModalMode = "confirm" | "propose" | "decline";

interface ConfirmAvailabilityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onPropose: (
    reason: string,
    suggestedTimes: SuggestedTime[],
    suggestedWindows: SuggestedWindow[],
  ) => Promise<void>;
  onDecline: (reason: DeclineReason, other: string) => Promise<void>;
  appointment: AppointmentInfo | null;
  mode: ConfirmModalMode;
  /** Suggestions auto-derived from cleaner's absence (rendered as one-tap chips). */
  freeSlotCandidates?: FreeSlot[];
}

const DECLINE_OPTIONS: { value: DeclineReason; label: string; description: string }[] = [
  { value: "sick", label: "Sick", description: "Out due to illness" },
  { value: "not_my_service", label: "Not my service", description: "Outside what you offer" },
  { value: "too_far", label: "Too far", description: "Location is beyond your range" },
  { value: "other", label: "Other", description: "Add a short note below" },
];

export default function ConfirmAvailabilityModal({
  isOpen,
  onClose,
  onConfirm,
  onPropose,
  onDecline,
  appointment,
  mode,
  freeSlotCandidates = [],
}: ConfirmAvailabilityModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [suggestedTimes, setSuggestedTimes] = useState<SuggestedTime[]>([]);
  const [suggestedWindows, setSuggestedWindows] = useState<SuggestedWindow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Decline mode state
  const [declineReason, setDeclineReason] = useState<DeclineReason | null>(null);
  const [declineOther, setDeclineOther] = useState("");

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

  const handleReset = () => {
    setReason("");
    setSuggestedTimes([]);
    setSuggestedWindows([]);
    setDeclineReason(null);
    setDeclineOther("");
    setError(null);
  };

  const handleClose = () => {
    handleReset();
    onClose();
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

  const handlePropose = async () => {
    if (suggestedTimes.length === 0 && suggestedWindows.length === 0) {
      setError("Please pick at least one alternative time or add a custom one.");
      return;
    }
    try {
      setIsSubmitting(true);
      setError(null);
      // Reason is optional for counter-proposals — the alt times speak for themselves.
      // Pass the trimmed reason; empty string is fine, the API treats it as null.
      await onPropose(
        reason.trim(),
        suggestedTimes.filter((st) => st.date && st.time),
        suggestedWindows.filter((sw) => sw.date && sw.startTime && sw.endTime),
      );
      handleReset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!declineReason) {
      setError("Please pick a reason.");
      return;
    }
    if (declineReason === "other" && !declineOther.trim()) {
      setError("Please add a short note for the 'Other' reason.");
      return;
    }
    try {
      setIsSubmitting(true);
      setError(null);
      await onDecline(declineReason, declineOther.trim());
      handleReset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleCandidate = (slot: FreeSlot) => {
    const idx = suggestedTimes.findIndex(
      (st) => st.date === slot.date && st.time === slot.time,
    );
    if (idx >= 0) {
      setSuggestedTimes(suggestedTimes.filter((_, i) => i !== idx));
    } else {
      setSuggestedTimes([...suggestedTimes, { date: slot.date, time: slot.time }]);
    }
  };

  const isCandidateSelected = (slot: FreeSlot) =>
    suggestedTimes.some((st) => st.date === slot.date && st.time === slot.time);

  const addSuggestedTime = () => {
    setSuggestedTimes([...suggestedTimes, { date: "", time: "" }]);
  };

  const removeSuggestedTime = (index: number) => {
    setSuggestedTimes(suggestedTimes.filter((_, i) => i !== index));
  };

  const updateSuggestedTime = (index: number, field: "date" | "time", value: string) => {
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
    value: string,
  ) => {
    const updated = [...suggestedWindows];
    updated[index] = { ...updated[index], [field]: value };
    setSuggestedWindows(updated);
  };

  const getTodayLocal = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // ---------- CONFIRM (accept) mode ----------
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
              aria-label="Close"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="flex items-start mb-4">
              <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mr-4">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-gray-900 mb-1">Accept appointment</h2>
                <p className="text-sm text-gray-600">
                  Confirm you&apos;re available for this appointment.
                </p>
              </div>
            </div>

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
              <p className="text-sm text-gray-500">{appointment.property_address}</p>
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
                    <span>Yes, I&apos;m available</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- DECLINE (hard decline with canned reason) mode ----------
  if (mode === "decline") {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto">
        <div
          className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
          onClick={handleClose}
        />
        <div className="flex min-h-full items-center justify-center p-4">
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-slide-up max-h-[90vh] overflow-y-auto modal-scrollbar">
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
              disabled={isSubmitting}
              aria-label="Close"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="flex items-start mb-4">
              <div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mr-4">
                <XCircle className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-gray-900 mb-1">Decline appointment</h2>
                <p className="text-sm text-gray-600">
                  The admin will reassign this appointment. Pick a reason so they know what
                  happened.
                </p>
              </div>
            </div>

            <fieldset className="mb-4">
              <legend className="block text-sm font-medium text-gray-700 mb-2">
                Why are you declining?
              </legend>
              <div className="space-y-2" role="radiogroup">
                {DECLINE_OPTIONS.map((opt) => {
                  const selected = declineReason === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-primary-500 ${
                        selected
                          ? "border-primary-500 bg-primary-50"
                          : "border-gray-200 bg-white hover:border-gray-300"
                      }`}
                    >
                      {/* Native input is visually hidden but kept for keyboard nav + screen readers.
                          The visible circle below is the brand-styled radio indicator. */}
                      <input
                        type="radio"
                        name="declineReason"
                        value={opt.value}
                        checked={selected}
                        onChange={() => setDeclineReason(opt.value)}
                        className="sr-only"
                      />
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                          selected
                            ? "border-primary-600 bg-primary-600"
                            : "border-gray-300 bg-white"
                        }`}
                      >
                        {selected && (
                          <span className="h-1.5 w-1.5 rounded-full bg-white" />
                        )}
                      </span>
                      <div>
                        <p
                          className={`text-sm font-semibold ${
                            selected ? "text-primary-700" : "text-gray-900"
                          }`}
                        >
                          {opt.label}
                        </p>
                        <p className="text-xs text-gray-500">{opt.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {declineReason === "other" && (
              <div className="mb-4">
                <label htmlFor="declineOther" className="block text-sm font-medium text-gray-700 mb-1">
                  Short note
                </label>
                <input
                  id="declineOther"
                  type="text"
                  value={declineOther}
                  onChange={(e) => setDeclineOther(e.target.value)}
                  placeholder="e.g., car broke down"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all text-sm"
                />
              </div>
            )}

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
                disabled={isSubmitting || !declineReason}
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
                    <span>Submit decline</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- PROPOSE (counter-proposal with one-tap chips + manual add) mode ----------
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-6 animate-slide-up max-h-[90vh] overflow-y-auto modal-scrollbar">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            disabled={isSubmitting}
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="flex items-start mb-4">
            <div className="flex-shrink-0 w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mr-4">
              <Calendar className="w-6 h-6 text-orange-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Propose alternative times</h2>
              <p className="text-sm text-gray-600">
                Pick one or more times you&apos;re free. The admin will one-click confirm one.
              </p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 mb-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-gray-400" />
              <span className="font-medium text-gray-900">
                {formatDate(appointment.scheduled_date)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="text-gray-700">{formatTimeTo12h(appointment.scheduled_time)}</span>
            </div>
            <p className="text-sm text-gray-600">
              {appointment.homeowner_name} &middot; {appointment.service_name}
            </p>
          </div>

          {/* One-tap free-slot chips */}
          {freeSlotCandidates.length > 0 && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Suggested times you&apos;re free (tap to select)
              </label>
              <div className="flex flex-wrap gap-2">
                {freeSlotCandidates.map((slot) => {
                  const selected = isCandidateSelected(slot);
                  return (
                    <button
                      key={`${slot.date}-${slot.time}`}
                      type="button"
                      onClick={() => toggleCandidate(slot)}
                      className={`min-h-[44px] px-4 py-2 rounded-xl border text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary-500 ${
                        selected
                          ? "bg-primary-100 border-primary-500 text-primary-700"
                          : "bg-white border-gray-300 text-gray-700 hover:border-primary-400"
                      }`}
                      aria-pressed={selected}
                    >
                      {formatDate(slot.date)} · {formatTimeTo12h(slot.time)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Optional context note */}
          <div className="mb-4">
            <label htmlFor="proposeReason" className="block text-sm font-medium text-gray-700 mb-1.5">
              Note for the admin <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="proposeReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., I can do anything before 2 PM this week"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
            />
          </div>

          {/* Manual add — keeps the existing fallback if none of the chips fit */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Add another time{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <button
                type="button"
                onClick={addSuggestedTime}
                className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add time
              </button>
            </div>

            <div className="space-y-3">
              {suggestedTimes
                .filter(
                  (st) =>
                    !freeSlotCandidates.some(
                      (slot) => slot.date === st.date && slot.time === st.time,
                    ),
                )
                .map((st, idx) => {
                  // Find the absolute index in suggestedTimes for the update/remove handlers
                  const realIndex = suggestedTimes.findIndex(
                    (entry) =>
                      entry === st ||
                      (entry.date === st.date && entry.time === st.time && idx >= 0),
                  );
                  return (
                    <div
                      key={`${st.date}-${st.time}-${realIndex}`}
                      className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex-1">
                        <input
                          type="date"
                          value={st.date}
                          min={getTodayLocal()}
                          onChange={(e) =>
                            updateSuggestedTime(realIndex, "date", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                        />
                      </div>
                      <div className="flex-1">
                        <input
                          type="time"
                          value={st.time}
                          onChange={(e) =>
                            updateSuggestedTime(realIndex, "time", e.target.value)
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSuggestedTime(realIndex)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label="Remove time"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Suggested availability windows */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">
                Add availability window{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <button
                type="button"
                onClick={addSuggestedWindow}
                className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add window
              </button>
            </div>

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
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSuggestedWindow(index)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label="Remove window"
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
              onClick={handlePropose}
              disabled={isSubmitting}
              className="flex-1 bg-primary-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <Calendar className="w-5 h-5" />
                  <span>Send proposal</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
