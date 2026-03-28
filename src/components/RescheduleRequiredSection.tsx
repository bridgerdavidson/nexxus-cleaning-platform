"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  Calendar,
  Clock,
  MapPin,
  SprayCan,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Loader2,
  User,
} from "lucide-react";
import { formatTimeTo12h } from "../lib/formatTime";

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

export default function RescheduleRequiredSection({
  appointments,
  loading,
  onReschedule,
  onViewDetails,
  defaultExpanded = true,
}: RescheduleRequiredSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

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

  const getHomeownerName = (apt: RejectedAppointment) => {
    if (apt.homeowner) {
      const { first_name, last_name } = apt.homeowner;
      return `${first_name || ""} ${last_name || ""}`.trim() || "Unknown";
    }
    return "Unknown";
  };

  const getCleanerName = (apt: RejectedAppointment) => {
    if (apt.cleaner_profile?.user_profile) {
      const { first_name, last_name } = apt.cleaner_profile.user_profile;
      return `${first_name || ""} ${last_name || ""}`.trim() || "Unknown";
    }
    return "Unassigned";
  };

  const getPropertyAddress = (apt: RejectedAppointment) => {
    if (apt.property) {
      const { address, city, state } = apt.property;
      if (address && city && state) return `${address}, ${city}, ${state}`;
    }
    return "Address not available";
  };

  return (
    <div className="relative">
      {/* Animated attention border - red */}
      <div className="absolute -inset-0.5 bg-gradient-to-r from-red-400 via-red-500 to-red-400 rounded-xl opacity-75 animate-pulse" />

      <div className="relative bg-white rounded-xl shadow-sm border-2 border-red-300 overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full bg-gradient-to-r from-red-50 to-rose-50 px-4 py-3 border-b border-red-200 flex items-center justify-between hover:from-red-100 hover:to-rose-100 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              {/* Ping animation */}
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
              </span>
            </div>
            <div className="text-left">
              <span className="font-semibold text-gray-900">
                Reschedule Required
              </span>
              <p className="text-xs text-red-700">
                Cleaner is not available for these appointments
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-red-600 text-white text-xs font-bold px-2.5 py-1 rounded-full">
              {appointments.length}
            </span>
            {expanded ? (
              <ChevronDown className="w-5 h-5 text-red-600" />
            ) : (
              <ChevronRight className="w-5 h-5 text-red-600" />
            )}
          </div>
        </button>

        {/* Content */}
        {expanded && (
          <div className="divide-y divide-gray-100">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-red-500" />
                <span className="ml-2 text-gray-600">Loading...</span>
              </div>
            ) : (
              appointments.map((apt) => (
                <div
                  key={apt.id}
                  className="p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => onViewDetails(apt)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-medium text-gray-900 truncate">
                          {getHomeownerName(apt)}
                        </p>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full flex-shrink-0">
                          <AlertCircle className="w-3 h-3" />
                          Reschedule Required
                        </span>
                      </div>
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
                      <div className="flex items-center gap-1.5 text-sm text-red-600 mt-0.5">
                        <User className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>
                          {getCleanerName(apt)} declined this time
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Reschedule Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onReschedule(apt);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium text-sm"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Reschedule
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
