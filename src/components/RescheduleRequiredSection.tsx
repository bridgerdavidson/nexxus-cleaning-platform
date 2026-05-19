"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Check,
  Calendar,
  Clock,
} from "lucide-react";
import CompactAppointmentRow from "./CompactAppointmentRow";
import { AppointmentCardData } from "./AppointmentCard";
import { formatTimeTo12h } from "../lib/formatTime";

interface SuggestedTimeRow {
  id: string;
  suggested_date: string;
  suggested_time: string;
}

interface SuggestedWindowRow {
  id: string;
  window_date: string;
  start_time: string;
  end_time: string;
}

interface FeedbackBlob {
  id: string;
  reason: string | null;
  cleaner_suggested_times?: SuggestedTimeRow[] | null;
  cleaner_suggested_windows?: SuggestedWindowRow[] | null;
}

interface RejectedAppointment {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  organization_id?: string | null;
  homeowner?: {
    first_name: string;
    last_name: string;
    email?: string;
  } | null;
  cleaner_profile?: {
    user_profile?: {
      first_name: string;
      last_name: string;
    } | null;
  } | null;
  property?: {
    name?: string;
    address?: string;
    city?: string;
    state?: string;
  } | null;
  service_type?: {
    name: string;
  } | null;
  checklist?: {
    name: string;
  } | null;
  /**
   * Latest cleaner-availability feedback for the appointment. Present when
   * the cleaner counter-proposed alternative times (suggested times/windows
   * populated) or hard-declined (reason populated, no suggestions).
   */
  cleaner_availability_feedback?: FeedbackBlob | FeedbackBlob[] | null;
}

interface RescheduleRequiredSectionProps {
  appointments: RejectedAppointment[];
  loading: boolean;
  onReschedule: (appointment: RejectedAppointment) => void;
  onViewDetails: (appointment: RejectedAppointment) => void;
  /**
   * Called when the admin one-click accepts a cleaner-suggested time. Should
   * POST to /api/appointments/accept-counter-proposal and refresh data.
   */
  onAcceptCounterProposal?: (args: {
    appointmentId: string;
    suggestedTimeId: string;
    organizationId: string;
  }) => Promise<void>;
  defaultExpanded?: boolean;
}

const getCleanerName = (apt: RejectedAppointment): string => {
  const profile = apt.cleaner_profile?.user_profile;
  if (!profile) return "The cleaner";
  const name = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
  return name || "The cleaner";
};

const formatDateShort = (dateStr: string): string => {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
};

const getFeedback = (apt: RejectedAppointment): FeedbackBlob | null => {
  const fb = apt.cleaner_availability_feedback;
  if (!fb) return null;
  return Array.isArray(fb) ? fb[0] ?? null : fb;
};

