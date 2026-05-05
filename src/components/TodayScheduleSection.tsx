"use client";

import React from "react";
import { Calendar, Loader2 } from "lucide-react";
import { formatTimeTo12h } from "../lib/formatTime";
import OverviewSectionCard from "./OverviewSectionCard";
import StatusBadge from "./StatusBadge";
import { AppointmentCardData } from "./AppointmentCard";

interface TodayScheduleSectionProps {
  appointments: AppointmentCardData[];
  loading: boolean;
  onViewAll: () => void;
  onItemClick?: (appointment: AppointmentCardData) => void;
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

const getPropertyAddress = (appointment: AppointmentCardData): string => {
  if (appointment.property) {
    const { address, city, state } = appointment.property;
    if (address && city && state) {
      return `${address}, ${city}, ${state}`;
    }
  }
  return "Address not available";
};

const MAX_ITEMS = 5;

export default function TodayScheduleSection({
  appointments,
  loading,
  onViewAll,
  onItemClick,
}: TodayScheduleSectionProps) {
  return (
    <OverviewSectionCard
      icon={<Calendar className="w-5 h-5" />}
      iconClassName="bg-primary-50 text-primary-600"
      title="Today's Schedule"
      subtitle={
        appointments.length === 1
          ? "1 appointment today"
          : `${appointments.length} appointments today`
      }
      collapsible
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading schedule...</span>
        </div>
      ) : appointments.length === 0 ? (
        <div className="text-center py-8">
          <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-600">No appointments today</p>
        </div>
      ) : (
        <div className="space-y-2">
          {appointments.slice(0, MAX_ITEMS).map((appointment) => {
            const cleanerName = getCleanerName(appointment);
            const Wrapper = onItemClick ? "button" : "div";
            return (
              <Wrapper
                key={appointment.id}
                {...(onItemClick
                  ? {
                      type: "button" as const,
                      onClick: () => onItemClick(appointment),
                    }
                  : {})}
                className={`w-full text-left flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl bg-white border border-gray-200 shadow-sm ${
                  onItemClick
                    ? "transition-colors hover:border-primary-300 hover:bg-primary-50/30"
                    : ""
                }`}
              >
                <div className="flex flex-col items-center justify-center min-w-[68px] px-2 py-1.5 rounded-lg bg-primary-50 text-primary-700">
                  <span className="text-sm font-bold tracking-tight whitespace-nowrap">
                    {formatTimeTo12h(appointment.scheduled_time)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {cleanerName ?? (
                      <span className="text-gray-400 italic">Unassigned</span>
                    )}
                  </p>
                  <p className="text-xs sm:text-sm text-gray-600 truncate">
                    {getHomeownerName(appointment)}
                    {" · "}
                    {getPropertyAddress(appointment)}
                  </p>
                </div>
                <div className="flex flex-shrink-0">
                  <StatusBadge status={appointment.status} size="sm" />
                </div>
              </Wrapper>
            );
          })}
          {appointments.length > MAX_ITEMS && (
            <div className="pt-3 border-t border-gray-200">
              <button
                onClick={onViewAll}
                className="w-full text-center text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
              >
                View all {appointments.length} today
              </button>
            </div>
          )}
        </div>
      )}
    </OverviewSectionCard>
  );
}
