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
  CheckCircle,
  Star,
  RefreshCw,
  Send,
  SprayCan,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { updateAppointment } from "../hooks/useAdminData";
import { AppointmentCardData } from "./AppointmentCard";

interface Cleaner {
  id: string;
  rating: number;
  total_jobs: number;
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

export default function RescheduleAppointmentModal({
  isOpen,
  onClose,
  onRescheduleComplete,
  appointment,
  organizationId,
}: RescheduleAppointmentModalProps) {
  const { user } = useAuth();

  // Form state
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [selectedCleaner, setSelectedCleaner] = useState<Cleaner | null>(null);
  const [originalCleanerId, setOriginalCleanerId] = useState<string | null>(
    null
  );

  // Data state
  const [cleaners, setCleaners] = useState<Cleaner[]>([]);
  const [cleanersLoading, setCleanersLoading] = useState(false);
  const [cleanerSearch, setCleanerSearch] = useState("");
  const [feedback, setFeedback] = useState<CleanerFeedback[]>([]);
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

  useBodyScrollLock(isOpen);

  // Fetch cleaner feedback
  const fetchFeedback = useCallback(async () => {
    if (!appointment?.id) return;
    setFeedbackLoading(true);
    try {
      const response = await fetch(
        `/api/appointments/confirm?appointmentId=${appointment.id}`
      );
      const result = await response.json();
      if (result.success) {
        setFeedback(result.data || []);
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
          rating,
          total_jobs,
          user_profile:user_profiles!id(
            first_name,
            last_name,
            avatar_url
          )
        `
        )
        .eq("organization_id", organizationId)
        .eq("is_available", true)
        .order("rating", { ascending: false });

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

  // Initialize state when appointment changes
  useEffect(() => {
    if (isOpen && appointment) {
      setScheduledDate(appointment.scheduled_date || "");
      setScheduledTime(appointment.scheduled_time?.slice(0, 5) || "");
      setError(null);
      setSelectedSuggestedTime(null);

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

  // Set selected cleaner once cleaners and originalCleanerId are loaded
  useEffect(() => {
    if (cleaners.length > 0 && originalCleanerId) {
      const currentCleaner = cleaners.find((c) => c.id === originalCleanerId);
      if (currentCleaner) {
        setSelectedCleaner(currentCleaner);
      }
    }
  }, [cleaners, originalCleanerId]);

  if (!isOpen || !appointment) return null;

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const twoDigitYear = year % 100;
    return `${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}/${twoDigitYear.toString().padStart(2, '0')}`;
  };

  const formatTime = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(":");
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? "PM" : "AM";
    const standardHour = hour % 12 || 12;
    return `${standardHour}:${minutes} ${ampm}`;
  };

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

  const handleSuggestedTimeClick = (st: SuggestedTime) => {
    // Format time to HH:mm (the input stores HH:mm:ss)
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
    // Pre-fill with start time of window
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
    // Check specific times
    const matchesSpecificTime = feedback.some((fb) =>
      fb.cleaner_suggested_times.some(
        (st) =>
          st.suggested_date === scheduledDate &&
          st.suggested_time.slice(0, 5) === scheduledTime
      )
    );
    
    if (matchesSpecificTime) return true;
    
    // Check windows
    const matchesWindow = feedback.some((fb) =>
      fb.cleaner_suggested_windows?.some((sw) => {
        if (sw.window_date !== scheduledDate) return false;
        
        const selectedTime = scheduledTime + ':00';
        return selectedTime >= sw.start_time && selectedTime <= sw.end_time;
      })
    );
    
    return matchesWindow;
  };

  const isSameCleaner = selectedCleaner?.id === originalCleanerId;
  const willAutoApprove = isSameCleaner && matchesSuggestedTimeOrWindow();

  const filteredCleaners = cleaners.filter((c) => {
    if (!cleanerSearch) return true;
    const name = getCleanerName(c).toLowerCase();
    return name.includes(cleanerSearch.toLowerCase());
  });

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

      // Delete any existing feedback for this appointment before rescheduling
      // This cleans up old feedback from previous reschedule cycles
      try {
        await supabase
          .from("cleaner_availability_feedback")
          .delete()
          .eq("appointment_id", appointment.id);
      } catch (deleteErr) {
        console.error("Error deleting old feedback:", deleteErr);
        // Non-fatal - continue with reschedule
      }

      const result = await updateAppointment(appointment.id, {
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime + ":00",
        cleaner_id: selectedCleaner.id,
        status: willAutoApprove ? "confirmed" : "pending",
        cleaner_confirmation_status: newStatus,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to reschedule appointment");
      }

      // If awaiting, send in-app notification to cleaner
      if (newStatus === "awaiting" && user?.id) {
        try {
          // Get or create conversation
          const { data: conversationId, error: convError } = await supabase.rpc(
            "get_or_create_conversation",
            {
              user1_id: user.id,
              user2_id: selectedCleaner.id,
            }
          );

          if (!convError && conversationId) {
            const homeownerName = getHomeownerName();
            const newDateFormatted = formatDate(scheduledDate);
            const newTimeFormatted = formatTime(scheduledTime);

            await supabase.from("messages").insert({
              organization_id: organizationId,
              conversation_id: conversationId,
              sender_id: user.id,
              recipient_id: selectedCleaner.id,
              appointment_id: appointment.id,
              content: `The appointment for ${homeownerName} has been rescheduled to ${newDateFormatted} at ${newTimeFormatted}. Please confirm your availability.`,
              is_read: false,
            });
          }
        } catch (msgErr) {
          console.error("Error sending reschedule notification:", msgErr);
          // Non-fatal - don't block the reschedule
        }
      }

      onRescheduleComplete();
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reschedule appointment"
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
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[300] overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-2xl max-w-4xl w-full animate-slide-up max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <RefreshCw className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Reschedule Appointment
                </h2>
                <p className="text-sm text-gray-500">
                  Change the date, time, or cleaner for this appointment
                </p>
              </div>
            </div>
            <button
              onClick={handleClose}
              disabled={submitting}
              className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded-lg hover:bg-gray-100"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Two-column content */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0 lg:flex-row">
            {/* Left: Appointment details (informational) */}
            <div className="flex-shrink-0 lg:w-[320px] lg:border-r lg:border-gray-200 bg-gray-50/80 p-6">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
                Appointment Details
              </h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                    <User className="w-4 h-4 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Customer</p>
                    <p className="font-medium text-gray-900 mt-0.5">
                      {getHomeownerName()}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                    <MapPin className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Address</p>
                    <p className="text-sm text-gray-700 mt-0.5">
                      {getPropertyAddress()}
                    </p>
                  </div>
                </div>
                {appointment.service_type && (
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                      <SprayCan className="w-4 h-4 text-gray-500" />
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Service</p>
                      <p className="text-sm text-gray-700 mt-0.5">
                        {appointment.service_type.name}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                    <Calendar className="w-4 h-4 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Current time</p>
                    <p className="text-sm text-gray-700 mt-0.5">
                      {formatDate(appointment.scheduled_date)} at{" "}
                      {formatTime(appointment.scheduled_time)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Rescheduling logic (form + actions) */}
            <div className="flex-1 overflow-y-auto modal-scrollbar p-6 flex flex-col min-h-0">
              <div className="space-y-5">
                {/* Cleaner Feedback Section */}
                <div className="border-l-4 border-red-500 bg-red-50 rounded-r-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                    <h3 className="font-semibold text-red-800">
                      Cleaner Declined This Time
                    </h3>
                  </div>

                  {feedbackLoading ? (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Loading feedback...</span>
                    </div>
                  ) : feedback.length > 0 ? (
                    <div className="space-y-3">
                      {feedback.map((fb) => (
                        <div key={fb.id}>
                          {fb.reason && (
                            <div className="mb-3">
                              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                                Reason
                              </p>
                              <p className="text-sm text-gray-800 bg-white rounded-lg p-3 border border-red-200">
                                {fb.reason}
                              </p>
                            </div>
                          )}
                          {fb.cleaner_suggested_times &&
                            fb.cleaner_suggested_times.length > 0 && (
                              <div>
                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                                  Suggested Alternative Times{" "}
                                  <span className="text-gray-400 normal-case">
                                    (click to select)
                                  </span>
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {fb.cleaner_suggested_times.map((st) => {
                                    const isSelected = isSuggestedTimeSelected(st);
                                    return (
                                      <button
                                        key={st.id}
                                        type="button"
                                        onClick={() =>
                                          handleSuggestedTimeClick(st)
                                        }
                                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                                          isSelected
                                            ? "bg-green-600 text-white shadow-md ring-2 ring-green-300"
                                            : "bg-white text-gray-700 border border-gray-300 hover:border-green-400 hover:bg-green-50"
                                        }`}
                                      >
                                        {isSelected && (
                                          <CheckCircle className="w-4 h-4" />
                                        )}
                                        <Calendar className="w-3.5 h-3.5" />
                                        <span>
                                          {formatDate(st.suggested_date)} at{" "}
                                          {formatTime(st.suggested_time)}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                            {fb.cleaner_suggested_windows &&
                              fb.cleaner_suggested_windows.length > 0 && (
                                <div className="mt-3">
                                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                                    Availability Windows{" "}
                                    <span className="text-gray-400 normal-case">
                                      (click to select)
                                    </span>
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {fb.cleaner_suggested_windows.map((sw) => {
                                      const isSelected = isSuggestedWindowSelected(sw);
                                      return (
                                        <button
                                          key={sw.id}
                                          type="button"
                                          onClick={() =>
                                            handleSuggestedWindowClick(sw)
                                          }
                                          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                                            isSelected
                                              ? "bg-green-600 text-white shadow-md ring-2 ring-green-300"
                                              : "bg-white text-gray-700 border border-gray-300 hover:border-green-400 hover:bg-green-50"
                                          }`}
                                        >
                                          {isSelected && (
                                            <CheckCircle className="w-4 h-4" />
                                          )}
                                          <Calendar className="w-3.5 h-3.5" />
                                          <span>
                                            {formatDate(sw.window_date)}: {formatTime(sw.start_time)} - {formatTime(sw.end_time)}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-red-700">
                      No detailed feedback provided.
                    </p>
                  )}
                </div>

                {/* Cleaner Selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Assigned Cleaner
                  </label>

                  {selectedCleaner && (
                    <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg mb-2">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                          <User className="w-5 h-5 text-gray-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">
                            {getCleanerName(selectedCleaner)}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                            <Star className="w-3 h-3 text-yellow-500" />
                            <span>{selectedCleaner.rating.toFixed(1)}</span>
                            <span>&middot;</span>
                            <span>{selectedCleaner.total_jobs} jobs</span>
                            {selectedCleaner.id === originalCleanerId && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                                Current
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedCleaner(null)}
                        className="text-xs text-gray-500 hover:text-gray-700 font-medium px-2 py-1 rounded hover:bg-gray-100"
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
                          placeholder="Search cleaners..."
                          value={cleanerSearch}
                          onChange={(e) => setCleanerSearch(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                        />
                      </div>

                      {cleanersLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto modal-scrollbar">
                          {filteredCleaners.map((cleaner) => (
                            <button
                              key={cleaner.id}
                              type="button"
                              onClick={() => {
                                setSelectedCleaner(cleaner);
                                setCleanerSearch("");
                                if (cleaner.id !== originalCleanerId) {
                                  setSelectedSuggestedTime(null);
                                }
                              }}
                              className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-all hover:shadow-sm ${
                                cleaner.id === originalCleanerId
                                  ? "border-gray-300 bg-gray-50 hover:bg-gray-100"
                                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                              }`}
                            >
                              <div className="w-9 h-9 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <User className="w-4 h-4 text-gray-500" />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-sm text-gray-900 truncate">
                                  {getCleanerName(cleaner)}
                                </p>
                                <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                                  <Star className="w-3 h-3 text-yellow-500" />
                                  <span>{cleaner.rating.toFixed(1)}</span>
                                  <span>&middot;</span>
                                  <span>{cleaner.total_jobs} jobs</span>
                                  {cleaner.id === originalCleanerId && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                                      Current
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* New Date/Time Section */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">
                    Reschedule To
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Date
                      </label>
                      <input
                        type="date"
                        value={scheduledDate}
                        onChange={(e) => {
                          setScheduledDate(e.target.value);
                          setSelectedSuggestedTime(null);
                          setSelectedSuggestedWindow(null);
                        }}
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Time
                      </label>
                      <input
                        type="time"
                        value={scheduledTime}
                        onChange={(e) => {
                          setScheduledTime(e.target.value);
                          setSelectedSuggestedTime(null);
                          setSelectedSuggestedWindow(null);
                        }}
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                  </div>

                  {scheduledDate && scheduledTime && selectedCleaner && (
                    <div
                      className={`mt-3 flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                        willAutoApprove
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {willAutoApprove ? (
                        <>
                          <CheckCircle className="w-4 h-4" />
                          <span>
                            This matches a suggested time — appointment will be
                            auto-approved.
                          </span>
                        </>
                      ) : (
                        <>
                          <Clock className="w-4 h-4" />
                          <span>
                            Cleaner will need to confirm this new time.
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <span className="text-sm text-red-700">{error}</span>
                  </div>
                )}
              </div>

              {/* Footer - inside right column so it stays with the form */}
              <div className="flex-shrink-0 pt-6 mt-auto border-t border-gray-200 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleClose}
                  disabled={submitting}
                  className="flex-1 bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={
                    submitting || !selectedCleaner || !scheduledDate || !scheduledTime
                  }
                  className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                    willAutoApprove
                      ? "bg-green-600 text-white hover:bg-green-700"
                      : "bg-primary-600 text-white hover:bg-primary-700"
                  }`}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Rescheduling...</span>
                    </>
                  ) : willAutoApprove ? (
                    <>
                      <RefreshCw className="w-5 h-5" />
                      <span>Confirm Reschedule</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-5 h-5" />
                      <span>Send to Cleaner</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
