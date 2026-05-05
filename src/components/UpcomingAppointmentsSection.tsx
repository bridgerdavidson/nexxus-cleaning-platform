"use client";

import React from "react";
import { Calendar, Loader2 } from "lucide-react";
import { formatTimeTo12h } from "../lib/formatTime";
import OverviewSectionCard from "./OverviewSectionCard";
import StatusBadge from "./StatusBadge";
import { AppointmentCardData } from "./AppointmentCard";

interface UpcomingAppointmentsSectionProps {
  appointments: AppointmentCardData[];
  totalCount: number;
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

const formatShortDate = (scheduledDate: string): string => {
  const [year, month, day] = scheduledDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

type PaymentStatus = AppointmentCardData["payment_status"];
type PaymentChip = { label: string; className: string };

const getPaymentChip = (status: PaymentStatus): PaymentChip => {
  switch (status) {
    case "paid":
      return { label: "Paid", className: "bg-green-100 text-green-700" };
    case "failed":
      return { label: "Failed", className: "bg-red-100 text-red-700" };
    case "refunded":
      return { label: "Refunded", className: "bg-blue-100 text-blue-700" };
    case "pending":
    default:
      return { label: "Unpaid", className: "bg-gray-100 text-gray-700" };
  }
};

export default function UpcomingAppointmentsSection({
  appointments,
  totalCount,
  loading,
  onViewAll,
  onItemClick,
}: UpcomingAppointmentsSectionProps) {
  return (
    <OverviewSectionCard
      icon={<Calendar className="w-5 h-5" />}
      iconClassName="bg-gray-50 text-gray-600"
      title="Upcoming Appointments"
      subtitle={`${totalCount} scheduled`}
      collapsible
    >
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading appointments...</span>
        </div>
      ) : appointments.length === 0 ? (
        <div className="text-center py-8">
          <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
          <p className="text-gray-600">No upcoming appointments</p>
        </div>
      ) : (
        <div className="space-y-2">
          {appointments.slice(0, 3).map((appointment) => {
            const cleanerName = getCleanerName(appointment);
            const paymentChip = getPaymentChip(appointment.payment_status);
            const accent =
              appointment.cleaner_confirmation_status === "rejected"
                ? "border-l-4 border-l-red-500"
                : appointment.cleaner_confirmation_status === "awaiting"
                  ? "border-l-4 border-l-amber-400"
                  : "";
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
                className={`w-full text-left flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl bg-white border border-gray-200 shadow-sm ${accent} ${
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
                    {formatShortDate(appointment.scheduled_date)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <StatusBadge status={appointment.status} size="sm" />
                  <span
                    className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${paymentChip.className}`}
                  >
                    {paymentChip.label}
                  </span>
                </div>
              </Wrapper>
            );
          })}
          {totalCount > 3 && (
            <div className="pt-3 border-t border-gray-200">
              <button
                onClick={onViewAll}
                className="w-full text-center text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
              >
                View all {totalCount} upcoming
              </button>
            </div>
          )}
        </div>
      )}
    </OverviewSectionCard>
  );
}
