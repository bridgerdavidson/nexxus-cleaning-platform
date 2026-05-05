"use client";

import React from "react";
import { formatTimeTo12h } from "../lib/formatTime";
import StatusBadge from "./StatusBadge";
import { AppointmentCardData } from "./AppointmentCard";

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

const getCleanerName = (a: AppointmentCardData): string | null => {
  const profile = a.cleaner_profile?.user_profile;
  if (!profile) return null;
  return `${profile.first_name} ${profile.last_name}`;
};

const getHomeownerName = (a: AppointmentCardData): string => {
  if (a.homeowner) {
    return `${a.homeowner.first_name} ${a.homeowner.last_name}`;
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

export interface CompactAppointmentRowProps {
  appointment: AppointmentCardData;
  onClick?: () => void;
  /** Replaces the default status badge + payment chip cluster on the right. */
  rightSlot?: React.ReactNode;
  /** Hide the default payment chip (e.g. for cleaner role). */
  hidePaymentChip?: boolean;
  /** Append the date after the homeowner name. Defaults to true. */
  showDate?: boolean;
  /** Optional helper line rendered below the homeowner/date sub-text inside the middle column. */
  subline?: React.ReactNode;
}

export default function CompactAppointmentRow({
  appointment,
  onClick,
  rightSlot,
  hidePaymentChip = false,
  showDate = true,
  subline,
}: CompactAppointmentRowProps) {
  const cleanerName = getCleanerName(appointment);
  const paymentChip = getPaymentChip(appointment.payment_status);

  const hover = onClick
    ? "transition-colors hover:border-primary-300 hover:bg-primary-50/30"
    : "";

  const wrapperClassName = `w-full text-left flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl bg-white border border-gray-200 shadow-sm ${hover}`;

  const inner = (
    <>
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
          {showDate ? ` · ${formatShortDate(appointment.scheduled_date)}` : ""}
        </p>
        {subline && <div className="mt-0.5">{subline}</div>}
      </div>
      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
        {rightSlot ?? (
          <>
            <StatusBadge
              status={appointment.status}
              size="sm"
              cleanerConfirmationStatus={appointment.cleaner_confirmation_status}
            />
            {!hidePaymentChip && (
              <span
                className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${paymentChip.className}`}
              >
                {paymentChip.label}
              </span>
            )}
          </>
        )}
      </div>
    </>
  );

  if (onClick) {
    // Use a div with role="button" rather than a real <button> so that callers
    // can render their own nested interactive elements inside `rightSlot`
    // (e.g. the "Message" quick-action on AwaitingApprovalSection) without
    // creating an invalid nested-button tree.
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={`${wrapperClassName} cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-400`}
      >
        {inner}
      </div>
    );
  }

  return <div className={wrapperClassName}>{inner}</div>;
}
