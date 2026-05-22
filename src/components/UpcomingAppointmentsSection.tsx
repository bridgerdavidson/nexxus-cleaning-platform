"use client";

import React from "react";
import { Calendar, Loader2 } from "lucide-react";
import OverviewSectionCard from "./OverviewSectionCard";
import CompactAppointmentRow from "./CompactAppointmentRow";
import { AppointmentCardData } from "./AppointmentCard";

interface UpcomingAppointmentsSectionProps {
  appointments: AppointmentCardData[];
  totalCount: number;
  loading: boolean;
  onViewAll: () => void;
  onAppointmentClick?: (appointment: AppointmentCardData) => void;
}

export default function UpcomingAppointmentsSection({
  appointments,
  totalCount,
  loading,
  onViewAll,
  onAppointmentClick,
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
          {appointments.slice(0, 3).map((appointment) => (
            <CompactAppointmentRow
              key={appointment.id}
              appointment={appointment}
              onClick={
                onAppointmentClick
                  ? () => onAppointmentClick(appointment)
                  : undefined
              }
            />
          ))}
          {totalCount > 3 && (
            <div className="pt-2">
              <button
                onClick={onViewAll}
                className="w-full text-center py-3 text-sm font-semibold text-primary-700 bg-white hover:bg-primary-50 transition-colors duration-200 rounded-xl border border-primary-100 shadow-sm"
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
