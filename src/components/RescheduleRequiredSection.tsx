"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import CompactAppointmentRow from "./CompactAppointmentRow";
import { AppointmentCardData } from "./AppointmentCard";

interface RejectedAppointment {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
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
}

interface RescheduleRequiredSectionProps {
  appointments: RejectedAppointment[];
  loading: boolean;
  onReschedule: (appointment: RejectedAppointment) => void;
  onViewDetails: (appointment: RejectedAppointment) => void;
  defaultExpanded?: boolean;
}

const getCleanerName = (apt: RejectedAppointment): string => {
  const profile = apt.cleaner_profile?.user_profile;
  if (!profile) return "The cleaner";
  const name = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
  return name || "The cleaner";
};

export default function RescheduleRequiredSection({
  appointments,
  loading,
  onReschedule,
  onViewDetails,
  defaultExpanded = true,
}: RescheduleRequiredSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (loading || appointments.length === 0) return null;

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
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500" />
            </span>
          </div>
          <div className="text-left">
            <h3 className="text-lg font-bold text-gray-900">
              Reschedule Required
            </h3>
            <p className="text-xs font-medium text-orange-700">
              Cleaner is not available for these appointments
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
                        title="Reschedule appointment"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Reschedule
                      </button>
                    }
                    subline={
                      <p className="text-xs text-orange-700 inline-flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">
                          {cleanerName} declined this time
                        </span>
                      </p>
                    }
                  />
                );
              })}
            </div>
          )}
        </div>
    </section>
  );
}
