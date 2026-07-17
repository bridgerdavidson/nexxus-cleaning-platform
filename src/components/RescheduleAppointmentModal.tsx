"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Calendar,
  Clock,
  MapPin,
  User,
  Search,
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Send,
  SprayCan,
  Zap,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { updateAppointment, notifyReschedule } from "../hooks/useAdminData";
import { formatTimeTo12h } from "../lib/formatTime";
import { computeResponseDeadlineISO } from "../lib/computeResponseDeadline";
import { findConflicts, findNextAvailableSlot } from "../lib/appointmentConflicts";
import { AppointmentCardData } from "./AppointmentCard";

interface Cleaner {
  id: string;
  user_profile: {
    first_name: string;
    last_name: string;
    avatar_url: string | null;
  } | null;
}

interface SuggestedTime {
  id: string;
  suggested_date: string;
  suggested_time: string;
}

interface SuggestedWindow {
  id: string;
  window_date: string;
  start_time: string;
  end_time: string;
}

interface CleanerFeedback {
  id: string;
  reason: string | null;
  created_at: string;
  cleaner_suggested_times: SuggestedTime[];
  cleaner_suggested_windows: SuggestedWindow[];
}

interface RescheduleAppointmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRescheduleComplete: () => void;
  appointment: AppointmentCardData | null;
  organizationId: string;
}

// Legacy auto-default reason value persisted by earlier versions of the cleaner-side
// "Propose alternative" flow. Treated as "no real reason given" so we don't surface
// the placeholder text to the admin as if the cleaner had typed it.
const PLACEHOLDER_REASON = "Proposing alternative times";

