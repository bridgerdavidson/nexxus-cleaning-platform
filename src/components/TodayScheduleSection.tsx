"use client";

import React from "react";
import { Clock, CheckCircle, Loader2 } from "lucide-react";
import OverviewSectionCard from "./OverviewSectionCard";
import CompactAppointmentRow from "./CompactAppointmentRow";
import { AppointmentCardData } from "./AppointmentCard";

interface TodayScheduleSectionProps {
  appointments: AppointmentCardData[];
  loading: boolean;
  onViewAll: () => void;
  onAppointmentClick?: (appointment: AppointmentCardData) => void;
}

const MAX_ITEMS = 3;

export default function TodayScheduleSection({
  appointments,
  loading,
  onViewAll,
  onAppointmentClick,
}: TodayScheduleSectionProps) {
  if (!loading && appointments.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden w-full">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-gray-50 text-gray-600 shrink-0">
              <Clock className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 truncate">
              Today&apos;s Schedule
            </h3>
          </div>
          <div
            className="sm:hidden flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 shrink-0"
            aria-label="Nothing scheduled today"
          >
            <CheckCircle className="w-4 h-4 text-green-600" />
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold shrink-0">
            <CheckCircle className="w-3.5 h-3.5 text-green-600" />
            <span>Nothing scheduled today</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <OverviewSectionCard
      icon={<Clock className="w-5 h-5" />}
      iconClassName="bg-gray-50 text-gray-600"
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
      ) : (
        <div className="space-y-2">
          {appointments.slice(0, MAX_ITEMS).map((appointment) => (
            <CompactAppointmentRow
              key={appointment.id}
              appointment={appointment}
              showDate={false}
              onClick={
                onAppointmentClick
                  ? () => onAppointmentClick(appointment)
                  : undefined
              }
            />
          ))}
          {appointments.length > MAX_ITEMS && (
            <div className="pt-2">
              <button
                onClick={onViewAll}
                className="w-full text-center py-3 text-sm font-semibold text-primary-700 bg-white hover:bg-primary-50 transition-colors duration-200 rounded-xl border border-primary-100 shadow-sm"
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
