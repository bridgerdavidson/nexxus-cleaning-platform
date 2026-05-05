"use client";

import React from "react";
import { CheckCircle, Loader2, MessageCircle, UserCheck } from "lucide-react";
import { formatDateTimeTo12h } from "../lib/formatTime";
import OverviewSectionCard from "./OverviewSectionCard";
import { AppointmentCardData } from "./AppointmentCard";

interface AwaitingApprovalSectionProps {
  appointments: AppointmentCardData[];
  loading: boolean;
  onMessageCleaner: (appointment: AppointmentCardData) => void;
  onViewAll: () => void;
}

const getCleanerName = (appointment: AppointmentCardData): string | null => {
  const profile = appointment.cleaner_profile?.user_profile;
  if (!profile) return null;
  return `${profile.first_name} ${profile.last_name}`;
};

const getHomeownerName = (appointment: AppointmentCardData): string => {
  if (appointment.homeowner) {
    const { first_name, last_name } = appointment.homeowner;
    return `${first_name} ${last_name}`;
  }
  return "Unknown";
};

export default function AwaitingApprovalSection({
  appointments,
  loading,
  onMessageCleaner,
  onViewAll,
}: AwaitingApprovalSectionProps) {
  return (
    <OverviewSectionCard
      icon={<UserCheck className="w-5 h-5" />}
      iconClassName="bg-amber-50 text-amber-600"
      title="Awaiting Cleaner Approval"
      subtitle={`${appointments.length} awaiting`}
      collapsible
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading appointments...</span>
        </div>
      ) : (
        <div className="space-y-3">
          {appointments.slice(0, 3).map((appointment) => {
            const cleanerName = getCleanerName(appointment);
            return (
              <div
                key={appointment.id}
                className="flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 border-l-4 border-l-amber-400 shadow-sm"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {cleanerName ?? "Unassigned"}
                  </p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {formatDateTimeTo12h(
                      appointment.scheduled_date,
                      appointment.scheduled_time,
                    )}
                  </p>
                  <p className="text-sm text-gray-500">
                    Homeowner: {getHomeownerName(appointment)}
                  </p>
                </div>
                {cleanerName && (
                  <button
                    onClick={() => onMessageCleaner(appointment)}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-primary-50 text-primary-700 border border-primary-200 rounded-xl hover:bg-primary-100 transition-colors font-medium text-sm whitespace-nowrap"
                  >
                    <MessageCircle className="w-4 h-4" />
                    Message
                  </button>
                )}
              </div>
            );
          })}
          {appointments.length === 0 && (
            <div className="text-center py-8">
              <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-2" />
              <p className="text-gray-600">All cleaners confirmed</p>
            </div>
          )}
          {appointments.length > 3 && (
            <div className="pt-3 border-t border-gray-200">
              <button
                onClick={onViewAll}
                className="w-full text-center text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
              >
                View all {appointments.length} awaiting approval
              </button>
            </div>
          )}
        </div>
      )}
    </OverviewSectionCard>
  );
}