const formatDateLong = (dateStr: string): string => {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

export default function RescheduleAppointmentModal({
  isOpen,
  onClose,
  onRescheduleComplete,
  appointment,
  organizationId,
}: RescheduleAppointmentModalProps) {
  const { accessToken } = useAuth();

  // Form state
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedCleaner, setSelectedCleaner] = useState<Cleaner | null>(null);
  const [originalCleanerId, setOriginalCleanerId] = useState<string | null>(
    null,
  );

  // Data state
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [cleanersLoading, setCleanersLoading] = useState(false);
  const [cleanerSearch, setCleanerSearch] = useState("");
  const [feedback, setFeedback] = useState<CleanerFeedback[]>([]);
  const [latestRouting, setLatestRouting] = useState<{
    response: string;
    decline_reason: string | null;
  } | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSuggestedTime, setSelectedSuggestedTime] = useState<{
    date: string;
    time: string;
  } | null>(null);
  const [selectedSuggestedWindow, setSelectedSuggestedWindow] = useState<{
    date: string;
    startTime: string;
    endTime: string;
  } | null>(null);

  // Wave 3: soft-warn double-booking for the reschedule flow. Holds the
  // chosen cleaner's other active appointments so findConflicts can flag any
  // overlap with the new date/time slot.
  const [cleanerSchedule, setCleanerSchedule] = useState<
    Array<{
      id: string;
      status: string;
      scheduled_date: string;
      scheduled_time: string;
      duration_minutes: number;
    }>
  >([]);

  useBodyScrollLock(isOpen);

  // Fetch cleaner feedback
  const fetchFeedback = useCallback(async () => {
    if (!appointment?.id) return;
    setFeedbackLoading(true);
    try {
      const response = await fetch(
        `/api/appointments/confirm?appointmentId=${appointment.id}`,
      );
      const result = await response.json();
      if (result.success) {
        setFeedback(result.data || []);
        setLatestRouting(result.latestRouting ?? null);
      }
    } catch (err) {
      console.error("Error fetching feedback:", err);
    } finally {
      setFeedbackLoading(false);
    }
  }, [appointment?.id]);

  // Fetch cleaners list
  const fetchCleaners = useCallback(async () => {
    if (!organizationId) return;
    setCleanersLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from("cleaner_profiles")
        .select(
          `
          id,
          user_profile:user_profiles!id(
            first_name,
            last_name,
            avatar_url
          )
        `,
        )
        .eq("organization_id", organizationId)
        .eq("is_available", true)
        .order("id", { ascending: true });

      if (fetchError) throw fetchError;

      const transformedData = (data || []).map((cleaner) => ({
        ...cleaner,
        user_profile: Array.isArray(cleaner.user_profile)
          ? cleaner.user_profile[0]
          : cleaner.user_profile,
      }));

      setCleaners(transformedData);
    } catch (err) {
      console.error("Error fetching cleaners:", err);
    } finally {
      setCleanersLoading(false);
    }
  }, [organizationId]);

  // Fetch current cleaner_id for this appointment
  const fetchAppointmentCleanerId = useCallback(async () => {
    if (!appointment?.id) return;
    try {
      const { data, error: fetchError } = await supabase
        .from("appointments")
        .select("cleaner_id")
        .eq("id", appointment.id)
        .single();

      if (!fetchError && data) {
        setOriginalCleanerId(data.cleaner_id);
      }
    } catch (err) {
      console.error("Error fetching cleaner_id:", err);
    }
  }, [appointment?.id]);

  useEffect(() => {
    if (isOpen && appointment) {
      setScheduledDate(appointment.scheduled_date || "");
      setScheduledTime(appointment.scheduled_time?.slice(0, 5) || "");
      setError(null);
      setSelectedSuggestedTime(null);
      setSelectedSuggestedWindow(null);

      fetchFeedback();
      fetchCleaners();
      fetchAppointmentCleanerId();
    }
  }, [
    isOpen,
    appointment,
    fetchFeedback,
    fetchCleaners,
    fetchAppointmentCleanerId,
  ]);

  useEffect(() => {
    if (cleaners.length > 0 && originalCleanerId) {
      const currentCleaner = cleaners.find((c) => c.id === originalCleanerId);
      if (currentCleaner) {
        setSelectedCleaner(currentCleaner);
      }
    }
  }, [cleaners, originalCleanerId]);

  // Wave 3: pull the chosen cleaner's other active appointments so the
  // double-booking warning fires for any overlap with the new slot.
  useEffect(() => {
    if (!selectedCleaner?.id || !organizationId) {
      setCleanerSchedule([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data, error: fetchError } = await supabase
        .from("appointments")
        .select("id, status, scheduled_date, scheduled_time, duration_minutes")
        .eq("organization_id", organizationId)
        .eq("cleaner_id", selectedCleaner.id)
        .in("status", ["pending", "confirmed", "in_progress"]);
      if (cancelled) return;
      if (fetchError) {
        console.warn("Conflict fetch failed:", fetchError.message);
        setCleanerSchedule([]);
        return;
      }
      setCleanerSchedule((data || []) as typeof cleanerSchedule);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCleaner?.id, organizationId]);

  if (!isOpen || !appointment) return null;

  const getHomeownerName = () => {
    if (appointment.homeowner) {
      return `${appointment.homeowner.first_name} ${appointment.homeowner.last_name}`;
    }
    return "Unknown";
  };

  const getPropertyAddress = () => {
    if (appointment.property) {
      const { address, city, state } = appointment.property;
      if (address && city && state) return `${address}, ${city}, ${state}`;
    }
    return "Address not available";
  };

  const getCleanerName = (cleaner: Cleaner) => {
    if (cleaner.user_profile) {
      return `${cleaner.user_profile.first_name} ${cleaner.user_profile.last_name}`;
    }
    return "Unknown";
  };

  const getCurrentCleanerName = (): string => {
    if (!originalCleanerId) return "The cleaner";
    const current = cleaners.find((c) => c.id === originalCleanerId);
    if (current) return getCleanerName(current);
    return "The cleaner";
  };

  const handleSuggestedTimeClick = (st: SuggestedTime) => {
    const timeForInput = st.suggested_time.slice(0, 5);
    setScheduledDate(st.suggested_date);
    setScheduledTime(timeForInput);
    setSelectedSuggestedTime({
      date: st.suggested_date,
      time: st.suggested_time,
    });
    setSelectedSuggestedWindow(null);
  };

  const handleSuggestedWindowClick = (sw: SuggestedWindow) => {
    const startTimeForInput = sw.start_time.slice(0, 5);
    setScheduledDate(sw.window_date);
    setScheduledTime(startTimeForInput);
    setSelectedSuggestedWindow({
      date: sw.window_date,
      startTime: sw.start_time,
      endTime: sw.end_time,
    });
    setSelectedSuggestedTime(null);
  };

  const isSuggestedTimeSelected = (st: SuggestedTime) => {
    if (!selectedSuggestedTime) return false;
    return (
      selectedSuggestedTime.date === st.suggested_date &&
      selectedSuggestedTime.time === st.suggested_time
    );
  };

  const isSuggestedWindowSelected = (sw: SuggestedWindow) => {
    if (!selectedSuggestedWindow) return false;
    return (
      selectedSuggestedWindow.date === sw.window_date &&
      selectedSuggestedWindow.startTime === sw.start_time &&
      selectedSuggestedWindow.endTime === sw.end_time
    );
  };

  // Check if current date/time matches any suggested time or falls within any window
  const matchesSuggestedTimeOrWindow = () => {
    const matchesSpecificTime = feedback.some((fb) =>
      fb.cleaner_suggested_times.some(
        (st) =>
          st.suggested_date === scheduledDate &&
          st.suggested_time.slice(0, 5) === scheduledTime,
      ),
    );
    if (matchesSpecificTime) return true;
    const matchesWindow = feedback.some((fb) =>
      fb.cleaner_suggested_windows?.some((sw) => {
        if (sw.window_date !== scheduledDate) return false;
        const selectedTime = scheduledTime + ":00";
        return selectedTime >= sw.start_time && selectedTime <= sw.end_time;
      }),
    );
    return matchesWindow;
  };

  const isSameCleaner = selectedCleaner?.id === originalCleanerId;
  const willAutoApprove = isSameCleaner && matchesSuggestedTimeOrWindow();

  // Aggregate the cleaner's latest feedback across all returned rows.
  const allSuggestedTimes: SuggestedTime[] = feedback.flatMap(
    (fb) => fb.cleaner_suggested_times ?? [],
  );
  const allSuggestedWindows: SuggestedWindow[] = feedback.flatMap(
    (fb) => fb.cleaner_suggested_windows ?? [],
  );
  const hasSuggestions =
    allSuggestedTimes.length > 0 || allSuggestedWindows.length > 0;
  const timedOut = latestRouting?.response === "expired";
  const cleanerReason: string | null = (() => {
    // If the last cleaner timed out, ignore any stale feedback from prior
    // cleaners on the same appointment — the surface should say "didn't
    // respond" rather than re-showing the previous cleaner's reason.
    if (timedOut) return null;
    const raw = feedback.find((fb) => fb.reason && fb.reason.trim())?.reason;
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed === PLACEHOLDER_REASON ? null : trimmed;
  })();

  const filteredCleaners = cleaners.filter((c) => {
    if (!cleanerSearch) return true;
    const name = getCleanerName(c).toLowerCase();
    return name.includes(cleanerSearch.toLowerCase());
  });

  // Conflict detection: would the picked slot overlap any of the cleaner's
  // other active appointments? Excludes the appointment being rescheduled so
  // it doesn't flag itself, and falls back to the service-type's typical
  // 60-minute duration when the appointment row has no duration on it yet.
  const candidateDuration =
    appointment.duration_minutes && appointment.duration_minutes > 0
      ? appointment.duration_minutes
      : 60;
  const conflictingAppointments =
    selectedCleaner?.id && scheduledDate && scheduledTime
      ? findConflicts(
          cleanerSchedule,
          {
            date: scheduledDate,
            time: scheduledTime,
            durationMinutes: candidateDuration,
          },
          { excludeAppointmentId: appointment.id },
        )
      : [];
  const hasConflicts = conflictingAppointments.length > 0;
  const nextAvailableSlot =
    hasConflicts && selectedCleaner?.id && scheduledDate && scheduledTime
      ? findNextAvailableSlot(
          cleanerSchedule,
          {
            date: scheduledDate,
            time: scheduledTime,
            durationMinutes: candidateDuration,
          },
          { excludeAppointmentId: appointment.id },
        )
      : null;

  const handleSubmit = async () => {
    if (!appointment || !selectedCleaner) return;

    if (!scheduledDate || !scheduledTime) {
      setError("Please select a date and time.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const newStatus = willAutoApprove ? "approved" : "awaiting";

      try {
        await supabase
          .from("cleaner_availability_feedback")
          .delete()
          .eq("appointment_id", appointment.id);
      } catch (deleteErr) {
        console.error("Error deleting old feedback:", deleteErr);
      }

      // SLA: if the reschedule auto-confirms, the cleaner has already
      // effectively responded — clear the deadline. If it goes back to
      // awaiting (different cleaner or different time), reset the deadline
      // using the new scheduled_at so the urgent/standard tier is correct.
      const nextDeadline = willAutoApprove
        ? null
        : computeResponseDeadlineISO(scheduledDate, scheduledTime);

      const result = await updateAppointment(appointment.id, {
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime + ":00",
        cleaner_id: selectedCleaner.id,
        status: willAutoApprove ? "confirmed" : "pending",
        cleaner_confirmation_status: newStatus,
        response_deadline: nextDeadline,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to reschedule appointment");
      }

      if (newStatus === "awaiting") {
        // Let the assigned cleaner know (via the notification bell) that the
        // job moved and needs their confirmation. Best-effort; never blocks
        // the reschedule UI.
        await notifyReschedule({
          appointmentId: appointment.id,
          organizationId,
          accessToken,
        });
      }

      onRescheduleComplete();
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reschedule appointment",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setScheduledDate("");
    setScheduledTime("");
    setSelectedCleaner(null);
    setOriginalCleanerId(null);
    setFeedback([]);
    setCleanerSearch("");
    setError(null);
    setSelectedSuggestedTime(null);
    setSelectedSuggestedWindow(null);
    onClose();
  };

  const currentCleanerName = getCurrentCleanerName();
  // Conflict state wins over the auto-confirm / send paths in the label so the
  // admin is reminded they're overriding a clash. The icon mirrors the label.
  const submitLabel = hasConflicts
    ? "Save anyway"
    : willAutoApprove
      ? "Confirm reschedule"
      : "Send to cleaner";
  const SubmitIcon = hasConflicts
    ? AlertTriangle
    : willAutoApprove
      ? CheckCircle
      : Send;

  return (
    <div className="fixed inset-0 z-[300] overflow-y-auto">
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-4xl w-full animate-slide-up max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between gap-4 p-6 border-b border-gray-200">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-amber-100 rounded-lg flex-shrink-0">
                <RefreshCw className="w-5 h-5 text-amber-600" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-gray-900 leading-tight">
                  Reschedule appointment
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {hasSuggestions
                    ? `Accept ${currentCleanerName}'s suggestion or pick a different time.`
                    : "Pick a new time or reassign to another cleaner."}
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={submitting}
              aria-label="Close"
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg hover:bg-gray-100 flex-shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col lg:flex-row">
            <div className="flex-1 min-h-0 overflow-y-auto modal-scrollbar flex flex-col lg:contents">
              {/* LEFT: Appointment summary (information dense, no actions) */}
              <aside className="flex-shrink-0 lg:w-[300px] lg:border-r lg:border-gray-200 bg-gray-50/70 p-6">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">
                  Appointment
                </h3>
                <dl className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white rounded-lg border border-gray-200 shadow-sm flex-shrink-0">
                      <User className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs font-medium text-gray-500">
                        Customer
                      </dt>
                      <dd className="text-sm font-medium text-gray-900 mt-0.5">
                        {getHomeownerName()}
                      </dd>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white rounded-lg border border-gray-200 shadow-sm flex-shrink-0">
                      <MapPin className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs font-medium text-gray-500">
                        Address
                      </dt>
                      <dd className="text-sm text-gray-700 mt-0.5 break-words">
                        {getPropertyAddress()}
                      </dd>
                    </div>
                  </div>
                  {appointment.service_type && (
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-white rounded-lg border border-gray-200 shadow-sm flex-shrink-0">
                        <SprayCan className="w-4 h-4 text-gray-500" />
                      </div>
                      <div className="min-w-0">
                        <dt className="text-xs font-medium text-gray-500">
                          Service
                        </dt>
                        <dd className="text-sm text-gray-700 mt-0.5 break-words">
                          {appointment.checklist?.name
                            ? `${appointment.service_type.name} · ${appointment.checklist.name}`
                            : appointment.service_type.name}
                        </dd>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white rounded-lg border border-gray-200 shadow-sm flex-shrink-0">
                      <Calendar className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs font-medium text-gray-500">
                        Originally
                      </dt>
                      <dd className="text-sm text-gray-700 mt-0.5">
                        {formatDateLong(appointment.scheduled_date)} ·{" "}
                        {formatTimeTo12h(appointment.scheduled_time)}
                      </dd>
                    </div>
                  </div>
                </dl>
              </aside>

              {/* RIGHT: Action column */}
              <div className="flex-shrink-0 flex flex-col p-6 lg:flex-1 lg:min-h-0 lg:overflow-y-auto modal-scrollbar">
                <div className="space-y-6 flex-1">
                  {/* Compact decline strip — context, not content */}
                  <div className="flex items-start gap-2.5 rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-2.5">
                    <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-amber-900 leading-snug">
                      {timedOut ? (
                        <>
                          <span className="font-semibold">{currentCleanerName}</span>{" "}
                          did not respond before the deadline.
                        </>
                      ) : (
                        <>
                          <span className="font-semibold">{currentCleanerName}</span>{" "}
                          declined this time
                          {cleanerReason ? (
                            <>
                              :{" "}
                              <span className="italic font-medium">
                                &ldquo;{cleanerReason}&rdquo;
                              </span>
                            </>
                          ) : (
                            "."
                          )}
                        </>
                      )}
                    </p>
                  </div>

                  {feedbackLoading && (
                    <div className="flex items-center justify-center gap-2 text-gray-500 py-3">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Loading cleaner response…</span>
                    </div>
                  )}

                  {/* PRIMARY action: Fast path (only when suggestions exist) */}
                  {hasSuggestions && (
                    <section className="rounded-2xl border border-primary-200 bg-primary-50/50 p-5">
                      <header className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <h3 className="text-base font-semibold text-gray-900">
                            Use {currentCleanerName}&apos;s suggestion
                          </h3>
                          <p className="text-xs text-gray-600 mt-0.5">
                            Confirms instantly, no second round-trip.
                          </p>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-100 text-primary-800 text-[11px] font-semibold uppercase tracking-wide flex-shrink-0">
                          <Zap className="w-3 h-3" />
                          Fast path
                        </span>
                      </header>

                      {allSuggestedTimes.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {allSuggestedTimes.map((st) => {
                            const isSelected = isSuggestedTimeSelected(st);
                            return (
                              <button
                                key={st.id}
                                type="button"
                                onClick={() => handleSuggestedTimeClick(st)}
                                title={`Confirm at ${formatDateLong(st.suggested_date)} at ${formatTimeTo12h(st.suggested_time)}`}
                                className={
                                  isSelected
                                    ? "group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all bg-primary-600 text-white shadow-md ring-2 ring-primary-300 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none"
                                    : "group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all bg-white text-gray-900 border border-primary-300 hover:border-primary-600 hover:bg-primary-50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none"
                                }
                              >
                                {isSelected ? (
                                  <CheckCircle className="w-4 h-4" />
                                ) : (
                                  <Calendar className="w-4 h-4 text-primary-600 group-hover:hidden" />
                                )}
                                {!isSelected && (
                                  <CheckCircle className="w-4 h-4 text-primary-700 hidden group-hover:inline" />
                                )}
                                <span>
                                  {formatDateLong(st.suggested_date)} ·{" "}
                                  {formatTimeTo12h(st.suggested_time)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {allSuggestedWindows.length > 0 && (
                        <div className={allSuggestedTimes.length > 0 ? "mt-4" : ""}>
                          <p className="text-xs font-medium text-gray-500 mb-2">
                            Any time within these windows:
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {allSuggestedWindows.map((sw) => {
                              const isSelected = isSuggestedWindowSelected(sw);
                              return (
                                <button
                                  key={sw.id}
                                  type="button"
                                  onClick={() => handleSuggestedWindowClick(sw)}
                                  title={`Confirm at ${formatDateLong(sw.window_date)} starting ${formatTimeTo12h(sw.start_time)}`}
                                  className={
                                    isSelected
                                      ? "group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all bg-primary-600 text-white shadow-md ring-2 ring-primary-300 focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none"
                                      : "group inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all bg-white text-gray-900 border border-primary-300 hover:border-primary-600 hover:bg-primary-50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none"
                                  }
                                >
                                  {isSelected ? (
                                    <CheckCircle className="w-4 h-4" />
                                  ) : (
                                    <Clock className="w-4 h-4 text-primary-600 group-hover:hidden" />
                                  )}
                                  {!isSelected && (
                                    <CheckCircle className="w-4 h-4 text-primary-700 hidden group-hover:inline" />
                                  )}
                                  <span>
                                    {formatDateLong(sw.window_date)} ·{" "}
                                    {formatTimeTo12h(sw.start_time)}–
                                    {formatTimeTo12h(sw.end_time)}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </section>
                  )}

                  {/* Or-divider — separates fast path from manual path */}
                  {hasSuggestions && (
                    <div className="flex items-center gap-3" aria-hidden="true">
                      <div className="h-px bg-gray-200 flex-1" />
                      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                        Or pick a different time
                      </span>
                      <div className="h-px bg-gray-200 flex-1" />
                    </div>
                  )}

                  {/* SECONDARY: Manual picker */}
                  <section className="space-y-4">
                    {!hasSuggestions && (
                      <h3 className="text-base font-semibold text-gray-900">
                        Pick a new time
                      </h3>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="reschedule-date"
                          className="block text-sm font-medium text-gray-700 mb-1"
                        >
                          Date
                        </label>
                        <input
                          id="reschedule-date"
                          type="date"
                          value={scheduledDate}
                          onChange={(e) => {
                            setScheduledDate(e.target.value);
                            setSelectedSuggestedTime(null);
                            setSelectedSuggestedWindow(null);
                          }}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all text-sm"
                        />
                      </div>
                      <div>
                        <label
                          htmlFor="reschedule-time"
                          className="block text-sm font-medium text-gray-700 mb-1"
                        >
                          Time
                        </label>
                        <input
                          id="reschedule-time"
                          type="time"
                          value={scheduledTime}
                          onChange={(e) => {
                            setScheduledTime(e.target.value);
                            setSelectedSuggestedTime(null);
                            setSelectedSuggestedWindow(null);
                          }}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all text-sm"
                        />
                      </div>
                    </div>

                    {/* Cleaner selector */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Assigned cleaner
                      </label>

                      {selectedCleaner && (
                        <div className="flex items-center justify-between gap-3 p-3 bg-white border border-gray-200 rounded-lg">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                              <User className="w-4 h-4 text-gray-500" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm text-gray-900 truncate">
                                {getCleanerName(selectedCleaner)}
                              </p>
                              {selectedCleaner.id === originalCleanerId && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 mt-0.5">
                                  Current
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedCleaner(null)}
                            className="text-xs font-medium text-gray-600 hover:text-gray-900 px-2.5 py-1.5 rounded-md hover:bg-gray-100 transition-colors flex-shrink-0"
                          >
                            Change
                          </button>
                        </div>
                      )}

                      {!selectedCleaner && (
                        <div className="space-y-2">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <input
                              type="text"
                              placeholder="Search cleaners…"
                              value={cleanerSearch}
                              onChange={(e) => setCleanerSearch(e.target.value)}
                              className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-sm"
                            />
                          </div>
                          {cleanersLoading ? (
                            <div className="flex items-center justify-center py-4">
                              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 gap-1.5 max-h-44 overflow-y-auto modal-scrollbar">
                              {filteredCleaners.map((cleaner) => (
                                <button
                                  key={cleaner.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedCleaner(cleaner);
                                    setCleanerSearch("");
                                  }}
                                  className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-200 bg-white hover:border-primary-300 hover:bg-primary-50/30 text-left transition-all focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:outline-none"
                                >
                                  <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                                    <User className="w-4 h-4 text-gray-500" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium text-sm text-gray-900 truncate">
                                      {getCleanerName(cleaner)}
                                    </p>
                                    {cleaner.id === originalCleanerId && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600 mt-0.5">
                                        Current
                                      </span>
                                    )}
                                  </div>
                                </button>
                              ))}
                              {filteredCleaners.length === 0 && (
                                <p className="text-sm text-gray-500 px-3 py-4 text-center">
                                  No cleaners match &ldquo;{cleanerSearch}&rdquo;
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Outcome banner — only when picker has a complete value */}
                    {scheduledDate && scheduledTime && selectedCleaner && (
                      <div
                        className={
                          willAutoApprove
                            ? "flex items-start gap-2 text-sm px-3 py-2.5 rounded-lg border bg-primary-50 text-primary-800 border-primary-200"
                            : "flex items-start gap-2 text-sm px-3 py-2.5 rounded-lg border bg-amber-50 text-amber-800 border-amber-200"
                        }
                        role="status"
                        aria-live="polite"
                      >
                        {willAutoApprove ? (
                          <>
                            <CheckCircle className="w-4 h-4 text-primary-700 mt-0.5 flex-shrink-0" />
                            <span className="leading-snug">
                              <span className="font-semibold">
                                Will auto-confirm.
                              </span>{" "}
                              This matches one of {currentCleanerName}&apos;s
                              suggestions and keeps the same cleaner.
                            </span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-4 h-4 text-amber-700 mt-0.5 flex-shrink-0" />
                            <span className="leading-snug">
                              Cleaner will need to confirm this new time.
                            </span>
                          </>
                        )}
                      </div>
                    )}

                    {/* Wave 3: soft-warn double-booking. Fires for ANY overlap,
                        not just exact matches — a candidate that starts mid-way
                        through an existing booking, ends inside one, or fully
                        contains one all trigger this. Admin can override. */}
                    {hasConflicts && (
                      <div
                        role="alert"
                        className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-3 text-orange-900"
                      >
                        <AlertTriangle className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm leading-snug">
                          <p className="font-semibold">
                            {currentCleanerName}&apos;s schedule overlaps this
                            time slot.
                          </p>
                          <p className="text-xs mt-0.5">
                            New slot:{" "}
                            <span className="font-medium">
                              {formatTimeTo12h(scheduledTime)} for{" "}
                              {candidateDuration}min
                            </span>{" "}
                            · clashes with:
                          </p>
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {conflictingAppointments.slice(0, 3).map((c) => (
                              <li key={c.id}>
                                · {formatTimeTo12h(c.scheduled_time)} for{" "}
                                {c.duration_minutes}min
                              </li>
                            ))}
                          </ul>
                          <p className="text-xs mt-1.5">
                            {currentCleanerName} will see both assignments and
                            can decline or counter-propose. Save anyway, or
                            pick a different time.
                          </p>
                          {nextAvailableSlot && (
                            <p className="text-xs mt-2 border-t border-orange-200 pt-2">
                              <span className="font-semibold">
                                Next free slot:
                              </span>{" "}
                              {formatTimeTo12h(nextAvailableSlot.time)} ·{" "}
                              <span className="text-orange-700/80">
                                Drive time between properties not factored in.
                              </span>
                            </p>
                          )}
                          {!nextAvailableSlot && (
                            <p className="text-xs mt-2 border-t border-orange-200 pt-2">
                              <span className="font-semibold">
                                No same-day opening.
                              </span>{" "}
                              Try a different day.
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {error && (
                      <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                        <span className="text-sm text-red-700">{error}</span>
                      </div>
                    )}
                  </section>
                </div>

                {/* Footer */}
                <div className="flex-shrink-0 pt-6 mt-6 border-t border-gray-200 flex flex-col-reverse sm:flex-row gap-3">
                  <button
                    onClick={handleClose}
                    disabled={submitting}
                    className="flex-1 bg-white border border-gray-300 text-gray-700 px-6 py-3 rounded-xl font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={
                      submitting ||
                      !selectedCleaner ||
                      !scheduledDate ||
                      !scheduledTime
                    }
                    className="flex-1 bg-primary-600 text-white px-6 py-3 rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:bg-primary-700"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>Saving…</span>
                      </>
                    ) : (
                      <>
                        <SubmitIcon className="w-5 h-5" />
                        <span>{submitLabel}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
