"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  Calendar,
  Clock,
  MapPin,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  SprayCan,
} from "lucide-react";
import { formatTimeTo12h } from "../lib/formatTime";
import ConfirmAvailabilityModal from "./ConfirmAvailabilityModal";

interface PendingAppointment {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  homeowner?: {
    first_name: string | null;
    last_name: string | null;
  };
  property?: {
    address: string;
    city: string;
    state: string;
    zip_code?: string;
  };
  service_type?: {
    name: string;
  };
  checklist?: {
    name: string;
  };
}

interface PendingConfirmationsSectionProps {
  appointments: PendingAppointment[];
  loading: boolean;
  userId: string;
  organizationId: string;
  onConfirmed: () => void; // Callback to refresh appointments after action
}

export default function PendingConfirmationsSection({
  appointments,
  loading,
  userId,
  organizationId,
  onConfirmed,
}: PendingConfirmationsSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"confirm" | "decline">("confirm");
  const [selectedAppointment, setSelectedAppointment] =
    useState<PendingAppointment | null>(null);

  // Don't render while loading or if there are no appointments
  if (loading || appointments.length === 0) return null;

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  const getHomeownerName = (apt: PendingAppointment) => {
    if (apt.homeowner) {
      const { first_name, last_name } = apt.homeowner;
      return `${first_name || ""} ${last_name || ""}`.trim() || "Unknown";
    }
    return "Unknown";
  };

  const getPropertyAddress = (apt: PendingAppointment) => {
    if (apt.property) {
      const { address, city, state } = apt.property;
      return `${address}, ${city}, ${state}`;
    }
    return "Address not available";
  };

  const handleAvailableClick = (apt: PendingAppointment) => {
    setSelectedAppointment(apt);
    setModalMode("confirm");
    setModalOpen(true);
  };

  const handleUnavailableClick = (apt: PendingAppointment) => {
    setSelectedAppointment(apt);
    setModalMode("decline");
    setModalOpen(true);
  };

  const handleConfirm = async () => {
    if (!selectedAppointment) return;

    const response = await fetch("/api/appointments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appointmentId: selectedAppointment.id,
        cleanerId: userId,
        confirmed: true,
        organizationId,
      }),
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Failed to confirm appointment");
    }

    onConfirmed();
  };

  const handleDecline = async (
    reason: string,
    suggestedTimes: { date: string; time: string }[],
    suggestedWindows: { date: string; startTime: string; endTime: string }[]
  ) => {
    if (!selectedAppointment) return;

    const response = await fetch("/api/appointments/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appointmentId: selectedAppointment.id,
        cleanerId: userId,
        confirmed: false,
        organizationId,
        feedback: {
          reason,
          suggestedTimes: suggestedTimes.filter((st) => st.date && st.time),
          suggestedWindows: suggestedWindows.filter((sw) => sw.date && sw.startTime && sw.endTime),
        },
      }),
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Failed to submit feedback");
    }

    onConfirmed();
  };

  const modalAppointmentInfo = selectedAppointment
    ? {
        id: selectedAppointment.id,
        scheduled_date: selectedAppointment.scheduled_date,
        scheduled_time: selectedAppointment.scheduled_time,
        homeowner_name: getHomeownerName(selectedAppointment),
        property_address: getPropertyAddress(selectedAppointment),
        service_name:
          selectedAppointment.service_type?.name
            ? selectedAppointment.checklist?.name
              ? `${selectedAppointment.service_type.name} (${selectedAppointment.checklist.name})`
              : selectedAppointment.service_type.name
            : "Cleaning Service",
      }
    : null;

  return (
    <>
      <div className="relative">
        {/* Animated attention border */}
        <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400 rounded-2xl opacity-75 animate-pulse" />

        <section className="relative bg-white rounded-2xl border border-amber-200 shadow-sm overflow-hidden">
          {/* Header */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full bg-gradient-to-r from-amber-50 to-orange-50 px-4 sm:px-5 py-4 flex items-center justify-between hover:from-amber-100 hover:to-orange-100 transition-colors duration-200 group"
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="p-2 bg-amber-100 rounded-xl">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                </div>
                {/* Ping animation */}
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
                </span>
              </div>
              <div className="text-left">
                <h3 className="text-lg font-bold text-gray-900">
                  Action Required
                </h3>
                <p className="text-xs font-medium text-amber-700">
                  Confirm your availability for these appointments
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="bg-amber-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
                {appointments.length}
              </span>
              <div className="p-2 bg-white/70 rounded-full group-hover:bg-white transition-colors duration-200">
                {expanded ? (
                  <ChevronDown className="w-5 h-5 text-amber-700" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-amber-700" />
                )}
              </div>
            </div>
          </button>

          {/* Content */}
          {expanded && (
            <div className="border-t border-amber-100 bg-amber-50/40 p-3 sm:p-4">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                  <span className="ml-2 text-gray-600">Loading...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {appointments.map((apt) => (
                    <div
                      key={apt.id}
                      className="bg-white rounded-xl border border-gray-200 shadow-sm p-4"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">
                            {getHomeownerName(apt)}
                          </p>
                          <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-1">
                            <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{formatDate(apt.scheduled_date)}</span>
                            <span className="text-gray-300">|</span>
                            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{formatTimeTo12h(apt.scheduled_time)}</span>
                          </div>
                          {apt.service_type && (
                            <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-0.5">
                              <SprayCan className="w-3.5 h-3.5 flex-shrink-0" />
                              <span>
                                {apt.checklist?.name
                                  ? `${apt.service_type.name} (${apt.checklist.name})`
                                  : apt.service_type.name}
                              </span>
                            </div>
                          )}
                          {apt.property && (
                            <div className="flex items-center gap-1.5 text-sm text-gray-500 mt-0.5">
                              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">
                                {getPropertyAddress(apt)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAvailableClick(apt)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-green-100 text-green-700 rounded-xl hover:bg-green-200 transition-colors duration-200 font-medium text-sm"
                        >
                          <CheckCircle className="w-4 h-4" />
                          I&apos;m Available
                        </button>
                        <button
                          onClick={() => handleUnavailableClick(apt)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors duration-200 font-medium text-sm"
                        >
                          <XCircle className="w-4 h-4" />
                          I&apos;m Not Available
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Modal */}
      <ConfirmAvailabilityModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedAppointment(null);
        }}
        onConfirm={handleConfirm}
        onDecline={handleDecline}
        appointment={modalAppointmentInfo}
        mode={modalMode}
      />
    </>
  );
}