export default function RescheduleRequiredSection({
  appointments,
  loading,
  onReschedule,
  onViewDetails,
  onAcceptCounterProposal,
  defaultExpanded = true,
}: RescheduleRequiredSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  if (loading || appointments.length === 0) return null;

  const handleAcceptSuggested = async (
    appointmentId: string,
    suggestedTimeId: string,
    organizationId: string | undefined,
  ) => {
    if (!onAcceptCounterProposal || !organizationId) return;
    setAcceptingId(suggestedTimeId);
    try {
      await onAcceptCounterProposal({
        appointmentId,
        suggestedTimeId,
        organizationId,
      });
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-orange-200 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-orange-50/70 px-4 sm:px-5 py-4 flex items-center justify-between hover:bg-orange-50 transition-colors duration-200 group md:cursor-default md:hover:bg-orange-50/70"
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="p-2 bg-orange-100 rounded-xl">
              <AlertCircle className="w-5 h-5 text-orange-600" />
            </div>
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500" />
            </span>
          </div>
          <div className="text-left">
            <h3 className="text-lg font-bold text-gray-900">Needs your response</h3>
            <p className="text-xs font-medium text-orange-700">
              Cleaner counter-proposed or declined these appointments
            </p>
          </div>
        </div>
        <div className="md:hidden p-2 bg-white/70 rounded-full group-hover:bg-white transition-colors duration-200">
          {expanded ? (
            <ChevronDown className="w-5 h-5 text-orange-700" />
          ) : (
            <ChevronRight className="w-5 h-5 text-orange-700" />
          )}
        </div>
      </button>

      <div
        className={`${!expanded ? "hidden md:block" : ""} border-t border-orange-100 bg-orange-50/30 p-3 sm:p-4`}
      >
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
            <span className="ml-2 text-gray-600">Loading...</span>
          </div>
        ) : (
          <div className="space-y-2">
            {appointments.map((apt) => {
              const cardData = apt as unknown as AppointmentCardData;
              const cleanerName = getCleanerName(apt);
              const feedback = getFeedback(apt);
              const suggestedTimes = feedback?.cleaner_suggested_times ?? [];
              const suggestedWindows = feedback?.cleaner_suggested_windows ?? [];
              const hasCounterProposal =
                suggestedTimes.length > 0 || suggestedWindows.length > 0;

              // Hard decline path (no suggestions) — keep the existing
              // compact row layout but make the subline show the reason
              // and the rightSlot stay as a Reschedule button.
              if (!hasCounterProposal) {
                return (
                  <CompactAppointmentRow
                    key={apt.id}
                    appointment={cardData}
                    onClick={() => onViewDetails(apt)}
                    hidePaymentChip
                    rightSlot={
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReschedule(apt);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors text-xs font-medium whitespace-nowrap"
                        title="Reassign cleaner"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Reassign
                      </button>
                    }
                    subline={
                      <p className="text-xs text-orange-700 inline-flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">
                          {cleanerName} declined
                          {feedback?.reason ? `: ${feedback.reason}` : " this time"}
                        </span>
                      </p>
                    }
                  />
                );
              }

              // Counter-proposal path — expanded card with one-click accept
              // buttons for each suggested time, plus a Reassign fallback.
              return (
                <article
                  key={apt.id}
                  className="bg-white rounded-xl border border-orange-200 shadow-sm p-4"
                >
                  <header
                    className="flex items-start justify-between gap-3 cursor-pointer"
                    onClick={() => onViewDetails(apt)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{formatDateShort(apt.scheduled_date)}</span>
                        <Clock className="w-3.5 h-3.5" />
                        <span>{formatTimeTo12h(apt.scheduled_time)}</span>
                      </div>
                      <p className="mt-1 text-sm font-semibold text-gray-900 truncate">
                        {apt.homeowner
                          ? `${apt.homeowner.first_name} ${apt.homeowner.last_name}`
                          : "Unknown homeowner"}
                        {apt.property?.address ? ` · ${apt.property.address}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-orange-700 inline-flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {cleanerName} proposed alternatives
                        {feedback?.reason ? ` — ${feedback.reason}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReschedule(apt);
                      }}
                      className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-xs font-medium whitespace-nowrap"
                      title="Reassign cleaner instead"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Reassign
                    </button>
                  </header>

                  <div className="mt-3 border-t border-orange-100 pt-3">
                    <p className="text-xs font-medium text-gray-700 mb-2">
                      Cleaner suggested:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {suggestedTimes.map((st) => {
                        const accepting = acceptingId === st.id;
                        return (
                          <button
                            key={st.id}
                            type="button"
                            disabled={accepting || acceptingId !== null}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAcceptSuggested(
                                apt.id,
                                st.id,
                                apt.organization_id ?? undefined,
                              );
                            }}
                            className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors text-sm font-semibold focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {accepting ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Check className="w-4 h-4" />
                            )}
                            <span>
                              {formatDateShort(st.suggested_date)} ·{" "}
                              {formatTimeTo12h(st.suggested_time)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {suggestedWindows.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-gray-700 mb-1">
                          Or any time within:
                        </p>
                        <ul className="space-y-1 text-sm text-gray-700">
                          {suggestedWindows.map((sw) => (
                            <li key={sw.id} className="flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-gray-400" />
                              {formatDateShort(sw.window_date)},{" "}
                              {formatTimeTo12h(sw.start_time)} –{" "}
                              {formatTimeTo12h(sw.end_time)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
