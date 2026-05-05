"use client";

import React from "react";
import { Loader2, Play } from "lucide-react";
import OverviewSectionCard from "./OverviewSectionCard";
import StatusBadge from "./StatusBadge";
import { AppointmentCardData } from "./AppointmentCard";

interface ActiveNowSectionProps {
  appointments: AppointmentCardData[];
  loading: boolean;
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
    const { address, city } = appointment.property;
    if (address && city) return `${address}, ${city}`;
    if (address) return address;
  }
  return "";
};

export default function ActiveNowSection({
  appointments,
  loading,
  onItemClick,
}: ActiveNowSectionProps) {
  return (
    <OverviewSectionCard
      icon={<Play className="w-5 h-5 fill-purple-600" />}
      iconClassName="bg-purple-50 text-purple-600"
      title="Active Now"
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500" />
          </span>
          {appointments.length === 1
            ? "1 job in progress"
            : `${appointments.length} jobs in progress`}
        </span>
      }
      collapsible
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <div className="space-y-2">
          {appointments.map((appointment) => {
            const cleanerName = getCleanerName(appointment);
            const homeowner = getHomeownerName(appointment);
            const address = getPropertyAddress(appointment);
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
                className={`w-full text-left flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl bg-white border border-gray-200 border-l-4 border-l-purple-500 shadow-sm ${
                  onItemClick
                    ? "transition-colors hover:border-purple-300 hover:bg-purple-50/30"
                    : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {cleanerName ?? (
                      <span className="text-gray-400 italic">Unassigned</span>
                    )}
                  </p>
                  <p className="text-xs sm:text-sm text-gray-600 truncate">
                    {homeowner}
                    {address ? ` · ${address}` : ""}
                  </p>
                </div>
                <span className="inline-flex flex-shrink-0">
                  <StatusBadge status="in_progress" size="sm" />
                </span>
              </Wrapper>
            );
          })}
        </div>
      )}
    </OverviewSectionCard>
  );
}
