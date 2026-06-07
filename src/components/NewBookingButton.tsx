"use client";

import React from "react";
import { Plus } from "lucide-react";

interface NewBookingButtonProps {
  /** Switch to the Bookings tab and open the create-appointment modal. */
  onClick: () => void;
  className?: string;
  label?: string;
}

/**
 * Desktop top-bar "New booking" action for the admin/manager dashboards — the
 * mirror of the homeowner's RequestAppointmentButton. Presentational only: the
 * dashboard owns the action (it lives in BookingsPage's modal), so this just
 * triggers `onClick`. Shared by both dashboards with the action swapped.
 */
export default function NewBookingButton({
  onClick,
  className,
  label = "New booking",
}: NewBookingButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ touchAction: "manipulation" }}
      className={
        className ??
        "inline-flex items-center gap-2 h-10 px-4 bg-primary-600 text-white text-sm font-semibold rounded-full shadow-sm hover:bg-primary-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 focus-visible:ring-offset-2"
      }
    >
      <Plus className="w-4 h-4" />
      {label}
    </button>
  );
}
