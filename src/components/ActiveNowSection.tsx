"use client";

import React from "react";
import { Loader2, Play } from "lucide-react";
import OverviewSectionCard from "./OverviewSectionCard";
import StatusBadge from "./StatusBadge";
import CompactAppointmentRow from "./CompactAppointmentRow";
import { AppointmentCardData } from "./AppointmentCard";

interface ActiveNowSectionProps {
  appointments: AppointmentCardData[];
  loading: boolean;
  onAppointmentClick?: (appointment: AppointmentCardData) => void;
  title?: string;
  /** Override the default CompactAppointmentRow list (e.g. cleaner role uses full AppointmentCard). */
  children?: React.ReactNode;
}

export default function ActiveNowSection({
  appointments,
  loading,
  onAppointmentClick,
  title = "Active Now",
  children,
}: ActiveNowSectionProps) {
  return (
    <OverviewSectionCard
      icon={<Play className="w-5 h-5 fill-cyan-600" />}
      iconClassName="bg-cyan-50 text-cyan-600"
      title={title}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500" />
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
      ) : children ? (
        children
      ) : (
        <div className="space-y-2">
          {appointments.map((appointment) => (
            <CompactAppointmentRow
              key={appointment.id}
              appointment={appointment}
              showDate={false}
              onClick={
                onAppointmentClick
                  ? () => onAppointmentClick(appointment)
                  : undefined
              }
              hidePaymentChip
              rightSlot={<StatusBadge status="in_progress" size="sm" />}
            />
          ))}
        </div>
      )}
    </OverviewSectionCard>
  );
}
