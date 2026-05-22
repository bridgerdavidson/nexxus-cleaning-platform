"use client";

import React from "react";
import { CheckCircle, Loader2, MessageCircle, UserCheck } from "lucide-react";
import OverviewSectionCard from "./OverviewSectionCard";
import CompactAppointmentRow from "./CompactAppointmentRow";
import { AppointmentCardData } from "./AppointmentCard";

interface AwaitingApprovalSectionProps {
  appointments: AppointmentCardData[];
  loading: boolean;
  onMessageCleaner: (appointment: AppointmentCardData) => void;
  onViewAll: () => void;
  onAppointmentClick?: (appointment: AppointmentCardData) => void;
}

export default function AwaitingApprovalSection({
  appointments,
  loading,
  onMessageCleaner,
  onViewAll,
  onAppointmentClick,
}: AwaitingApprovalSectionProps) {
  if (!loading && appointments.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden w-full">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600 shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 truncate">
              <span className="hidden sm:inline">Awaiting Cleaner Approval</span>
              <span className="sm:hidden">Awaiting Approval</span>
            </h3>
          </div>
          <div
            className="sm:hidden flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 shrink-0"
            aria-label="All cleaners confirmed"
          >
            <CheckCircle className="w-4 h-4 text-green-600" />
          </div>
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold shrink-0">
            <CheckCircle className="w-3.5 h-3.5 text-green-600" />
            <span>All cleaners confirmed</span>
          </div>
        </div>
      </div>
    );
  }

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
        <div className="space-y-2">
          {appointments.slice(0, 3).map((appointment) => {
            const cleanerName = appointment.cleaner_profile?.user_profile;
            const messageButton = cleanerName ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMessageCleaner(appointment);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 bg-primary-50 text-primary-700 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors text-xs font-medium whitespace-nowrap"
                title="Message cleaner"
              >
                <MessageCircle className="w-3.5 h-3.5" />
                Message
              </button>
            ) : null;

            return (
              <CompactAppointmentRow
                key={appointment.id}
                appointment={appointment}
                onClick={
                  onAppointmentClick
                    ? () => onAppointmentClick(appointment)
                    : undefined
                }
                rightSlot={messageButton ?? undefined}
              />
            );
          })}
          {appointments.length > 3 && (
            <div className="pt-2">
              <button
                onClick={onViewAll}
                className="w-full text-center py-3 text-sm font-semibold text-primary-700 bg-white hover:bg-primary-50 transition-colors duration-200 rounded-xl border border-primary-100 shadow-sm"
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
